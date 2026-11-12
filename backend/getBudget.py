import boto3
import json
import re
from datetime import datetime, timezone
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('Budgets')


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    params = event.get('queryStringParameters') or {}
    month = params.get('month') or datetime.now(timezone.utc).strftime('%Y-%m')
    if not re.match(r'^\d{4}-\d{2}$', month):
        return {'statusCode': 400, 'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'month must look like 2026-10'})}

    item = table.get_item(Key={'userId': user_id, 'month': month}).get('Item')
    settings = table.get_item(Key={'userId': user_id, 'month': 'settings'}).get('Item')  # the daily limit applies to every month
    body = {
        'month': month,
        'categoryBudgets': item['categoryBudgets'] if item else {},
        'dailyLimit': settings.get('dailyLimit') if settings else None,
    }
    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body, cls=DecimalEncoder),
    }
