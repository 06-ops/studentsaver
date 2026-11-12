# Backend (AWS Lambda, Python)

One file per function. Paste each into its Lambda function and click Deploy. These files are copies; the running code lives in AWS.

Function, then what calls it:
- getUploadLink: GET /upload-link
- parseTransactions: S3 upload event, and POST /process-statement
- getTransactions: GET /transactions
- getSummary: GET /summary
- getSubscriptions: GET /subscriptions
- getDiscounts: GET /discounts
- getBudget: GET /budget
- setBudget: POST /budget
- setCategory: POST /categorize
- addTransaction: POST /add-transaction
- deleteData: POST /delete-data
- subscribeAlerts: POST /alerts
- checkBalanceWarning: EventBridge Scheduler (weekly)
- sendWeeklySummary: EventBridge Scheduler (weekly)

Settings:
- Environment variable UPLOAD_BUCKET (name of the private uploads bucket): getUploadLink, parseTransactions, deleteData
- Environment variable TOPIC_ARN (SNS topic address): subscribeAlerts, checkBalanceWarning, sendWeeklySummary
- parseTransactions needs the pypdf layer (pypdf and pycryptodome), 512 MB memory, 60 second timeout
- deleteData and sendWeeklySummary: 60 second timeout
- Python 3.14 runtime; roles need DynamoDB, S3 and SNS access as each function requires
