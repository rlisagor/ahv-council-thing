'use strict';

const uuid = require('uuid');
const request = require('request-promise-native');
// @ts-ignore aws-sdk is already installed on AWS. Not installing locally to keep the build artifacts small
const qs = require('qs');
const helper = require('./helper');
const nationBuilder = require('./nationbuilder');

const EMAIL_SEPARATOR = ', ';

module.exports.entryPoint = async (event) => {
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
