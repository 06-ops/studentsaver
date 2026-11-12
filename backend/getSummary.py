import boto3
import json
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('Transactions')


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    response = table.query(KeyConditionExpression=Key('userId').eq(user_id))
    transactions = response['Items']

    by_category = defaultdict(Decimal)
    by_month = defaultdict(Decimal)

    for t in transactions:
        amount = t['amount']
        if amount < 0:  # spending only
            by_category[t['category']] += abs(amount)
            by_month[t['date'][:7]] += abs(amount)

    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({
            'byCategory': dict(by_category),
            'byMonth': dict(by_month)
        }, cls=DecimalEncoder)
    }
