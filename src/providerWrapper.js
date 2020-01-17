// A layer in front of aws-sdk and other provider libs to make testing easier.
// aws-sdk is notoriously hard to mock for testing b/c it dynamically builds methods:
// https://stackoverflow.com/a/40476768/854694
// Feel free to use this layer for other purposes (auth, logging?) too
// TODO: move all AWS calls into this wrapper and integration-test them

let nodemailer = require('nodemailer');
let aws = require('aws-sdk');

module.exports = class ProviderWrapper {
  static async sendEmail(emailOptions) {
    let transporter = nodemailer.createTransport({
      SES: new aws.SES({ apiVersion: '2010-12-01' })
    });

    await transporter.sendMail(emailOptions);
  }
};
