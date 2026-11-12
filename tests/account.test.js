const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let server, base, dir, cookie;
const emails = [];
const realFetch = global.fetch;
async function request(route, body, session = cookie, method = "POST") {
  return realFetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "studybuddy-account-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "0",
    MONGODB_URI: "",
    DATA_FILE: path.join(dir, "state.json"),
    RESEND_API_KEY: "test-provider-key",
    MAIL_FROM: "Studybuddy <test@example.com>",
    APP_URL: "https://learning.example.com",
  });
  global.fetch = (url, options) =>
    String(url) === "https://api.resend.com/emails"
      ? (emails.push(JSON.parse(options.body)),
        Promise.resolve(new Response('{"id":"test-email"}', { status: 200 })))
      : realFetch(url, options);
  server = await require("../index").start();
  await new Promise((r) =>
    server.listening ? r() : server.once("listening", r),
  );
  base = `http://127.0.0.1:${server.address().port}`;
  const result = await request(
    "/api/auth/register",
    {
      name: "Recovery Learner",
      email: "recovery@example.com",
      password: "old-password-123",
    },
    null,
  );
  assert.equal(result.status, 201);
  cookie = result.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  global.fetch = realFetch;
  if (server) await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});
test("recovery responses do not disclose accounts; single-use hashed reset links revoke existing sessions", async () => {
  const unknown = await request(
    "/api/auth/forgot-password",
    { email: "missing@example.com" },
    null,
  );
  const known = await request(
    "/api/auth/forgot-password",
    { email: "recovery@example.com" },
    null,
  );
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(emails.length, 1);
  await request(
    "/api/auth/forgot-password",
    { email: "recovery@example.com" },
    null,
  );
  assert.equal(emails.length, 1, "cooldown prevents another email");
  const token = emails[0].text.match(/reset-password=([a-f0-9]{64})/)[1];
  const saved = JSON.parse(
    await fs.readFile(path.join(dir, "state.json"), "utf8"),
  );
  assert.ok(saved.users[0].resetHash);
  assert.ok(!JSON.stringify(saved).includes(token));
  assert.equal(
    (
      await request(
        "/api/auth/reset-password",
        { token: "a".repeat(64), password: "new-password-123" },
        null,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/auth/reset-password",
        { token, password: "new-password-123" },
        null,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/auth/reset-password",
        { token, password: "other-password-123" },
        null,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/session", null, cookie, "GET")).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/auth/login",
        { email: "recovery@example.com", password: "old-password-123" },
        null,
      )
    ).status,
    401,
  );
  const login = await request(
    "/api/auth/login",
    { email: "recovery@example.com", password: "new-password-123" },
    null,
  );
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
});
test("email notification opt-in requires verification and verified links are single-use", async () => {
  assert.equal(
    (
      await request(
        "/api/account/preferences",
        { emailNotifications: true },
        cookie,
        "PATCH",
      )
    ).status,
    400,
  );
  assert.equal((await request("/api/account/verification", {})).status, 200);
  const token = emails
    .find((e) => e.text.includes("verify-email="))
    .text.match(/verify-email=([a-f0-9]{64})/)[1];
  assert.equal(
    (await request("/api/auth/verify-email", { token }, null)).status,
    200,
  );
  assert.equal(
    (await request("/api/auth/verify-email", { token }, null)).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/account/preferences",
        { emailNotifications: true },
        cookie,
        "PATCH",
      )
    ).status,
    200,
  );
  const data = await (
    await request("/api/session", null, cookie, "GET")
  ).json();
  assert.equal(data.user.emailVerified, true);
  assert.equal(data.user.emailNotifications, true);
  data.state.assignments = [
    {
      id: "email-task",
      title: "Read a lesson",
      description: "",
      category: "Design",
      due: "2020-01-01",
      done: false,
      submission: "",
    },
  ];
  assert.equal(
    (await request("/api/state", data.state, cookie, "PUT")).status,
    200,
  );
  const before = emails.length;
  await request("/api/notifications", null, cookie, "GET");
  await request("/api/notifications", null, cookie, "GET");
  assert.equal(emails.length, before + 1, "one email for each unique reminder");
});
