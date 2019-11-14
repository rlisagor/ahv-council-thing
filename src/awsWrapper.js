// A layer in front of aws-sdk to make testing easier.
// aws-sdk is notoriously hard to mock for testing b/c it dynamically builds methods:
// https://stackoverflow.com/a/40476768/854694
// Feel free to use this layer for other purposes (auth, logging?) too
// TODO: move all AWS calls into this wrapper and integration-test them

const AWS = require('aws-sdk');

module.exports = class AwsWrapper {
  static async SendEmail(emailOptions) {
    const ses = new AWS.SES();
    await ses.sendEmail(emailOptions).promise();
  }
};
