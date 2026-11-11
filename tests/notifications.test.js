const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
let server, base, directory, owner, learner;
async function request(route, method = "GET", body, cookie) {
  return fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function register(name, email) {
  const response = await request("/api/auth/register", "POST", {
    name,
    email,
    password: "notification-test-password",
  });
  assert.equal(response.status, 201);
  return {
    cookie: response.headers.get("set-cookie").split(";")[0],
    ...(await response.json()),
  };
}
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "studybuddy-notify-"));
  process.env.NODE_ENV = "test";
  process.env.PORT = "0";
  process.env.MONGODB_URI = "";
  process.env.ADMIN_EMAIL = "";
  process.env.DATA_FILE = path.join(directory, "workspace.json");
  server = await require("../index").start();
  await new Promise((r) =>
    server.listening ? r() : server.once("listening", r),
  );
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await register("Owner", "owner@example.com");
  learner = await register("Learner", "learner-notify@example.com");
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await fs.rm(directory, { recursive: true, force: true });
});
test("notification read state and bookmarks persist without exposing another account’s updates", async () => {
  assert.equal((await request("/api/notifications")).status, 401);
  const welcome = await (
    await request("/api/notifications", "GET", null, owner.cookie)
  ).json();
  assert.equal(welcome.unreadCount, 1);
  assert.equal(welcome.items[0].title, "Your next chapter starts here");
  assert.equal(
    (
      await request(
        "/api/notifications/" + welcome.items[0].id,
        "PATCH",
        {},
        learner.cookie,
      )
    ).status,
    404,
  );
  const state = {
    ...owner.state,
    bookmarks: ["design"],
    assignments: [
      {
        id: "due-task",
        title: "Review this lesson",
        description: "",
        category: "Design",
        due: "2026-01-01",
        done: false,
        submission: "",
      },
    ],
  };
  assert.equal(
    (await request("/api/state", "PUT", state, owner.cookie)).status,
    200,
  );
  const next = await (
    await request("/api/notifications", "GET", null, owner.cookie)
  ).json();
  assert.equal(next.items.filter((n) => n.type === "reminder").length, 1);
  const again = await (
    await request("/api/notifications", "GET", null, owner.cookie)
  ).json();
  assert.equal(again.items.length, next.items.length);
  assert.equal(
    (await request("/api/notifications/read", "PATCH", {}, owner.cookie))
      .status,
    200,
  );
  assert.equal(
    (
      await (
        await request("/api/notifications", "GET", null, owner.cookie)
      ).json()
    ).unreadCount,
    0,
  );
  assert.deepEqual(
    (await (await request("/api/session", "GET", null, owner.cookie)).json())
      .state.bookmarks,
    ["design"],
  );
  assert.equal(
    (
      await (
        await request("/api/notifications", "GET", null, learner.cookie)
      ).json()
    ).items.length,
    1,
  );
});
test("assignment submissions notify the author and grades notify only the submitting learner", async () => {
  const created = await request(
    "/api/assignments",
    "POST",
    {
      title: "Notification practice",
      description: "Try it",
      category: "Design",
      marks: 100,
      due: "",
    },
    owner.cookie,
  );
  assert.equal(created.status, 201);
  const assignment = await created.json();
  assert.equal(
    (
      await request(
        "/api/assignments/" + assignment.id + "/submissions",
        "POST",
        { text: "My sample work" },
        learner.cookie,
      )
    ).status,
    201,
  );
  const authorUpdates = await (
    await request("/api/notifications", "GET", null, owner.cookie)
  ).json();
  assert.ok(
    authorUpdates.items.some(
      (n) =>
        n.title === "New work to review" && n.target === "shared-assignments",
    ),
  );
  assert.equal(
    (
      await request(
        `/api/assignments/${assignment.id}/submissions/${learner.user.id}`,
        "PATCH",
        { grade: 92, feedback: "Clear process." },
        owner.cookie,
      )
    ).status,
    200,
  );
  const updates = await (
    await request("/api/notifications", "GET", null, learner.cookie)
  ).json();
  assert.ok(
    updates.items.some(
      (n) => n.title === "Your feedback is ready" && n.body.includes("92/100"),
    ),
  );
  assert.ok(
    !authorUpdates.items.some((n) => n.title === "Your feedback is ready"),
  );
});
