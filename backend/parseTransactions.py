import boto3
import csv
import io
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import unquote_plus
from boto3.dynamodb.conditions import Key

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
transactions_table = dynamodb.Table('Transactions')
subscriptions_table = dynamodb.Table('Subscriptions')
rules_table = dynamodb.Table('CategoryRules')
BUCKET = os.environ.get('UPLOAD_BUCKET', '')

CATEGORY_RULES = {
    "STARBUCKS": "Food & Drink",
    "SWIGGY": "Food & Drink",
    "ZOMATO": "Food & Drink",
    "UBER": "Transport",
    "OLA": "Transport",
    "RAPIDO": "Transport",
    "AMAZON": "Shopping",
    "NETFLIX": "Entertainment",
    "SPOTIFY": "Entertainment",
    "RENT": "Housing",
    "HOSTEL": "Housing",
}


def payee_of(description):
    """'Paid to ABDUL  RAHEEM' -> 'abdul raheem' (must match setCategory.py)."""
    d = re.sub(r'^(paid to|received from)\s+', '', description.lower().strip())
    return ' '.join(d.split())


def load_rules(user_id):
    """Categories this student has chosen before, as {payee: category}."""
    rules = {}
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    try:
        while True:
            page = rules_table.query(**kwargs)
            for item in page['Items']:
                rules[item['payee']] = item['category']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
    except Exception as e:  # e.g. the CategoryRules table is not created yet
        print(f'Could not load category rules: {e}')
    return rules


def categorize(description, rules=None):
    learned = (rules or {}).get(payee_of(description))
    if learned:
        return learned
    desc_upper = description.upper()
    for keyword, category in CATEGORY_RULES.items():
        if keyword in desc_upper:
            return category
    return "Uncategorized"


# ---------- readers: each returns a list of (iso_date, description, Decimal amount) ----------

def decode_text(data):
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', errors='replace')


def normalize_date(text):
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(text.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    raise ValueError(f'Unrecognised date: {text}')


def rows_from_csv(data):
    reader = csv.DictReader(io.StringIO(decode_text(data)))
    rows = []
    for raw in reader:
        row = {(k or '').strip().lower(): (v or '').strip() for k, v in raw.items()}
        try:
            date = normalize_date(row['date'])
            amount = Decimal(row['amount'].replace(',', '').replace('₹', ''))
        except (KeyError, ValueError, InvalidOperation):
            continue
        rows.append((date, row.get('description', ''), amount))
    return rows


# One Google Pay line looks like: "03 Jul, 2026   Paid to ABDUL RAHEEM   ₹20"
PDF_LINE = re.compile(r'^\s*(\d{1,2})\s*([A-Za-z]{3}),?\s*(\d{4})\s+(.+?)\s+₹\s*([\d,]+(?:\.\d+)?)\s*$')
CREDIT_WORDS = ('received', 'refund', 'cashback')
PHONEPE_LINE = re.compile(r'^\s*([A-Za-z]{3})\s+(\d{1,2}),?\s*(\d{4})\s+(.+?)\s+(DEBIT|CREDIT)\s+(?:INR|Rs\.?|[^\w\s])?\s*([\d,]+(?:\.\d+)?)\s*$', re.I)


class PasswordRequired(Exception):
    pass


class WrongPassword(Exception):
    pass


def rows_from_pdf(data, password=None):
    from pypdf import PdfReader  # provided by the pypdf Lambda layer

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted and not reader.decrypt(password or ''):  # '' opens files with no open-password
        raise WrongPassword() if password else PasswordRequired()
    rows = []
    lines = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode='layout') or ''
        lines += text.splitlines()
        for line in text.splitlines():
            m = PDF_LINE.match(line)
            if not m:
                pm = PHONEPE_LINE.match(line)
                if pm:
                    mon, day, year, desc, kind, amt = pm.groups()
                    try:
                        date = datetime.strptime(f'{day} {mon} {year}', '%d %b %Y').strftime('%Y-%m-%d')
                    except ValueError:
                        continue
                    amount = Decimal(amt.replace(',', ''))
                    rows.append((date, ' '.join(desc.split()), -amount if kind.upper() == 'DEBIT' else amount))
                continue
            day, mon, year, desc, amt = m.groups()
            try:
                date = datetime.strptime(f'{day} {mon} {year}', '%d %b %Y').strftime('%Y-%m-%d')
            except ValueError:
                continue
            desc = ' '.join(desc.split())
            amount = Decimal(amt.replace(',', ''))
            if not desc.lower().startswith(CREDIT_WORDS):
                amount = -amount
            rows.append((date, desc, amount))
    return rows or rows_from_bank_lines(lines)  # not Google Pay or PhonePe: try a bank statement table


