import boto3
import json
import re
from decimal import Decimal, InvalidOperation

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('Budgets')


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
        month = body['month']
    except (KeyError, ValueError):
        return respond(400, {'error': 'month is required'})
    # A real month like 2026-10, or 'settings' for things that apply to every month (the daily limit)
    if not isinstance(month, str) or not re.match(r'^(\d{4}-\d{2}|settings)$', month):
        return respond(400, {'error': 'month must look like 2026-10'})

    budgets = body.get('categoryBudgets') or {}
    if not isinstance(budgets, dict):
        return respond(400, {'error': 'categoryBudgets must be an object'})

    item = {'userId': user_id, 'month': month, 'categoryBudgets': budgets}
    limit = body.get('dailyLimit')
    if limit is not None:
        try:
            limit = Decimal(str(limit))
        except InvalidOperation:
            return respond(400, {'error': 'dailyLimit must be a number'})
        if not (0 < limit <= 1000000):
            return respond(400, {'error': 'dailyLimit must be more than 0'})
        item['dailyLimit'] = limit

    table.put_item(Item=item)  # saving without a dailyLimit clears it
    return respond(200, {'status': 'saved'})
