import boto3
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
transactions_table = dynamodb.Table('Transactions')
subscriptions_table = dynamodb.Table('Subscriptions')
rules_table = dynamodb.Table('CategoryRules')
BUCKET = os.environ['UPLOAD_BUCKET']
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def respond(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }


def all_items(table, user_id):
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    items = []
    while True:
        page = table.query(**kwargs)
        items += page['Items']
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def payee_of(description):
    d = re.sub(r'^(paid to|received from)\s+', '', description.lower().strip())
    return ' '.join(d.split())


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


def detect_subscriptions(user_id, transactions):
    for sub in find_subscriptions(transactions):
        subscriptions_table.put_item(Item={'userId': user_id, **sub})


def delete_keys(table, user_id, items, sort_key):
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={'userId': user_id, sort_key: item[sort_key]})


def delete_uploaded_files(prefix):
    token = None
    while True:
        args = {'Bucket': BUCKET, 'Prefix': prefix}
        if token:
            args['ContinuationToken'] = token
        page = s3.list_objects_v2(**args)
        objects = [{'Key': o['Key']} for o in page.get('Contents', [])]
        if objects:
            s3.delete_objects(Bucket=BUCKET, Delete={'Objects': objects})
        if not page.get('IsTruncated'):
            return
        token = page['NextContinuationToken']


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    try:
        body = json.loads(event.get('body') or '{}')
    except ValueError:
        return respond(400, {'error': 'Invalid request'})
    mode = body.get('mode')
    items = all_items(transactions_table, user_id)

    if mode == 'source':
        source = body.get('source', '')  # '' means uploads from before file names were saved
        if not isinstance(source, str):
            return respond(400, {'error': 'Invalid source'})
        doomed = [t for t in items if t.get('source', '') == source]
    elif mode == 'range':
        start, end = body.get('from', ''), body.get('to', '')
        if not (DATE.match(start) and DATE.match(end)):
            return respond(400, {'error': 'Dates must look like 2026-09-01'})
        doomed = [t for t in items if start <= t['date'] <= end]
    elif mode == 'all':
        doomed = items
    else:
        return respond(400, {'error': 'Unknown delete mode'})

    delete_keys(transactions_table, user_id, doomed, 'transactionId')

    if mode == 'all':
        delete_keys(subscriptions_table, user_id, all_items(subscriptions_table, user_id), 'merchant')
        delete_keys(rules_table, user_id, all_items(rules_table, user_id), 'payee')
        delete_uploaded_files(f'{user_id}/')
    else:
        if mode == 'source' and source:
            s3.delete_object(Bucket=BUCKET, Key=f'{user_id}/{source}')
        # Subscriptions were worked out from the old data, so work them out again from what is left
        gone = {t['transactionId'] for t in doomed}
        remaining = [t for t in items if t['transactionId'] not in gone]
        delete_keys(subscriptions_table, user_id, all_items(subscriptions_table, user_id), 'merchant')
        detect_subscriptions(user_id, remaining)

    return respond(200, {'deleted': len(doomed)})