# ---------- bank statements: a table of date, narration, debit/credit amount and running balance ----------

BANK_DATE = re.compile(r'^\s*(\d{1,2})[-/ ](\d{1,2}|[A-Za-z]{3})[-/ ,]+(\d{2,4})(?!\d)')
ANY_DATE = re.compile(r'\b\d{1,2}[-/ ](?:\d{1,2}|[A-Za-z]{3})[-/ ,]+\d{2,4}\b')
MONEY = re.compile(r'\(?(\d[\d,]*\.\d{2})\)?\s*(Cr|Dr)?(?![\w.])', re.I)
CREDIT_HINTS = ('salary', 'refund', 'interest', 'cashback', 'credit', 'received', 'deposit', 'reversal')


def bank_date(m):
    day, mid, year = m.groups()
    year = int(year) + 2000 if int(year) < 100 else int(year)
    try:
        if mid.isdigit():
            return datetime(year, int(mid), int(day)).strftime('%Y-%m-%d')
        return datetime.strptime(f'{int(day)} {mid} {year}', '%d %b %Y').strftime('%Y-%m-%d')
    except ValueError:
        return None


def clean_narration(text):
    """Drop reference numbers so the same payee reads the same every month."""
    text = re.sub(r'\d{6,}', '', text)
    text = re.sub(r'-{2,}', '-', re.sub(r'/{2,}', '/', text))
    return ' '.join(text.split()).strip(' -/')[:80]


UPI_SLASH = re.compile(r'UPI/(?:DR|CR)/\d+/([^/]+)/', re.I)   # UPI/DR/618227228004/Vendolit/YESB/...
UPI_DASH = re.compile(r'UPI-([^-]+)-', re.I)                  # UPI-SWIGGY-swiggy@icici-...
HEADER_WORDS = ('value date', 'post date', 'ref no', 'cheque', 'debit', 'credit', 'balance', 'details')


def is_page_noise(line):
    low = line.lower()
    return bool(re.match(r'\s*page\s*no', low)) or sum(w in low for w in HEADER_WORDS) >= 2


def direction_hint(raw):
    """True for money in, False for money out, None when the wording does not say."""
    if re.search(r'UPI/CR/|\bDEP\b|BY TRANSFER', raw, re.I):
        return True
    if re.search(r'UPI/DR/|\bWDL\b|TO TRANSFER', raw, re.I):
        return False
    return None


def bank_label(raw, credit):
    """Use the payee name inside a UPI narration; otherwise the narration without reference numbers."""
    m = UPI_SLASH.search(raw) or UPI_DASH.search(raw)
    name = ' '.join(m.group(1).split())[:40] if m else clean_narration(re.sub(r'\bAT\s+\d{3,6}\b.*$', '', raw))
    return ('Received from ' if credit else 'Paid to ') + (name or 'bank transfer')


