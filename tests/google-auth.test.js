const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const project = "studdy-buddy-hub-8cc52";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const keys = {
  keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture-key" }],
};
const payload = {
  auth_time: Math.floor(Date.now() / 1000),
  sub: "google-user-1",
  email: "google-learner@example.com",
  email_verified: true,
  name: "Google Learner",
  firebase: { sign_in_provider: "google.com" },
};
function token(changes = {}, options = {}) {
  return jwt.sign({ ...payload, ...changes }, privateKey, {
    algorithm: "RS256",
    keyid: "fixture-key",
    audience: project,
    issuer: `https://securetoken.google.com/${project}`,
    expiresIn: "1h",
    ...options,
  });
}
test("Google identity verification enforces signature, project, expiry and verified provider", async () => {
  const verify = require("../firebase-token").createGoogleVerifier({
    projectId: project,
    fetchKeys: async () => keys,
  });
  assert.equal((await verify(token())).uid, payload.sub);
  for (const invalid of [
    token({ email_verified: false }),
    token({ auth_time: Math.floor(Date.now() / 1000) + 10000 }),
    token({ firebase: { sign_in_provider: "password" } }),
    token({}, { audience: "another-project" }),
    token({}, { issuer: "https://untrusted.example" }),
    token({}, { expiresIn: -1 }),
    jwt.sign(payload, "fake-secret", {
      algorithm: "HS256",
      keyid: "fixture-key",
    }),
    "not-a-token",
  ])
    await assert.rejects(() => verify(invalid));
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(() =>
    verify(
      jwt.sign(payload, other.privateKey, {
        algorithm: "RS256",
        keyid: "fixture-key",
        audience: project,
        issuer: `https://securetoken.google.com/${project}`,
        expiresIn: "1h",
      }),
    ),
  );
});
let server, root, directory;
const realFetch = global.fetch;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "studybuddy-google-"));
  process.env.NODE_ENV = "test";
  process.env.PORT = "0";
  process.env.DATA_FILE = path.join(directory, "workspace.json");
  delete process.env.MONGODB_URI;
  global.fetch = (url, ...args) =>
    String(url).startsWith("https://www.googleapis.com/service_accounts/")
      ? Promise.resolve(new Response(JSON.stringify(keys), { status: 200 }))
      : realFetch(url, ...args);
  server = await require("../index").start();
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  );
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});
async function post(route, body) {
  return fetch(root + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("Google sign-in creates a stable backend account/session and rejects unsafe email linking", async () => {
  assert.equal(
    (await post("/api/auth/google", { idToken: "fake-token" })).status,
    401,
  );
  const first = await post("/api/auth/google", { idToken: token() });
  assert.equal(first.status, 200);
  const firstData = await first.json();
  const cookie = first.headers.get("set-cookie").split(";")[0];
  const session = await fetch(root + "/api/session", {
    headers: { Cookie: cookie },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.name, "Google Learner");
  const second = await post("/api/auth/google", { idToken: token() });
  assert.equal((await second.json()).user.id, firstData.user.id);
  assert.equal(
    (
      await post("/api/auth/login", {
        email: payload.email,
        password: "not-a-real-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/api/auth/register", {
        name: "Password Learner",
        email: "existing@example.com",
        password: "valid-test-password",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post("/api/auth/google", {
        idToken: token({
          sub: "different-google-user",
          email: "existing@example.com",
        }),
      })
    ).status,
    409,
  );
});
