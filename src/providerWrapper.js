// A layer in front of aws-sdk and other provider libs to make testing easier.
// aws-sdk is notoriously hard to mock for testing b/c it dynamically builds methods:
// https://stackoverflow.com/a/40476768/854694
// Feel free to use this layer for other purposes (auth, logging?) too
// TODO: move all AWS calls into this wrapper and integration-test them

const nodemailer = require('nodemailer');
const aws = require('aws-sdk');
const mg = require('nodemailer-mailgun-transport');

module.exports = class ProviderWrapper {
  static async sendEmail(emailOptions) {
    let transporter = this.createTransport();
    await transporter.sendMail(emailOptions);
  }

  static createTransport() {
    switch (process.env.MAIL_PROVIDER) {
    case 'ses':
    case undefined:
      return this.createSESTransport();
    case 'mailgun':
      return this.createMailgunTransport();
    default:
      throw new Error(`invalid provider: ${process.env.MAIL_PROVIDER}`);
    }
  }

  static createSESTransport() {
    return nodemailer.createTransport({
      SES: new aws.SES({ apiVersion: '2010-12-01' })
    });
  }

  static createMailgunTransport() {
    return nodemailer.createTransport(mg({
      auth: {
        api_key: process.env.MAILGUN_KEY,
        domain: process.env.MAILGUN_DOMAIN,
      }
    }));
  }
};
