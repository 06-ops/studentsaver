import boto3
import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

dynamodb = boto3.resource('dynamodb')
transactions_table = dynamodb.Table('Transactions')
rules_table = dynamodb.Table('CategoryRules')

ALLOWED = {
    'Food & Drink', 'Transport', 'Shopping', 'Entertainment', 'Housing',
    'Software', 'Education', 'Friends & Family', 'Uncategorized',
}
SOURCES = {'Manual entry', 'Pasted SMS'}
KEYWORDS = {
    'STARBUCKS': 'Food & Drink', 'SWIGGY': 'Food & Drink', 'ZOMATO': 'Food & Drink',
    'UBER': 'Transport', 'OLA': 'Transport', 'RAPIDO': 'Transport',
    'AMAZON': 'Shopping', 'NETFLIX': 'Entertainment', 'SPOTIFY': 'Entertainment',
    'RENT': 'Housing', 'HOSTEL': 'Housing',
}


def payee_of(description):
    d = re.sub(r'^(paid to|received from)\s+', '', description.lower().strip())
    return ' '.join(d.split())


def respond(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    try:
        body = json.loads(event.get('body') or '{}', parse_float=Decimal)
        date = body['date']
        datetime.strptime(date, '%Y-%m-%d')
        description = ' '.join(str(body['description']).split())[:80]
        amount = Decimal(str(body['amount'])).quantize(Decimal('0.01'))
    except (KeyError, ValueError, InvalidOperation):
        return respond(400, {'error': 'date, description and amount are required'})
    if not description or amount == 0 or abs(amount) > Decimal('10000000'):
        return respond(400, {'error': 'Check the description and amount'})

    choice = body.get('category', 'Auto')
    if choice != 'Auto' and choice not in ALLOWED:
        return respond(400, {'error': 'Unknown category'})
    source = body.get('source') if body.get('source') in SOURCES else 'Manual entry'

    payee = payee_of(description)
    if choice == 'Auto':
        learned = rules_table.get_item(Key={'userId': user_id, 'payee': payee}).get('Item') if payee else None
        category = learned['category'] if learned else next(
            (c for k, c in KEYWORDS.items() if k in description.upper()), 'Uncategorized')
    else:
        category = choice
        if payee and category != 'Uncategorized':  # a category the student picks is remembered for this payee
            rules_table.put_item(Item={'userId': user_id, 'payee': payee, 'category': category})

    item = {
        'userId': user_id,
        'transactionId': str(uuid.uuid4()),
        'date': date,
        'amount': amount,
        'merchant': description,
        'category': category,
        'rawDescription': description,
        'source': source,
        'uploadedAt': datetime.now(timezone.utc).isoformat(),
    }
    transactions_table.put_item(Item=item)
    return respond(200, {'transactionId': item['transactionId'], 'category': category})
