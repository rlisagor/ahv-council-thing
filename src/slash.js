'use strict';

const athenaStore = require('./athenaStore');
// @ts-ignore aws-sdk is already installed on AWS. Not installing locally to keep the build artifacts small
const AWS = require('aws-sdk');
const helper = require('./helper');
const qs = require('qs');
const request = require('request-promise-native');
const sqlstring = require('sqlstring');

module.exports.invokeSlashCommand = async (event) => {
  let body;
  try {
    body = qs.parse(event.body);
  } catch (err) {
    return helper.badRequestResponse('request is not a valid form-encoded string');
  }

  if (body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return helper.badRequestResponse('incorrect validation token');
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
    return await helper.errorToSlack(
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
    await helper.errorToSlack(req.response_url, `Command failed: ${err}`);
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
