import boto3
import json
import re
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
transactions_table = dynamodb.Table('Transactions')
rules_table = dynamodb.Table('CategoryRules')

ALLOWED = {
    'Food & Drink', 'Transport', 'Shopping', 'Entertainment', 'Housing',
    'Software', 'Education', 'Friends & Family', 'Uncategorized',
}


def payee_of(description):
    """Same normalisation as parseTransactions: 'Paid to ABDUL  RAHEEM' -> 'abdul raheem'."""
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
        body = json.loads(event.get('body') or '{}')
        transaction_id, category = body['transactionId'], body['category']
    except (KeyError, ValueError):
        return respond(400, {'error': 'transactionId and category are required'})
    if category not in ALLOWED:
        return respond(400, {'error': 'Unknown category'})

    # Look the transaction up under THIS user's id, so nobody can touch another student's data
    found = transactions_table.get_item(
        Key={'userId': user_id, 'transactionId': transaction_id}).get('Item')
    if not found:
        return respond(404, {'error': 'Transaction not found'})

    payee = payee_of(found['merchant'])
    if not payee:
        return respond(400, {'error': 'This transaction has no payee name'})

    rules_table.put_item(Item={'userId': user_id, 'payee': payee, 'category': category})

    updated = 0
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    with transactions_table.batch_writer() as batch:
        while True:
            page = transactions_table.query(**kwargs)
            for item in page['Items']:
                if payee_of(item['merchant']) == payee and item['category'] != category:
                    item['category'] = category
                    batch.put_item(Item=item)
                    updated += 1
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    return respond(200, {'updated': updated, 'payee': payee})
