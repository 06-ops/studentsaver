import boto3
import json
import os

s3 = boto3.client('s3')
BUCKET = os.environ['UPLOAD_BUCKET']
ALLOWED_TYPES = {'text/csv', 'application/pdf'}


def respond(status, body):
    return {
        'statusCode': status,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }


def lambda_handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    params = event.get('queryStringParameters') or {}

    filename = os.path.basename(params.get('filename', 'statement'))
    content_type = params.get('contentType', 'text/csv')
    if content_type not in ALLOWED_TYPES:
        return respond(400, {'error': 'Only CSV and PDF files are supported'})

    key = f'{user_id}/{filename}'
    url = s3.generate_presigned_url(
        'put_object',
        Params={'Bucket': BUCKET, 'Key': key, 'ContentType': content_type},
        ExpiresIn=300,
    )
    return respond(200, {'uploadUrl': url, 'key': key})
