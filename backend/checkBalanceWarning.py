import boto3
import os
from datetime import datetime, timezone
from decimal import Decimal
from collections import defaultdict
from boto3.dynamodb.conditions import Key, Attr

dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')
budgets = dynamodb.Table('Budgets')
txns = dynamodb.Table('Transactions')
TOPIC_ARN = os.environ['TOPIC_ARN']


def lambda_handler(event, context):
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    sent = 0
    for b in budgets.scan(FilterExpression=Attr('month').eq(month))['Items']:
        user = b['userId']
        spent = defaultdict(Decimal)
        for t in txns.query(KeyConditionExpression=Key('userId').eq(user))['Items']:
            if t['amount'] < 0 and t['date'].startswith(month):
                spent[t['category']] += -t['amount']

        lines = []
        for cat, limit in b['categoryBudgets'].items():
            used = spent[cat]
            if used > limit:
                lines.append(f"Over budget: {cat}. Spent Rs {used}, budget Rs {limit}.")
            elif used >= limit * Decimal('0.8'):
                lines.append(f"Almost there: {cat}. Spent Rs {used} of Rs {limit}.")

        if lines:
            sns.publish(
                TopicArn=TOPIC_ARN,
                Subject='StudentSaver budget alert',
                Message='\n'.join(lines),
                MessageAttributes={'userId': {'DataType': 'String', 'StringValue': user}}
            )
            sent += 1
    return {'alertsSent': sent}
