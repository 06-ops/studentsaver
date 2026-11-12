import boto3
import json
from decimal import Decimal
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
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    items = []
    while True:
        r = table.query(**kwargs)
        items += r['Items']
        if 'LastEvaluatedKey' not in r:
            break
        kwargs['ExclusiveStartKey'] = r['LastEvaluatedKey']
    items.sort(key=lambda t: t['date'], reverse=True)
    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(items, cls=DecimalEncoder)
    }
