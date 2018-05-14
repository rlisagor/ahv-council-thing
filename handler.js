'use strict';

const uuidv4 = require('uuid/v4');
const request = require('request');
// @ts-ignore aws-sdk is already installed on AWS. Not installing locally to keep the build artifacts small
const AWS = require('aws-sdk');
const Handlebars = require('handlebars');
const he = require('he');
const qs = require('qs');
const slackHelper = require('./slack-helper');

const ses = new AWS.SES();

const EMAIL_TEMPLATE = Handlebars.compile(process.env.EMAIL_TEMPLATE,
  {noEscape: true});
const EMAIL_SEPARATOR = ', ';

module.exports.createLetter = (event, _context, callback) => {
  const contentType = (event.headers['content-type'] ||
    'application/x-www-form-urlencoded');

  let submission;
  if (contentType.match(/^application\/json\b/)) {
    try {
      submission = JSON.parse(event.body);
    } catch (err) {
      console.log(err);
      return badRequest(callback, 'request is not valid JSON', true);
    }
  } else if (contentType.match(/^application\/x-www-form-urlencoded\b/)) {
    try {
      submission = qs.parse(event.body);
    } catch (err) {
      console.log(err);
      return badRequest(callback, 'request is not a valid form-encoded string', true);
    }
  } else {
    return badRequest(callback, 'unknown content type', true);
  }

  let pretext = 'New submission:';
  if (submission.join) {
    pretext = 'New submission + join:';
  }

  var name = submission.name;
  if (!name) {
    name = `${submission.first_name} ${submission.last_name}`;
  }

  const submissionId = uuidv4();
  const slackReq = {
    attachments: [
      {
        pretext: pretext,
        title: submission.subject,
        author_name: `${name} <${submission.email}>`,
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
        }, {
          name: 'reject',
          text: 'Reject',
          type: 'button',
          confirm: {
            text: 'Are you sure you want to reject this message?',
            ok_text: 'Yes',
            dismiss_text: 'Not right now'
          }
        }]
      }
    ],
  };

  if (submission.recipients) {
    slackReq.attachments[0].fields = [
      {
        title: 'Recipients',
        value: submission.recipients.join(EMAIL_SEPARATOR),
        short: false
      }
    ];
  }

  request({
    url: process.env.SLACK_WEBHOOK_URL,
    body: slackReq,
    json: true,
    method: 'POST'
  }, (err, _req, _res) => {
    if (err) {
      callback(err);
    } else {
      callback(null, {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          id: submissionId
        }),
      });
    }
  });
};

module.exports.approveLetter = (event, _context, callback) => {
  let body;
  try {
    body = JSON.parse(decodeURIComponent(event.body.substr(8).replace(/\+/g, ' ')));
  } catch (err) {
    return badRequest(callback, 'invalid request format');
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return badRequest(callback, 'incorrect validation token');
  }

  // Respond right away, will send update later via response_url
  callback(null, {
    statusCode: 200
  });

  const emailAtt = body.original_message.attachments[0];
  const user = body.user;

  if (body.actions[0].name === 'approve') {
    approve(body.response_url, emailAtt, user);
  } else {
    reject(body.response_url, emailAtt, user);
  }
};

function approve(responseUrl, emailAtt, user) {
  // Slack replaces various things with HTML elements, so we must convert it
  // back for the email.
  const tmplContext = {};
  for (const k in emailAtt) {
    if (typeof emailAtt[k] === 'string') {
      tmplContext[k] = he.decode(emailAtt[k]);
    } else {
      tmplContext[k] = emailAtt[k];
    }
  }

  const recipientFields = emailAtt.fields.filter(f => f.title === 'Recipients');
  let sendTo = recipientFields[0].value.split(EMAIL_SEPARATOR).map(e => slackHelper.extractEmailAddress(e));

  if (sendTo.length === 1 && sendTo[0] === 'author') {
    sendTo = [tmplContext.author_name];
  }

  console.log(`Sending to ${sendTo}`);

  ses.sendEmail({
    Source: process.env.SEND_FROM,
    Destination: {
      ToAddresses: sendTo
    },
    ReplyToAddresses: [tmplContext.author_name],
    Message: {
      Subject: {
        Data: emailAtt.title
      },
      Body: {
        Text: {
          Data: EMAIL_TEMPLATE(tmplContext),
          Charset: 'UTF-8'
        }
      }
    }
  }, (err, _data) => {
    if (err) {
      return errorToSlack(responseUrl, err);
    }

    const message = `:white_check_mark: Approved by <@${user.id}|${user.name}>`;
    respondToSlack(responseUrl, emailAtt, message, 'good');
  });
}

function reject(responseUrl, emailAtt, user) {
  const message = `:x: Rejected by <@${user.id}|${user.name}>`;
  respondToSlack(responseUrl, emailAtt, message, 'danger');
}

function respondToSlack(responseUrl, emailAtt, message, color) {
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

  request({
    url: responseUrl,
    body: response,
    json: true,
    method: 'POST'
  }, (err, _req, _res) => {
    if (err) {
      console.error('Failed to respond to Slack: ', err);
    }
  });
}

function errorToSlack(responseUrl, err) {
  request({
    url: responseUrl,
    body: {
      'response_type': 'ephemeral',
      'replace_original': false,
      'text': 'Error: ' + err.toString()
    },
    json: true,
    method: 'POST'
  }, (err, _req, _res) => {
    if (err) {
      console.error('Failed to send error to Slack: ', err);
    }
  });
}

function badRequest(callback, message, cors) {
  const log = `Bad request: ${message}`;
  console.log(log);

  const result = {
    statusCode: 400,
    body: log
  };

  if (cors) {
    result.headers = {
      'Access-Control-Allow-Origin': '*'
    };
  }

  callback(null, result);
}
