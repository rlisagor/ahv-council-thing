'use strict';

const uuidv4 = require('uuid/v4');
const request = require('request');
const AWS = require('aws-sdk');

const ses = new AWS.SES();

module.exports.createLetter = (event, context, callback) => {
  let submission;
  try {
    submission = JSON.parse(event.body);
  } catch (err) {
    console.log(err);
    return badRequest(callback, 'invalid request format');
  }

  const submissionId = uuidv4();
  const slackReq = {
    attachments: [
      {
        pretext: 'New submission:',
        title: submission.subject,
        author_name: `${submission.name} <${submission.email}>`,
        text: submission.content,
        ts: Math.round(Date.now() / 1000)
      },
      {
        fallback: 'Your client does not support approving/rejecting messages',
        callback_id: 'submit',
        actions: [{
          name: 'approve',
          text: 'Approve',
          style: 'primary',
          type: 'button',
          value: submissionId,
          confirm: {
            text: 'Are you sure you want to approve this message?',
            ok_text: 'Yes',
            dismiss_text: 'Not right now'
          }
        }]
      }
    ],
  };

  request({
    url: process.env.SLACK_WEBHOOK_URL,
    body: slackReq,
    json: true,
    method: 'POST'
  }, (err, req, res) => {
    if (err) {
      callback(err);
    } else {
      callback(null, {
        statusCode: 200,
        body: JSON.stringify({
          id: submissionId
        }),
      });
    }
  });
};

module.exports.approveLetter = (event, context, callback) => {
  let body;
  try {
    body = JSON.parse(decodeURIComponent(event.body.substr(8).replace(/\+/g, ' ')));
  } catch (err) {
    return badRequest(callback, 'invalid request format');;
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return badRequest(callback, 'incorrect validation token');
  }

  const emailAtt = body.original_message.attachments[0];

  function notifySlack() {
    const approveMsg = `:white_check_mark: Approved by <@${body.user.id}|${body.user.name}>`;
    const response = {
      'attachments': [
        emailAtt,
        {
          fallback: approveMsg,
          color: 'good',
          text: approveMsg,
          ts: Math.round(Date.now() / 1000)
        }
      ],
      replace_original: true,
      response_type: 'in_channel'
    };

    callback(null, {
      statusCode: 200,
      body: JSON.stringify(response)
    });
  }

  ses.sendEmail({
    Source: process.env.SEND_FROM,
    Destination: {
      ToAddresses: [process.env.SEND_TO]
    },
    Message: {
      Subject: {
        Data: emailAtt.title
      },
      Body: {
        Text: {
          Data: emailAtt.text
        }
      }
    }
  }, (err, data) => {
    if (err) {
      return callback(err);
    }

    notifySlack();
  });
};

function badRequest(callback, message) {
  const log = `Bad request: ${message}`;
  console.log(log);
  callback(null, {
    statusCode: 400,
    body: log
  });
}
