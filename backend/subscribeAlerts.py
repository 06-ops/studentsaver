import boto3
import json
import os

sns = boto3.client('sns')
TOPIC_ARN = os.environ['TOPIC_ARN']


def lambda_handler(event, context):
    claims = event['requestContext']['authorizer']['claims']
    user_id = claims['sub']
    email = claims['email']

    sns.subscribe(
        TopicArn=TOPIC_ARN,
        Protocol='email',
        Endpoint=email,
        Attributes={'FilterPolicy': json.dumps({'userId': [user_id]})}
    )

    return {
        'statusCode': 200,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'status': 'confirmation_sent'})
    }
