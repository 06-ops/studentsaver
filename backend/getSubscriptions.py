import boto3
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
transactions_table = dynamodb.Table('Transactions')
subscriptions_table = dynamodb.Table('Subscriptions')
MIN_SUBSCRIPTION_AMOUNT = Decimal('10')


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def payee_of(description):
    d = re.sub(r'^(paid to|received from)\s+', '', description.lower().strip())
    return ' '.join(d.split())


def all_items(table, user_id):
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    items = []
    while True:
        page = table.query(**kwargs)
        items += page['Items']
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


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


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']

    # Worked out fresh every time, so it is right even when several files were uploaded at once
    found = {s['merchant']: s for s in find_subscriptions(all_items(transactions_table, user_id))}
    existing = {s['merchant']: s for s in all_items(subscriptions_table, user_id)}
    with subscriptions_table.batch_writer() as batch:  # keep the saved list (used by the weekly email) in step
        for merchant in existing.keys() - found.keys():
            batch.delete_item(Key={'userId': user_id, 'merchant': merchant})
        for merchant, sub in found.items():
            sub['status'] = existing.get(merchant, {}).get('status', 'active')
            batch.put_item(Item={'userId': user_id, **sub})

    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(list(found.values()), cls=DecimalEncoder),
    }