def rows_from_bank_lines(lines):
    """Works out debit or credit from the running balance, so it never has to guess which column an amount was in.
    If the balances do not add up for almost every row, the layout is not understood and nothing is saved."""
    parsed = []
    for idx, line in enumerate(lines):
        m = BANK_DATE.match(line)
        date = bank_date(m) if m else None
        if not date:
            continue
        rest = line[m.end():]
        tokens = list(MONEY.finditer(rest))
        if len(tokens) < 2:
            continue
        balance = Decimal(tokens[-1].group(1).replace(',', ''))
        amounts = [(Decimal(t.group(1).replace(',', '')), (t.group(2) or '').lower()) for t in tokens[:-1]]
        amounts = [a for a in amounts if a[0] != 0]  # the empty debit or credit column may print 0.00
        if len(amounts) != 1:
            continue
        raw = re.sub(r'(?<!\S)[-\u2013\u2014](?!\S)', ' ', ANY_DATE.sub(' ', rest[:tokens[0].start()]))  # blank columns print '-'
        for nxt in lines[idx + 1: idx + 9]:  # a long narration wraps onto the lines below the date
            if BANK_DATE.match(nxt) or is_page_noise(nxt) or MONEY.search(nxt):
                break
            raw += ' ' + nxt
        parsed.append({'date': date, 'amount': amounts[0][0], 'mark': amounts[0][1], 'balance': balance,
                       'raw': ' '.join(raw.split())})
    if len(parsed) < 2:
        return []

    pairs = list(zip(parsed, parsed[1:]))
    oldest_first = sum(1 for a, b in pairs if abs(b['balance'] - a['balance']) == b['amount'])
    newest_first = sum(1 for a, b in pairs if abs(a['balance'] - b['balance']) == a['amount'])
    if max(oldest_first, newest_first) < 0.9 * len(pairs):
        return []
    ascending = oldest_first >= newest_first

    rows = []
    for i, p in enumerate(parsed):
        other = (parsed[i - 1] if i > 0 else None) if ascending else (parsed[i + 1] if i + 1 < len(parsed) else None)
        delta = p['balance'] - other['balance'] if other else None
        if delta is not None and abs(delta) == p['amount']:
            credit = delta > 0
        elif p['mark']:
            credit = p['mark'] == 'cr'
        else:
            hint = direction_hint(p['raw'])
            credit = hint if hint is not None else any(h in p['raw'].lower() for h in CREDIT_HINTS)
        rows.append((p['date'], bank_label(p['raw'], credit), p['amount'] if credit else -p['amount']))
    return rows


def read_rows(data, password=None):
    """Decide by the file's contents, not its name: PDFs start with %PDF-."""
    if data[:5] == b'%PDF-':
        return rows_from_pdf(data, password), 'pdf'
    return rows_from_csv(data), 'csv'


# ---------- subscription detection ----------

MIN_SUBSCRIPTION_AMOUNT = Decimal('10')


