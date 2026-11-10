const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { resources } = require("../admin/resources");
let server, root, directory, adminCookie, learnerCookie;
const realFetch = global.fetch;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "studybuddy-admin-"));
  process.env.NODE_ENV = "test";
  process.env.PORT = "0";
  process.env.MONGODB_URI = "";
  process.env.DATA_FILE = path.join(directory, "workspace.json");
  process.env.ADMIN_EMAIL = "admin@example.com";
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const keys = {
    keys: [{ ...publicKey.export({ format: "jwk" }), kid: "admin-fixture" }],
  };
  global.fetch = (url, ...args) =>
    String(url).startsWith("https://www.googleapis.com/service_accounts/")
      ? Promise.resolve(new Response(JSON.stringify(keys)))
      : realFetch(url, ...args);
  server = await require("../index").start();
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  );
  root = `http://127.0.0.1:${server.address().port}`;
  const learner = await request("/api/auth/register", "POST", {
    name: "Learner",
    email: "learner@example.com",
    password: "learner-test-password",
    role: "admin",
  });
  assert.equal((await learner.clone().json()).user.role, "learner");
  learnerCookie = learner.headers.get("set-cookie").split(";")[0];
  const project = "studdy-buddy-hub-8cc52";
  const idToken = jwt.sign(
    {
      sub: "admin-verified-google",
      email: "admin@example.com",
      email_verified: true,
      name: "Administrator",
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "google.com" },
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: "admin-fixture",
      issuer: `https://securetoken.google.com/${project}`,
      audience: project,
      expiresIn: "1h",
    },
  );
  const admin = await request("/api/auth/google", "POST", { idToken });
  assert.equal(admin.status, 200);
  assert.equal((await admin.clone().json()).user.role, "admin");
  adminCookie = admin.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  global.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});
async function request(route, method = "GET", body, cookie) {
  return fetch(root + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("all administration modules deny unauthenticated and learner access", async () => {
  for (const route of [
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/messages",
    ...Object.keys(resources).map((k) => "/api/admin/resources/" + k),
  ]) {
    assert.equal((await request(route)).status, 401);
    assert.equal(
      (await request(route, "GET", null, learnerCookie)).status,
      403,
    );
  }
  assert.equal(
    (
      await request("/api/auth/register", "POST", {
        name: "Impostor",
        email: "admin@example.com",
        password: "impostor-password-123",
      })
    ).status,
    400,
  );
});
test("administrator manages validated business records and publishes CMS pages without exposing drafts", async () => {
  for (const key of [
    "contacts",
    "leads",
    "tasks",
    "pages",
    "inventory",
    "employees",
    "invoices",
  ]) {
    const fields = resources[key].fields;
    const body = Object.fromEntries(
      Object.entries(fields).map(([name, f]) => [
        name,
        f.type === "number"
          ? 10
          : f.type === "select"
            ? f.options[0]
            : f.type === "email"
              ? "contact@example.com"
              : f.type === "date"
                ? "2026-12-01"
                : name === "slug"
                  ? "learning-guide"
                  : "Example value",
      ]),
    );
    const route = "/api/admin/resources/" + key;
    const created = await request(route, "POST", body, adminCookie);
    assert.equal(created.status, 201, key);
    const row = await created.json();
    assert.equal((await request(route, "GET", null, adminCookie)).status, 200);
    if (key === "pages") {
      assert.equal((await request("/api/pages/learning-guide")).status, 404);
      assert.equal(
        (
          await request(
            route + "/" + row.id,
            "PUT",
            { ...body, status: "Published" },
            adminCookie,
          )
        ).status,
        200,
      );
      assert.equal((await request("/api/pages/learning-guide")).status, 200);
    }
    assert.equal(
      (await request(route + "/" + row.id, "DELETE", null, adminCookie)).status,
      200,
    );
  }
  assert.equal(
    (await request("/api/admin/resources/secrets", "GET", null, adminCookie))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/admin/resources/inventory",
        "POST",
        { name: "Bad", sku: "Bad", quantity: -5 },
        adminCookie,
      )
    ).status,
    400,
  );
  const overview = await (
    await request("/api/admin/overview", "GET", null, adminCookie)
  ).json();
  assert.ok(overview.auditLogs.length >= 14);
  const users = await (
    await request("/api/admin/users", "GET", null, adminCookie)
  ).json();
  assert.ok(users.every((u) => !("hash" in u) && !("salt" in u)));
  const learner = users.find((u) => u.role === "learner");
  assert.equal(
    (
      await request(
        "/api/admin/users/" + learner.id,
        "PATCH",
        { disabled: true },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/session", "GET", null, learnerCookie)).status,
    401,
  );
});
