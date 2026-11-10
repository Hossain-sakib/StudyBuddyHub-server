const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
let server, root, directory, cookie;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "studybuddy-test-"));
  process.env.DATA_FILE = path.join(directory, "workspace.json");
  process.env.PORT = "0";
  process.env.ACCESS_TOKEN_SECRET =
    "integration-test-key-not-for-production-123456789";
  delete process.env.MONGODB_URI;
  process.env.NODE_ENV = "test";
  server = await require("../index").start();
  await new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});
async function request(endpoint, method = "GET", body, session = cookie) {
  return fetch(root + endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("authentication, isolated progress, assignments, messages, and disk persistence", async () => {
  assert.equal((await request("/api/session")).status, 401);
  assert.equal(
    (
      await request("/api/auth/register", "POST", {
        name: "Learner",
        email: "not-an-email",
        password: "short",
      })
    ).status,
    400,
  );
  const registered = await request("/api/auth/register", "POST", {
    name: "Learner",
    email: "learner@example.com",
    password: "test-password-123",
  });
  assert.equal(registered.status, 201);
  cookie = registered.headers.get("set-cookie").split(";")[0];
  assert.match(registered.headers.get("set-cookie"), /HttpOnly/);
  let { state } = await registered.json();
  assert.equal(
    (
      await request("/api/auth/login", "POST", {
        email: "learner@example.com",
        password: "wrong-password-123",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/register", "POST", {
        name: "Duplicate",
        email: "learner@example.com",
        password: "test-password-123",
      })
    ).status,
    409,
  );
  state.completed.design = [0, 1];
  state.quizzes.design = { score: 2, total: 3, date: new Date().toISOString() };
  state.assignments = [
    {
      id: "a1",
      title: "Design practice",
      description: "Sketch a card",
      category: "Design",
      due: "2026-11-01",
      done: true,
      submission: "My sketch reflection",
    },
  ];
  state.activity = ["2026-10-20"];
  assert.equal((await request("/api/state", "PUT", state)).status, 200);
  assert.deepEqual(
    (await (await request("/api/session")).json()).state.completed.design,
    [0, 1],
  );
  assert.equal(
    (await request("/api/state", "PUT", { ...state, goal: 100 })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/state", "PUT", {
        ...state,
        completed: { design: [999] },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/messages", "POST", { room: "invalid", text: "hello" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/api/messages", "POST", {
        room: "general",
        text: "Hello learners!",
      })
    ).status,
    201,
  );
  assert.equal(
    (await (await request("/api/messages?room=general")).json())[0].text,
    "Hello learners!",
  );
  assert.equal(
    (
      await request("/api/messages", "POST", {
        room: "general",
        text: "too fast",
      })
    ).status,
    429,
  );
  const second = await request(
    "/api/auth/register",
    "POST",
    {
      name: "Buddy",
      email: "buddy@example.com",
      password: "another-password-123",
    },
    "",
  );
  const secondCookie = second.headers.get("set-cookie").split(";")[0];
  assert.deepEqual((await second.json()).state.completed, {});
  assert.equal(
    (
      await (
        await request(
          "/api/messages?room=general",
          "GET",
          undefined,
          secondCookie,
        )
      ).json()
    ).length,
    1,
  );
  assert.deepEqual(
    (
      await (
        await request("/api/session", "GET", undefined, secondCookie)
      ).json()
    ).state.assignments,
    [],
  );
  const challenge = await request("/api/assignments", "POST", {
    title: "Build a card",
    description: "Use semantic markup",
    category: "Development",
    marks: 100,
    due: "",
  });
  assert.equal(challenge.status, 201);
  const assignment = await challenge.json();
  const id = assignment.id;
  assert.equal(
    (
      await request(
        `/api/assignments/${id}`,
        "PUT",
        { title: "Attack" },
        secondCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/assignments/${id}/submissions`, "POST", {
        text: "My own work",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/api/assignments/${id}/submissions`,
        "POST",
        { text: "My semantic card" },
        secondCookie,
      )
    ).status,
    201,
  );
  let shared = await (await request("/api/assignments")).json();
  const submissionUser = shared[0].submissions[0].userId;
  assert.equal(shared[0].submissions[0].text, "My semantic card");
  assert.equal(
    (
      await request(
        `/api/assignments/${id}/submissions/${submissionUser}`,
        "PATCH",
        { grade: 99, feedback: "Wrong author" },
        secondCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/assignments/${id}/submissions/${submissionUser}`,
        "PATCH",
        { grade: 101, feedback: "" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/api/assignments/${id}/submissions/${submissionUser}`,
        "PATCH",
        { grade: 85, feedback: "Clear structure!" },
      )
    ).status,
    200,
  );
  const studentView = await (
    await request("/api/assignments", "GET", undefined, secondCookie)
  ).json();
  assert.equal(studentView[0].submissions[0].grade, 85);
  assert.equal(
    (
      await request(
        `/api/assignments/${id}/submissions`,
        "POST",
        { text: "Changed graded work" },
        secondCookie,
      )
    ).status,
    409,
  );
  const outsider = await request(
    "/api/auth/register",
    "POST",
    {
      name: "Outside",
      email: "outside@example.com",
      password: "outside-password-123",
    },
    "",
  );
  const outsiderCookie = outsider.headers.get("set-cookie").split(";")[0];
  const outsiderView = await (
    await request("/api/assignments", "GET", undefined, outsiderCookie)
  ).json();
  assert.deepEqual(outsiderView[0].submissions, []);
  assert.equal(
    (await request(`/api/assignments/${id}`, "DELETE", undefined, secondCookie))
      .status,
    403,
  );
  assert.equal((await request(`/api/assignments/${id}`, "DELETE")).status, 200);
  const forbidden = await fetch(root + "/api/state", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await request("/api/auth/logout", "POST")).status, 200);
  const signedIn = await request(
    "/api/auth/login",
    "POST",
    { email: "learner@example.com", password: "test-password-123" },
    "",
  );
  assert.equal(signedIn.status, 200);
  assert.equal(
    (await signedIn.json()).state.assignments[0].submission,
    "My sketch reflection",
  );
  const disk = JSON.parse(await readFile(process.env.DATA_FILE, "utf8"));
  assert.equal(disk.users.length, 3);
  assert.notEqual(disk.users[0].hash, "test-password-123");
  assert.equal(disk.users[0].password, undefined);
  assert.equal(
    Object.values(disk.states).find((s) => s.name === "Learner").quizzes.design
      .score,
    2,
  );
});
