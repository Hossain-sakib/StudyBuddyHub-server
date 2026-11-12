const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const mail = require("../mailer");
test("Gmail SMTP sends without a custom domain and requires authenticated TLS", async (t) => {
  const keys = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "MAIL_FROM",
    "APP_URL",
    "RESEND_API_KEY",
  ];
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const create = nodemailer.createTransport;
  t.after(() => {
    nodemailer.createTransport = create;
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  Object.assign(process.env, {
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_USER: "owner@gmail.com",
    SMTP_PASS: "test-app-password",
    MAIL_FROM: "Studybuddy <owner@gmail.com>",
    APP_URL: "https://learning.example.com",
  });
  delete process.env.RESEND_API_KEY;
  let options,
    sent,
    closed = false;
  nodemailer.createTransport = (value) => {
    options = value;
    return {
      sendMail: async (value) => {
        sent = value;
      },
      close: () => {
        closed = true;
      },
    };
  };
  assert.equal(mail.configured(), true);
  await mail.send({
    to: "learner@example.com",
    subject: "Your learning update",
    text: "A useful update.",
  });
  assert.equal(options.host, "smtp.gmail.com");
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.auth.user, "owner@gmail.com");
  assert.equal(options.disableUrlAccess, true);
  assert.equal(sent.to, "learner@example.com");
  assert.equal(closed, true);
  process.env.SMTP_PORT = "587";
  await mail.send({
    to: "learner@example.com",
    subject: "STARTTLS test",
    text: "Testing",
  });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  delete process.env.SMTP_PASS;
  assert.equal(mail.configured(), false);
  process.env.SMTP_PASS = "test";
  process.env.SMTP_PORT = "25";
  assert.equal(mail.configured(), false);
});
