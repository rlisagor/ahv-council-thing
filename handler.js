'use strict';

const uuid = require('uuid');
const request = require('request-promise-native');
// @ts-ignore aws-sdk is already installed on AWS. Not installing locally to keep the build artifacts small
const AWS = require('aws-sdk');
const Handlebars = require('handlebars');
const he = require('he');
const qs = require('qs');
const helper = require('./helper');
const nationBuilder = require('./nationbuilder');
const moment = require('moment');
const athenaStore = require('./athenaStore');
const sqlstring = require('sqlstring');

const EMAIL_TEMPLATE = Handlebars.compile(process.env.EMAIL_TEMPLATE,
  { noEscape: true });
const EMAIL_SEPARATOR = ', ';
const S3_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:mm:ss';

module.exports.createLetter = async (event) => {
  const submissionId = uuid.v4();
  const contentType = (event.headers['content-type'] || 'application/x-www-form-urlencoded');

  let submission;
  try {
    submission = parseSubmission(contentType, event.body);
  } catch (error) {
    return badRequestResponse(error, true);
  }

  let { name, firstName, lastName } = parseNameFields(submission);

  let nbStatus = 'No';
  if (submission.join) {
    nbStatus = await registerWithNationBuilder(firstName, lastName, submission, nbStatus);
  }
  
  await sendLetterToSlack(submission, submissionId, name, nbStatus);

  return successResponse(submissionId);
};

module.exports.approveLetter = (event, _context, callback) => {
  let body;
  try {
    body = JSON.parse(decodeURIComponent(event.body.substr(8).replace(/\+/g, ' ')));
  } catch (err) {
    return callback(null, badRequestResponse('invalid request format'));
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return callback(null, badRequestResponse(callback, 'incorrect validation token'));
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

async function sendLetterToSlack(submission, submissionId, name, nbStatus) {
  const slackReq = generateSlackRequest(submission, submissionId, name, nbStatus);
  await request.post({
    url: process.env.SLACK_WEBHOOK_URL,
    body: slackReq,
    json: true
  });
}

function successResponse(submissionId) {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      id: submissionId
    }),
  };
}

function parseNameFields(submission) {
  let name, firstName, lastName;
  if (submission.name) {
    name = submission.name;
    [firstName, lastName] = helper.splitFullName(name);
  }
  else {
    name = `${submission.first_name} ${submission.last_name}`;
    firstName = submission.first_name;
    lastName = submission.last_name;
  }
  return { name, firstName, lastName };
}

function parseSubmission(contentType, eventBody) {
  let parsedSubmission;
  if (contentType.match(/^application\/json\b/)) {
    try {
      parsedSubmission = JSON.parse(eventBody);
    } catch (err) {
      console.log(err);
      throw 'request is not valid JSON';
    }
  } else if (contentType.match(/^application\/x-www-form-urlencoded\b/)) {
    try {
      parsedSubmission = qs.parse(eventBody);
    } catch (err) {
      console.log(err);
      throw 'request is not a valid form-encoded string';
    }
  } else {
    throw 'unknown content type';
  }
  return parsedSubmission;
}

