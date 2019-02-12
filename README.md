This thing mails letters to City Council.

## Set up dev environment

1. Set up an AWS account.
2. Set up [AWS keys on your machine](http://docs.aws.amazon.com/cli/latest/userguide/cli-config-files.html).
3. Install [node](https://nodejs.org/)
4. Install [serverless](https://serverless.com/):

        npm install -g serverless

## Configure environment and deploy

1. [Authorize AWS SES](http://docs.aws.amazon.com/ses/latest/DeveloperGuide/verify-domains.html) to send from your desired domain.
2. If you want to send to non-verified email addresses, [request to move out of the sandbox](http://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html). Otherwise, [verify the email you're sending to](http://docs.aws.amazon.com/ses/latest/DeveloperGuide/verify-email-addresses.html).
3. Create a new env file, named: `env.<env name>.yml` (e.g. `env.dev.yml`). See [example](env.example.yml)
4. Set up Slack
    1. Go to https://api.slack.com/apps
    2. Create a new app and attach it to your team
    3. Enable incoming webhooks for the app and select the channel that you want to post to. Copy the webhook URL into the env file.
    4. From the "basic information" tab, copy the verification token into the env file.
5. Deploy the Lambda functions

        serverless deploy -s <env name>

6. Copy the Lambda URLs that serverless prints out:
    - Enable interactive messages for the Slack app. Copy the URL of the `approve` function into the interactive messages request URL.
    - Copy the URL of the `submit` function into the code that is placed into NationBuilder.
7. Insert the code snippets into NationBuilder (see [example](example.html))
8. (Optional) Set up a Slack slash command to point to the `slash` endpoint URL.

## How it works

The system consists of several parts:

- The form in NationBuilder (see [example](example.html))
- 4 AWS Lambda functions (`submit`, `approve`, `slash`, and `processSlashCommand`)
- The Slack application
- (Optional) An S3 bucket for logging. Because we log in a consistent JSON format, you can use [AWS Athena](https://aws.amazon.com/athena/) to query logs. We provide a Slack slash command to do this.

The workflow:

1. User fills in form on NationBuilder
2. The submission goes to the `submit` Lambda function.
3. This function sends a request to the Slack app, this is posted on a Slack channel
4. Someone from the group reads the submission and clicks "Approve"
5. Slack sends a request to the `approve` Lambda function.
6. The function uses AWS SES to send the email.
7. If enabled, the function writes a JSON file containing the letter details to the S3 bucket.
