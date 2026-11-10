const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let directory, handler;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "studybuddy-netlify-"));
  process.env.NODE_ENV = "test";
  process.env.DATA_FILE = path.join(directory, "data.json");
  delete process.env.MONGODB_URI;
  handler = require("../netlify/functions/api").handler;
});
after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
function invoke(route, method = "GET", body, cookie) {
  return handler(
    {
      version: "1.0",
      path: route,
      rawUrl: `https://test.netlify.app${route}`,
      httpMethod: method,
      headers: {
        host: "test.netlify.app",
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      queryStringParameters: {},
      requestContext: { identity: { sourceIp: "127.0.0.1" } },
      isBase64Encoded: false,
      body: body ? JSON.stringify(body) : null,
    },
    {},
  );
}
test("Netlify adapter routes /api and preserves authentication cookies", async () => {
  assert.equal((await invoke("/api/health")).statusCode, 200);
  assert.equal(JSON.parse((await invoke("/api/courses")).body).length, 6);
  assert.equal((await invoke("/api/session")).statusCode, 401);
  assert.equal(
    (await invoke("/.netlify/functions/api/api/health")).statusCode,
    200,
  );
  const registration = await invoke("/api/auth/register", "POST", {
    name: "Netlify Learner",
    email: "function@example.com",
    password: "function-test-password",
  });
  assert.equal(registration.statusCode, 201);
  const entry = Object.entries(registration.multiValueHeaders || {}).find(
    ([name]) => name.toLowerCase() === "set-cookie",
  );
  const single = Object.entries(registration.headers || {}).find(
    ([name]) => name.toLowerCase() === "set-cookie",
  );
  const cookies =
    entry?.[1] || registration.cookies || (single ? [single[1]] : []);
  assert.ok(cookies?.length, "Response must carry a Set-Cookie header");
  const session = await invoke(
    "/api/session",
    "GET",
    null,
    cookies[0].split(";")[0],
  );
  assert.equal(session.statusCode, 200);
  assert.equal(JSON.parse(session.body).user.name, "Netlify Learner");
});
