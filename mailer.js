// The provider key stays on the server. Delivery is optional until configured.
function configured() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.MAIL_FROM &&
    process.env.APP_URL
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
