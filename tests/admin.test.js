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

test("complete curricula validate every lesson and question; lead conversion and stock adjustments are repeatable and bounded", async () => {
  const course = {
    title: "Complete course",
    category: "Design",
    lessons: [
      { title: "One", body: "First content" },
      { title: "Two", body: "Second content" },
    ],
    quiz: [
      { question: "Choose one", choices: ["Yes", "No"], answer: 0 },
      { question: "Choose two", choices: ["One", "Two", "Three"], answer: 1 },
    ],
  };
  let result = await request(
    "/api/admin/resources/courses",
    "POST",
    course,
    adminCookie,
  );
  assert.equal(result.status, 201);
  const row = await result.json();
  assert.equal(row.lessons.length, 2);
  assert.equal(row.quiz.length, 2);
  result = await request(
    "/api/admin/resources/courses/" + row.id,
    "PUT",
    { ...course, lessons: [...course.lessons].reverse() },
    adminCookie,
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).lessons[0].title, "Two");
  assert.equal(
    (
      await request(
        "/api/admin/resources/courses",
        "POST",
        { ...course, quiz: [{ ...course.quiz[0], answer: 9 }] },
        adminCookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/admin/resources/courses",
        "POST",
        { ...course, lessons: [] },
        adminCookie,
      )
    ).status,
    400,
  );
  const lead = await (
    await request(
      "/api/admin/resources/leads",
      "POST",
      { name: "Lead", email: "lead@example.com", status: "Qualified" },
      adminCookie,
    )
  ).json();
  const url = "/api/admin/leads/" + lead.id + "/convert";
  assert.equal((await request(url, "POST", {}, learnerCookie)).status, 401);
  const first = await (await request(url, "POST", {}, adminCookie)).json();
  const second = await (await request(url, "POST", {}, adminCookie)).json();
  assert.equal(first.id, second.id);
  const contacts = await (
    await request("/api/admin/resources/contacts", "GET", null, adminCookie)
  ).json();
  assert.equal(contacts.filter((c) => c.sourceLeadId === lead.id).length, 1);
  const item = await (
    await request(
      "/api/admin/resources/inventory",
      "POST",
      { name: "Workbook", sku: "BOOK-1", quantity: 5, reorderAt: 2 },
      adminCookie,
    )
  ).json();
  const adjust = "/api/admin/inventory/" + item.id + "/adjust";
  assert.equal(
    (
      await request(
        adjust,
        "POST",
        { delta: -6, reason: "Too much" },
        adminCookie,
      )
    ).status,
    409,
  );
  const changed = await request(
    adjust,
    "POST",
    { delta: -3, reason: "Workshop" },
    adminCookie,
  );
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).quantity, 2);
  assert.equal(
    (
      await request(
        adjust,
        "POST",
        { delta: 2.5, reason: "Invalid" },
        adminCookie,
      )
    ).status,
    400,
  );
});

test("CMS article HTML and sitemap include only published pages with escaped content and per-page metadata", async () => {
  const route = "/api/admin/resources/pages";
  const page = {
    title: "A <useful> guide",
    slug: "seo-guide",
    description: "A clear learning resource",
    body: "<script>window.pwned=true</script>\n\nA useful paragraph.",
    status: "Draft",
  };
  const row = await (await request(route, "POST", page, adminCookie)).json();
  assert.equal((await request("/resources/seo-guide")).status, 404);
  assert.ok(
    !(await (await request("/sitemap.xml")).text()).includes("seo-guide"),
  );
  assert.equal(
    (
      await request(
        route + "/" + row.id,
        "PUT",
        { ...page, status: "Published" },
        adminCookie,
      )
    ).status,
    200,
  );
  const html = await (await request("/resources/seo-guide")).text();
  assert.ok(
    html.includes("<title>A &lt;useful&gt; guide — Studybuddy</title>"),
  );
  assert.ok(html.includes("&lt;script&gt;window.pwned=true&lt;/script&gt;"));
  assert.ok(!html.includes("<script>window.pwned"));
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(html.includes("application/ld+json"));
  assert.ok(
    (await (await request("/sitemap.xml")).text()).includes(
      "/resources/seo-guide",
    ),
  );
});

test("curriculum changes protect existing learner completion from shifted lesson positions", async () => {
  const courses = await (
    await request("/api/admin/resources/courses", "GET", null, adminCookie)
  ).json();
  const course = courses.find((c) => c.title === "Complete course");
  assert.ok(course);
  const response = await request("/api/auth/register", "POST", {
    name: "Course Learner",
    email: "course-learner@example.com",
    password: "course-test-password",
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const { state } = await response.json();
  state.enrolled = [course.id];
  state.completed = { [course.id]: [0] };
  assert.equal((await request("/api/state", "PUT", state, cookie)).status, 200);
  assert.equal(
    (
      await request(
        "/api/admin/resources/courses/" + course.id,
        "PUT",
        { ...course, lessons: [...course.lessons].reverse() },
        adminCookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/admin/resources/courses/" + course.id,
        "PUT",
        { ...course, description: "Improved description" },
        adminCookie,
      )
    ).status,
    200,
  );
});

test("disabling an account revokes old sessions even after an administrator enables it again", async () => {
  const users = await (
    await request("/api/admin/users", "GET", null, adminCookie)
  ).json();
  const learner = users.find((u) => u.email === "learner@example.com");
  assert.ok(learner);
  assert.equal(
    (
      await request(
        "/api/admin/users/" + learner.id,
        "PATCH",
        { disabled: false },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/session", "GET", null, learnerCookie)).status,
    401,
  );
  const fresh = await request("/api/auth/login", "POST", {
    email: "learner@example.com",
    password: "learner-test-password",
  });
  assert.equal(fresh.status, 200);
  const cookie = fresh.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await request("/api/session", "GET", null, cookie)).status,
    200,
  );
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
    (await request("/api/session", "GET", null, cookie)).status,
    401,
  );
});

test("public course pages and catalog summaries provide indexable content without shipping practice answers", async () => {
  const response = await request("/api/catalog");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  const catalog = await response.json();
  assert.ok(catalog.length >= 18);
  assert.ok(
    catalog.every(
      (c) =>
        !("quiz" in c) &&
        c.lessons.every((l) => Object.keys(l).join(",") === "title"),
    ),
  );
  const course = catalog.find((c) => c.id === "design");
  assert.ok(course);
  const html = await (await request("/courses/design")).text();
  assert.ok(html.includes("<h1"));
  assert.ok(html.includes(course.title));
  assert.ok(html.includes("/courses/design"));
  assert.ok(html.includes('rel="canonical"'));
  const graph = JSON.parse(
    html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
  );
  assert.equal(graph["@graph"][0]["@type"], "Course");
  assert.equal(graph["@graph"][0].name, course.title);
  const missing = await request("/courses/does-not-exist");
  assert.equal(missing.status, 404);
  assert.ok((await missing.text()).includes("noindex,follow"));
  const sitemap = await (await request("/sitemap.xml")).text();
  assert.ok(sitemap.includes("/courses/design"));
  assert.ok(sitemap.includes("<lastmod>"));
  const { render } = require("../public-routes");
  const title = 'A <clear> "guide"';
  const article = render(
    { title, slug: "escaped-guide", body: "Safe text" },
    "/assets/test.css",
  );
  const data = JSON.parse(
    article.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
  );
  assert.equal(data["@graph"][0].headline, title);
});
