import boto3
import json
import os
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')
transactions_table = dynamodb.Table('Transactions')
subscriptions_table = dynamodb.Table('Subscriptions')
TOPIC_ARN = os.environ['TOPIC_ARN']


def confirmed_users():
    """Students who confirmed the alert email. Their user id is in the subscription's filter policy."""
    users = {}
    for page in sns.get_paginator('list_subscriptions_by_topic').paginate(TopicArn=TOPIC_ARN):
        for sub in page['Subscriptions']:
            arn = sub['SubscriptionArn']
            if not arn.startswith('arn:'):  # still 'PendingConfirmation'
                continue
            attrs = sns.get_subscription_attributes(SubscriptionArn=arn)['Attributes']
            policy = json.loads(attrs.get('FilterPolicy', '{}'))
            for user_id in policy.get('userId', []):
                users[user_id] = sub['Endpoint']
    return users


def all_items(table, user_id):
    kwargs = {'KeyConditionExpression': Key('userId').eq(user_id)}
    items = []
    while True:
        page = table.query(**kwargs)
        items += page['Items']
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def summarize(items, start, end):
    spent = received = Decimal(0)
    count = 0
    by_cat = defaultdict(Decimal)
    biggest = None
    for t in items:
        if not (start <= date.fromisoformat(t['date']) <= end):
            continue
        amount = t['amount']
        if amount < 0:
            spent += -amount
            count += 1
            by_cat[t['category']] += -amount
            if biggest is None or -amount > biggest[0]:
                biggest = (-amount, t['merchant'])
        else:
            received += amount
    return spent, received, count, by_cat, biggest


def build_message(items, subscription_items):
    if not items:
        return 'You have no transactions yet. Open StudentSaver and upload a statement to get your weekly summary.'

    # Statements are uploaded by hand, so "this week" = the 7 days ending at the latest transaction
    end = max(date.fromisoformat(t['date']) for t in items)
    start = end - timedelta(days=6)
    spent, received, count, by_cat, biggest = summarize(items, start, end)
    prev_spent = summarize(items, start - timedelta(days=7), start - timedelta(days=1))[0]

    lines = [f'Your week: {start:%d %b} to {end:%d %b %Y}', '',
             f'Spent: Rs {spent:,.2f} across {count} payments']
    if prev_spent > 0:
        change = (spent - prev_spent) / prev_spent * 100
        lines.append(f'That is {abs(change):.0f}% {"more" if change > 0 else "less"} '
                     f'than the week before (Rs {prev_spent:,.2f}).')
    lines.append(f'Received: Rs {received:,.2f}')

    top = sorted(by_cat.items(), key=lambda kv: -kv[1])[:3]
    if top:
        lines += ['', 'Top categories:'] + [f'  {cat}: Rs {amt:,.2f}' for cat, amt in top]
    if biggest:
        lines += ['', f'Biggest payment: Rs {biggest[0]:,.2f} ({biggest[1]})']

    active = [s for s in subscription_items if s.get('status') != 'cancelled']
    if active:
        monthly = sum(s['amount'] * (Decimal(52) / 12 if s['frequency'] == 'weekly' else 1) for s in active)
        lines += ['', f'Subscriptions: about Rs {monthly:,.2f} a month']

    uncategorized = by_cat.get('Uncategorized', Decimal(0))
    if spent > 0 and uncategorized / spent > Decimal('0.3'):
        lines += ['', f'{uncategorized / spent * 100:.0f}% of this week is Uncategorized. Open Transactions in '
                      'StudentSaver and pick a category for each payee. It remembers your choices.']
    if (date.today() - end).days > 14:
        lines += ['', f'Your latest transaction is from {end:%d %b %Y}. '
                      'Upload a fresh statement for an up-to-date summary.']
    return '\n'.join(lines)


def lambda_handler(event, context):
    sent = 0
    for user_id in confirmed_users():
        message = build_message(all_items(transactions_table, user_id),
                                all_items(subscriptions_table, user_id))
        sns.publish(
            TopicArn=TOPIC_ARN,
            Subject='StudentSaver weekly summary',
            Message=message,
            MessageAttributes={'userId': {'DataType': 'String', 'StringValue': user_id}},
        )
        sent += 1
    return {'summariesSent': sent}
