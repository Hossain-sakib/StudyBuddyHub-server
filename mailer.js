// The provider key stays on the server. Delivery is optional until configured.
function smtpOptions() {
  const port = Number(process.env.SMTP_PORT || 465);
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    ![465, 587].includes(port)
  )
    return null;
  return {
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
function configured() {
  return !!(
    process.env.MAIL_FROM &&
    process.env.APP_URL &&
    (smtpOptions() || process.env.RESEND_API_KEY)
  );
}
function appUrl() {
  const url = new URL(process.env.APP_URL);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production")
    throw new Error("Email links require HTTPS.");
  return url.origin + url.pathname.replace(/\/$/, "");
}
async function send({ to, subject, text, key }) {
  if (!configured()) throw new Error("Email delivery is not configured.");
  const smtp = smtpOptions();
  if (smtp) {
    const transport = require("nodemailer").createTransport(smtp);
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return;
    } finally {
      transport.close();
    }
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email provider rejected delivery.");
}
module.exports = { configured, appUrl, send };