def find_subscriptions(transactions):
    """Payees charged about the same amount at a steady monthly or weekly rhythm, across at least two months."""
    groups = defaultdict(list)
    for t in transactions:
        if t['amount'] < 0:
            groups[payee_of(t['merchant'])].append(t)
    found = []
    for payee, txns in groups.items():
        if not payee or len(txns) < 2:
            continue
        amounts = sorted(abs(t['amount']) for t in txns)
        typical = amounts[len(amounts) // 2]
        if typical < MIN_SUBSCRIPTION_AMOUNT:
            continue
        # Ignore one-off payments to the same payee: keep charges within 10% of the usual amount
        regular = sorted((t for t in txns if abs(abs(t['amount']) - typical) <= typical * Decimal('0.10')),
                         key=lambda t: t['date'])
        dates = [datetime.fromisoformat(t['date']) for t in regular]
        if len(regular) < 2 or len({(d.year, d.month) for d in dates}) < 2:
            continue
        gaps = sorted((dates[i + 1] - dates[i]).days for i in range(len(dates) - 1))
        typical_gap = gaps[(len(gaps) - 1) // 2]  # lower middle gap, so one skipped month does not hide a subscription
        if 26 <= typical_gap <= 35:
            frequency = 'monthly'
        elif 6 <= typical_gap <= 8:
            frequency = 'weekly'
        else:
            continue
        found.append({
            'merchant': regular[-1]['merchant'],
            'amount': abs(regular[-1]['amount']),
            'frequency': frequency,
            'lastChargeDate': dates[-1].isoformat(),
            'nextExpectedDate': (dates[-1] + timedelta(days=typical_gap)).date().isoformat(),
            'charges': len(regular),
            'status': 'active',
        })
    return found


def all_items(table, user_id):
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    items = []
    while True:
        page = table.query(**kwargs)
        items += page['Items']
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def refresh_subscriptions(user_id):
    """Work out subscriptions from everything the student has uploaded so far, then replace the saved list."""
    found = {s['merchant']: s for s in find_subscriptions(all_items(transactions_table, user_id))}
    existing = {s['merchant']: s for s in all_items(subscriptions_table, user_id)}
    with subscriptions_table.batch_writer() as batch:
        for merchant in existing.keys() - found.keys():
            batch.delete_item(Key={'userId': user_id, 'merchant': merchant})
        for merchant, sub in found.items():
            sub['status'] = existing.get(merchant, {}).get('status', 'active')
            batch.put_item(Item={'userId': user_id, **sub})


# ---------- handler ----------

def save_rows(user_id, source, rows):
    rules = load_rules(user_id)
    uploaded_at = datetime.now(timezone.utc).isoformat()
    saved = []
    seen = defaultdict(int)
    with transactions_table.batch_writer() as batch:
        for date, desc, amount in rows:
            # Same transaction -> same id, so uploading a statement twice does not duplicate it
            amt = format(amount.normalize(), 'f')  # -40.0 and -40 count as the same amount
            same = (date, desc, amt)
            seen[same] += 1
            tid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'{user_id}|{date}|{desc}|{amt}|{seen[same]}'))
            item = {
                'userId': user_id,
                'transactionId': tid,
                'date': date,
                'amount': amount,
                'merchant': desc,
                'category': categorize(desc, rules),
                'rawDescription': desc,
                'source': source,
                'uploadedAt': uploaded_at,
            }
            batch.put_item(Item=item)
            saved.append(item)
    refresh_subscriptions(user_id)
    return len(saved)


def api_response(status, body):
    return {'statusCode': status, 'headers': {'Access-Control-Allow-Origin': '*'}, 'body': json.dumps(body)}


def handle_api(event):
    """POST /process-statement: the website sends the file name and, for a protected PDF, its password."""
    user_id = event['requestContext']['authorizer']['claims']['sub']
    try:
        body = json.loads(event.get('body') or '{}')
    except ValueError:
        return api_response(400, {'error': 'bad_request'})
    filename = os.path.basename(str(body.get('filename', '')))
    password = body.get('password') or None
    if not filename or (password is not None and not isinstance(password, str)):
        return api_response(400, {'error': 'bad_request'})
    try:
        data = s3.get_object(Bucket=BUCKET, Key=f'{user_id}/{filename}')['Body'].read()
    except s3.exceptions.NoSuchKey:
        return api_response(404, {'error': 'file_not_found'})
    try:
        rows, kind = read_rows(data, password)
    except PasswordRequired:
        return api_response(422, {'error': 'password_required'})
    except WrongPassword:
        return api_response(422, {'error': 'wrong_password'})
    return api_response(200, {'count': save_rows(user_id, filename, rows) if rows else 0, 'kind': kind})


def lambda_handler(event, context):
    if 'Records' not in event:
        return handle_api(event)

    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = unquote_plus(record['s3']['object']['key'])
        user_id = key.split('/')[0]
        source = key.split('/', 1)[1] if '/' in key else key

        data = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
        try:
            rows, kind = read_rows(data)
        except PasswordRequired:
            print(f'{key}: password protected, waiting for the password through /process-statement')
            continue
        print(f'{key}: read {len(rows)} transactions from a {kind} file')
        if not rows:
            print('No transactions found. CSV files need the header: date,description,amount')
            continue
        save_rows(user_id, source, rows)

    return {'statusCode': 200, 'body': 'Processed'}
