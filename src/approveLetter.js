'use strict';

const request = require('request-promise-native');
// @ts-ignore aws-sdk is already installed on AWS. Not installing locally to keep the build artifacts small
const AWS = require('aws-sdk');
const Handlebars = require('handlebars');
const he = require('he');
const helper = require('./helper');
const AwsWrapper = require('./awsWrapper');
const moment = require('moment');

const EMAIL_TEMPLATE = Handlebars.compile(process.env.EMAIL_TEMPLATE,
  { noEscape: true });
const EMAIL_SEPARATOR = ', ';
const S3_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss';

module.exports.entryPoint = (event, _context, callback) => {
  let body;
  try {
    body = JSON.parse(decodeURIComponent(event.body.substr(8).replace(/\+/g, ' ')));
  } catch (err) {
    return callback(null, helper.badRequestResponse('invalid request format'));
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return callback(null, helper.badRequestResponse(callback, 'incorrect validation token'));
  }

  // Respond right away, will send update later via response_url
  callback(null, {
    statusCode: 200
  });

  const letterSlackAttachment = htmlDecodeStringsInMap(body.original_message.attachments[0]);
  const user = body.user;
  const submissionId = body.actions[0].value;

  if (body.actions[0].name === 'approve') {
    approveLetter(body.response_url, letterSlackAttachment, user, submissionId);
  } else {
    rejectLetter(body.response_url, letterSlackAttachment, user);
  }
};

async function approveLetter(responseUrl, letter, user, submissionId) {
  const recipientFields = letter.fields.filter(f => f.title === 'Recipients');
  let sendTo = recipientFields[0].value.split(EMAIL_SEPARATOR).map(e => helper.extractEmailAddress(e));

  const projectId = letter.fields.filter(f => f.title === 'Project ID')[0].value;

  if (sendTo.length === 1 && sendTo[0] === 'author') {
    sendTo = [letter.author_name];
  }

  console.log(`Sending to ${sendTo}`);

  try {
    let emailSubject = letter.title;
    let emailBody = EMAIL_TEMPLATE(letter);
    await sendLetterUsingSES(sendTo, letter, emailSubject, emailBody);

    if (process.env.S3_LOGGING_BUCKET.length > 0) {
      await logLetterToS3(projectId, letter, sendTo, emailSubject, emailBody, submissionId);
    } else {
      console.log('S3 bucket and/or key not specified. Not logging to S3.');
    }

  } catch (err) {
    return await helper.errorToSlack(responseUrl, err);
  }

  const message = `:white_check_mark: Approved by <@${user.id}|${user.name}>`;
  return await respondToSlack(responseUrl, letter, message, 'good');
}

async function logLetterToS3(projectId, letter, sendTo, emailSubject, emailBody, submissionId) {
  const logEntry = {
    projectid: projectId,
    sender: letter.author_name,
    recipients: sendTo,
    subject: emailSubject,
    body: emailBody,
    approvedTimestampUTC: moment().format(S3_TIMESTAMP_FORMAT)
  };
  const s3 = new AWS.S3();
  await s3.putObject({
    Bucket: process.env.S3_LOGGING_BUCKET,
    Key: `letters/${projectId}-${submissionId}.json`,
    Body: JSON.stringify(logEntry)
  }).promise();
}

async function sendLetterUsingSES(sendTo, letter, emailSubject, emailBody) {
  const emailOpts = {
    Source: process.env.SEND_FROM,
    Destination: {
      ToAddresses: sendTo,
      CcAddresses: [letter.author_name]
    },
    ReplyToAddresses: [letter.author_name],
    Message: {
      Subject: {
        Data: emailSubject
      },
      Body: {
        Text: {
          Data: emailBody,
          Charset: 'UTF-8'
        }
      }
    }
  };
  await AwsWrapper.SendEmail(emailOpts);
}

function htmlDecodeStringsInMap(emailAsSlackAttachment) {
  const email = {};
  for (const k in emailAsSlackAttachment) {
    if (typeof emailAsSlackAttachment[k] === 'string') {
      email[k] = he.decode(emailAsSlackAttachment[k]);
    }
    else {
      email[k] = emailAsSlackAttachment[k];
    }
  }
  return email;
}

async function rejectLetter(responseUrl, emailAtt, user) {
  const message = `:x: Rejected by <@${user.id}|${user.name}>`;
  return await respondToSlack(responseUrl, emailAtt, message, 'danger');
}

async function respondToSlack(responseUrl, emailAtt, message, color) {
  const response = {
    'attachments': [
      emailAtt,
      {
        fallback: message,
        color: color,
        text: message,
        ts: Math.round(Date.now() / 1000)
      }
    ],
    replace_original: true,
    response_type: 'in_channel'
  };

  try {
    return await request.post({
      url: responseUrl,
      body: response,
      json: true
    });
  } catch (err) {
    console.error('Failed to respond to Slack: ', err);
  }
}

