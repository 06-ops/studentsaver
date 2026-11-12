import boto3
import json

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('Discounts')


def lambda_handler(event, context):
    response = table.scan()
    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(response['Items'])
    }