function generateSlackRequest(submission, submissionId, name, nbStatus) {
  const slackReq = {
    attachments: [
      {
        pretext: 'New submission',
        title: submission.subject,
        author_name: `${name} <${submission.email}>`,
        text: submission.content,
        ts: Math.round(Date.now() / 1000),
        fields: []
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
    slackReq.attachments[0].fields.push({
      title: 'Recipients',
      value: submission.recipients.join(EMAIL_SEPARATOR),
      short: false
    });
  }
  slackReq.attachments[0].fields.push({
    title: 'Registered w/ NationBuilder',
    value: nbStatus,
    short: true,
  });
  slackReq.attachments[0].fields.push({
    title: 'Project ID',
    value: submission.projectId,
    short: true
  });
  return slackReq;
}

async function registerWithNationBuilder(firstName, lastName, submission, nbStatus) {
  try {
    await nationBuilder.registerPerson({
      first_name: firstName,
      last_name: lastName,
      email: submission.email,
    });
    nbStatus = 'Yes';
  }
  catch (err) {
    console.error('Failed to register person with NationBuilder:', err);
    nbStatus = 'Tried, but failed (see logs)';
  }
  return nbStatus;
}

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
    return await errorToSlack(responseUrl, err);
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
  const ses = new AWS.SES();
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
  await ses.sendEmail(emailOpts).promise();
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

module.exports.slash = async (event) => {
  let body;
  try {
    body = qs.parse(event.body);
  } catch (err) {
    return badRequestResponse('request is not a valid form-encoded string');
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return badRequestResponse('incorrect validation token');
  }

  await publishToSNS(process.env.SLASH_TOPIC, body);

  return {
    statusCode: 200,
    body: JSON.stringify({
      response_type: 'in_channel',
      text: ':thinking_face: Ok, gimme a minute...',
    }),
  };
};

module.exports.processSlashCommand = async (event) => {
  let req;
  try {
    req = JSON.parse(event.Records[0].Sns.Message);
  } catch (err) {
    console.error('bad request');
    return;
  }
  console.log(req);

  if (!process.env.ATHENA_DATABASE) {
    return await errorToSlack(
      req.response_url,
      'This mailbot is not set up for querying (no Athena DB configured)'
    );
  }

  const parts = req.text.split(/\s+/);
  let res;
  try {
    switch (parts[0].toLowerCase()) {
    case 'stats': {
      let where = '';
      if (parts[1]) {
        where = 'WHERE projectid=' + sqlstring.escape(parts[1]);
      }
      let q = `SELECT projectid, COUNT(*) AS cnt FROM letterbuilder.letters ${where} GROUP BY projectid ORDER BY cnt DESC`;
      res = await executeQuery(q);
      break;
    }
    case 'leaderboard':
      res = await executeQuery('SELECT sender, COUNT(*) AS cnt FROM letterbuilder.letters GROUP BY sender ORDER BY cnt DESC LIMIT 10');
      break;
    case 'author': {
      if (parts.length < 2) {
        res = 'Must specify author name';
      } else {
        let q = 'SELECT sender, approvedTimestampUTC AS approved_at, subject FROM letterbuilder.letters WHERE lower(sender) LIKE ' + sqlstring.escape('%' + parts.slice(1).join(' ').toLowerCase() + '%');
        res = await executeQuery(q);
      }
      break;
    }
    case 'query':
      res = await executeQuery(parts.slice(1).join(' '));
      break;
    default:
      res = slashUsage(req.command);
    }
  } catch (err) {
    console.error(err);
    await errorToSlack(req.response_url, `Command failed: ${err}`);
  }

  try {
    return await request.post({
      url: req.response_url,
      body: {
        response_type: 'in_channel',
        replace_original: true,
        text: res,
      },
      json: true
    });
  } catch (err) {
    console.error('Failed to respond to Slack: ', err);
  }
};

async function executeQuery(query) {
  console.log(`running query: ${query}`);
  const store = new athenaStore.AthenaLetterStore({
    dbName: process.env.ATHENA_DATABASE,
    s3Path: `s3://${process.env.S3_LOGGING_BUCKET}/query-results/`,
    pollInterval: 2000,
  });

  const res = await store.runQuery(query);
  return '```' + store.formatResult(res) + '```';
}

function slashUsage(command) {
  return [
    `Usage: \`${command} command\``,
    '',
    'Commands:',
    '• `stats [<project>]`: print out the number of letters sent in each campaign (or specific given campaign)',
    '• `leaderboard`: print out the 10 most prolific letter authors',
    '• `author <name or part of name>`: list the subjects of the letters the given author has written',
    '• `query <SQL query>`: run the given SQL query and print out the results',
  ].join('\n');
}

async function publishToSNS(topic, message) {
  const sns = new AWS.SNS();
  await sns.publish({
    TopicArn: topic,
    Message: JSON.stringify(message),
  }).promise();
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

async function errorToSlack(responseUrl, err) {
  try {
    return await request.post({
      url: responseUrl,
      body: {
        'response_type': 'ephemeral',
        'replace_original': false,
        'text': 'Error: ' + err.toString()
      },
      json: true
    });
  } catch (err) {
    console.error('Failed to send error to Slack: ', err);
  }
}

function badRequestResponse(message, cors) {
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

  return result;
}
