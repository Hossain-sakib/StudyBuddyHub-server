const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { MongoClient } = require("mongodb");
require("dotenv").config();
const catalog = require("./data/catalog.json");
const scrypt = promisify(crypto.scrypt);
const verifyGoogleToken = require("./firebase-token").createGoogleVerifier();
const isProduction = process.env.NODE_ENV === "production";
const secret =
  process.env.ACCESS_TOKEN_SECRET || crypto.randomBytes(48).toString("hex");
const origins = (
  process.env.CLIENT_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((s) => s.trim());
const dataFile =
  process.env.DATA_FILE || path.join(__dirname, ".local", "workspace.json");
const tokenCookie = isProduction ? "__Host-studybuddy" : "studybuddy";
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "no-store");
  next();
});
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.body === null || Array.isArray(req.body))
    return res.status(400).json({ error: "Send a JSON object." });
  next();
});
app.use((req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    !origins.includes(req.headers.origin)
  )
    return res.status(403).json({ error: "This origin is not allowed." });
  next();
});
let db;
let mongo;
let fileData = { users: [], states: {}, messages: [] };
let writes = Promise.resolve();
const authAttempts = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const rawIp = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? req.headers["x-nf-client-connection-ip"] || req.ip
    : req.ip;
  const key = crypto.createHash("sha256").update(String(rawIp)).digest("hex");
  if (db) {
    const id = `${key}:${Math.floor(now / 900000)}`;
    db.collection("auth_limits")
      .findOneAndUpdate(
        { _id: id },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date(now + 900000) },
        },
        { upsert: true, returnDocument: "after" },
      )
      .then((bucket) => {
        if (bucket.count > 30)
          return res.set("Retry-After", "900").status(429).json({
            error: "Too many attempts. Please try again in 15 minutes.",
          });
        next();
      })
      .catch(next);
    return;
  }
  let bucket = authAttempts.get(key);
  if (!bucket || bucket.expires < now)
    bucket = { count: 0, expires: now + 900000 };
  bucket.count++;
  authAttempts.set(key, bucket);
  for (const [ip, entry] of authAttempts)
    if (entry.expires < now) authAttempts.delete(ip);
  if (bucket.count > 30)
    return res
      .set("Retry-After", "900")
      .status(429)
      .json({ error: "Too many attempts. Please try again in 15 minutes." });
  next();
}
function initial(name) {
  return {
    name,
    completed: {},
    enrolled: ["design", "web"],
    quizzes: {},
    assignments: [],
    messages: [],
    goal: 3,
    activity: [],
  };
}
async function persist() {
  if (db) return;
  const content = JSON.stringify(fileData);
  writes = writes
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(dataFile), { recursive: true, mode: 0o700 });
      const temporary = `${dataFile}.tmp`;
      await fs.writeFile(temporary, content, { mode: 0o600 });
      await fs.rename(temporary, dataFile);
    });
  await writes;
}
async function findUser(query) {
  return db
    ? db.collection("users").findOne(query)
    : fileData.users.find((u) =>
        Object.entries(query).every(([key, value]) => u[key] === value),
      );
}
async function getState(id, name) {
  return db
    ? (await db.collection("states").findOne({ userId: id }))?.value ||
        initial(name)
    : fileData.states[id] || initial(name);
}
async function putState(id, value) {
  if (db)
    await db
      .collection("states")
      .updateOne({ userId: id }, { $set: { value } }, { upsert: true });
  else {
    fileData.states[id] = value;
    await persist();
  }
}
function publicUser(user, state) {
  return {
    id: user.id,
    name: state.name,
    email: user.email,
    role: user.role || "learner",
  };
}
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400000,
  };
}
const handle = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const authenticated = handle(async (req, res, next) => {
  try {
    const token = jwt.verify(req.cookies[tokenCookie] || "", secret, {
      algorithms: ["HS256"],
      issuer: "studybuddy",
    });
    req.user = await findUser({ id: token.sub });
  } catch {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  if (!req.user || req.user.disabled)
    return res.status(401).json({ error: "Sign in to continue." });
  next();
});
function validCredentials(body) {
  return (
    body &&
    typeof body.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) &&
    body.email.length <= 254 &&
    typeof body.password === "string" &&
    body.password.length >= 10 &&
    body.password.length <= 128
  );
}
app.get("/", (_, res) => res.send("StudyBuddy API is running"));
app.get("/api/health", (_, res) =>
  res.json({
    status: "ok",
    storage: db ? "mongodb" : "local-file",
    persistentSessions: !!process.env.ACCESS_TOKEN_SECRET,
  }),
);
app.get(
  "/api/courses",
  handle(async (_, res) => {
    const stored = db
      ? await db
          .collection("courses")
          .find({}, { projection: { _id: 0 } })
          .limit(100)
          .toArray()
      : [];
    res.json(stored.length ? stored : catalog);
  }),
);
app.get(
  "/api/discover",
  handle(async (_, res) => {
    const items = db
      ? await db
          .collection("assignments")
          .find({ isSample: true }, { projection: { _id: 0, submissions: 0 } })
          .limit(3)
          .toArray()
      : require("./seed-samples").sampleAssignments.map(
          ({ submissions, ...item }) => item,
        );
    res.json({ challenges: items });
  }),
);
app.post(
  "/api/auth/register",
  rateLimit,
  handle(async (req, res) => {
    if (
      !validCredentials(req.body) ||
      typeof req.body.name !== "string" ||
      !req.body.name.trim() ||
      req.body.name.length > 50
    )
      return res.status(400).json({
        error:
          "Enter a name, a valid email, and a password of 10–128 characters.",
      });
    const email = req.body.email.trim().toLowerCase();
    if (
      process.env.ADMIN_EMAIL &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase()
    )
      return res.status(400).json({
        error: "Use verified Google sign-in for this administrator address.",
      });
    if (await findUser({ email }))
      return res
        .status(409)
        .json({ error: "That email is already registered. Try signing in." });
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = (await scrypt(req.body.password, salt, 64)).toString("hex");
    const user = {
      id: crypto.randomUUID(),
      email,
      name: req.body.name.trim(),
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    if (db) {
      try {
        await db.collection("users").insertOne(user);
      } catch (error) {
        if (error.code === 11000)
          return res
            .status(409)
            .json({ error: "That email is already registered." });
        throw error;
      }
    } else {
      if (await findUser({ email }))
        return res
          .status(409)
          .json({ error: "That email is already registered." });
      fileData.users.push(user);
      await persist();
    }
    const state = initial(user.name);
    await putState(user.id, state);
    res.cookie(
      tokenCookie,
      jwt.sign({}, secret, {
        algorithm: "HS256",
        subject: user.id,
        issuer: "studybuddy",
        expiresIn: "7d",
      }),
      cookieOptions(),
    );
    res.status(201).json({ user: publicUser(user, state), state });
  }),
);
app.post(
  "/api/auth/login",
  rateLimit,
  handle(async (req, res) => {
    if (!validCredentials(req.body))
      return res.status(400).json({
        error: "Enter a valid email and password (at least 10 characters).",
      });
    const user = await findUser({ email: req.body.email.trim().toLowerCase() });
    const candidate = await scrypt(
      req.body.password,
      user?.salt || "unregistered-user-timing-salt",
      64,
    );
    if (
      !user ||
      user.disabled ||
      !user.hash ||
      !crypto.timingSafeEqual(Buffer.from(user.hash, "hex"), candidate)
    )
      return res.status(401).json({ error: "Email or password is incorrect." });
    const state = await getState(user.id, user.name);
    res.cookie(
      tokenCookie,
      jwt.sign({}, secret, {
        algorithm: "HS256",
        subject: user.id,
        issuer: "studybuddy",
        expiresIn: "7d",
      }),
      cookieOptions(),
    );
    res.json({ user: publicUser(user, state), state });
  }),
);
app.post(
  "/api/auth/google",
  rateLimit,
  handle(async (req, res) => {
    let identity;
    try {
      identity = await verifyGoogleToken(req.body.idToken);
    } catch {
      return res.status(401).json({
        error: "Google sign-in could not be verified. Please try again.",
      });
    }
    let user = await findUser({ firebaseUid: identity.uid });
    if (!user) {
      if (await findUser({ email: identity.email }))
        return res.status(409).json({
          error:
            "This email already uses password sign-in. Please sign in with your password; accounts are not linked automatically.",
        });
      user = {
        id: crypto.randomUUID(),
        firebaseUid: identity.uid,
        provider: "google",
        email: identity.email,
        name: identity.name || "Learner",
        createdAt: new Date().toISOString(),
      };
      if (db) {
        try {
          await db.collection("users").insertOne(user);
        } catch (error) {
          if (error.code !== 11000) throw error;
          user = await findUser({ firebaseUid: identity.uid });
          if (!user)
            return res.status(409).json({
              error:
                "This email already has an account. Use its existing sign-in method.",
            });
        }
      } else {
        fileData.users.push(user);
        await persist();
      }
    }
    if (user.disabled)
      return res.status(403).json({
        error: "This account is disabled. Contact the administrator.",
      });
    if (
      process.env.ADMIN_EMAIL &&
      identity.email === process.env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      user.role = "admin";
      if (db)
        await db
          .collection("users")
          .updateOne({ id: user.id }, { $set: { role: "admin" } });
      else await persist();
    }
    const state = await getState(user.id, user.name);
    res.cookie(
      tokenCookie,
      jwt.sign({}, secret, {
        algorithm: "HS256",
        subject: user.id,
        issuer: "studybuddy",
        expiresIn: "7d",
      }),
      cookieOptions(),
    );
    res.json({ user: publicUser(user, state), state });
  }),
);
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(tokenCookie, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});
app.get(
  "/api/session",
  authenticated,
  handle(async (req, res) => {
    const state = await getState(req.user.id, req.user.name);
    res.json({ user: publicUser(req.user, state), state });
  }),
);
function validateState(input) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 50 ||
    !Number.isInteger(input.goal) ||
    input.goal < 1 ||
    input.goal > 7
  )
    throw new Error("Invalid profile or weekly goal.");
  const ids = new Set(catalog.map((c) => c.id));
  if (
    !Array.isArray(input.enrolled) ||
    input.enrolled.some((id) => !ids.has(id))
  )
    throw new Error("Invalid course enrollment.");
  const completed = {};
  for (const course of catalog) {
    const list = input.completed?.[course.id] || [];
    if (
      !Array.isArray(list) ||
      list.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= course.lessons.length,
      )
    )
      throw new Error("Invalid lesson progress.");
    if (list.length && !input.enrolled.includes(course.id))
      throw new Error("Enroll before completing a lesson.");
    if (list.length) completed[course.id] = [...new Set(list)];
  }
  const quizzes = {};
  for (const course of catalog) {
    const q = input.quizzes?.[course.id];
    if (!q) continue;
    if (
      !Number.isInteger(q.score) ||
      q.score < 0 ||
      q.score > course.quiz.length ||
      q.total !== course.quiz.length ||
      !Number.isFinite(Date.parse(q.date))
    )
      throw new Error("Invalid quiz result.");
    quizzes[course.id] = { score: q.score, total: q.total, date: q.date };
  }
  if (!Array.isArray(input.assignments) || input.assignments.length > 200)
    throw new Error("Limit your workspace to 200 assignments.");
  const assignmentIds = new Set();
  const assignments = input.assignments.map((a) => {
    if (
      !a ||
      typeof a.id !== "string" ||
      a.id.length > 80 ||
      assignmentIds.has(a.id) ||
      typeof a.title !== "string" ||
      !a.title.trim() ||
      a.title.length > 120 ||
      typeof a.description !== "string" ||
      a.description.length > 2000 ||
      typeof a.submission !== "string" ||
      a.submission.length > 4000 ||
      typeof a.done !== "boolean" ||
      !["Design", "Development", "Personal growth", "Other"].includes(
        a.category,
      ) ||
      (a.due &&
        (typeof a.due !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(a.due) ||
          !Number.isFinite(Date.parse(a.due))))
    )
      throw new Error("Invalid assignment.");
    assignmentIds.add(a.id);
    return {
      id: a.id,
      title: a.title.trim(),
      description: a.description,
      submission: a.submission,
      done: a.done,
      category: a.category,
      due: a.due || "",
    };
  });
  if (
    !Array.isArray(input.activity) ||
    input.activity.length > 3660 ||
    input.activity.some(
      (d) =>
        typeof d !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)),
    )
  )
    throw new Error("Invalid learning activity.");
  return {
    name: input.name.trim(),
    goal: input.goal,
    enrolled: [...new Set(input.enrolled)],
    completed,
    quizzes,
    assignments,
    activity: [...new Set(input.activity)],
    messages: [],
  };
}
app.put(
  "/api/state",
  authenticated,
  handle(async (req, res) => {
    let state;
    try {
      state = validateState(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    await putState(req.user.id, state);
    res.json({ ok: true });
  }),
);
const rooms = ["general", "design", "development"];
app.get(
  "/api/messages",
  authenticated,
  handle(async (req, res) => {
    if (!rooms.includes(req.query.room))
      return res.status(400).json({ error: "Choose a valid study space." });
    const messages = db
      ? (
          await db
            .collection("messages")
            .find({ room: req.query.room }, { projection: { _id: 0 } })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray()
        ).reverse()
      : fileData.messages.filter((m) => m.room === req.query.room).slice(-100);
    res.json(messages);
  }),
);
const messageLimits = new Map();
app.post(
  "/api/messages",
  authenticated,
  handle(async (req, res) => {
    if (
      !rooms.includes(req.body.room) ||
      typeof req.body.text !== "string" ||
      !req.body.text.trim() ||
      req.body.text.length > 1000
    )
      return res.status(400).json({
        error:
          "Choose a study space and enter a message of up to 1,000 characters.",
      });
    const now = Date.now();
    if (now - (messageLimits.get(req.user.id) || 0) < 1000)
      return res
        .status(429)
        .json({ error: "Take a breath before sending another message." });
    messageLimits.set(req.user.id, now);
    for (const [id, timestamp] of messageLimits)
      if (now - timestamp > 60000) messageLimits.delete(id);
    const state = await getState(req.user.id, req.user.name);
    const message = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      name: state.name,
      room: req.body.room,
      text: req.body.text.trim(),
      createdAt: new Date().toISOString(),
    };
    if (db) await db.collection("messages").insertOne({ ...message });
    else {
      fileData.messages.push(message);
      fileData.messages = fileData.messages.slice(-3000);
      await persist();
    }
    res.status(201).json(message);
  }),
);
require("./media/routes")(app, {
  authenticated,
  handle,
  storage: () => ({ db, fileData }),
});
require("./admin/routes")(app, {
  authenticated,
  handle,
  storage: () => ({ db, fileData }),
  persist,
});
require("./assignments")(app, {
  authenticated,
  handle,
  storage: () => ({ db, fileData }),
  persist,
});
app.use((_, res) =>
  res.status(404).json({ error: "That endpoint does not exist." }),
);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "Invalid JSON request." });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "This request is too large." });
  console.error("API request failed:", error.name);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
let initialization;
async function initialize() {
  if (!initialization)
    initialization = initializeStorage().catch(async (error) => {
      initialization = undefined;
      db = undefined;
      if (mongo) await mongo.close().catch(() => {});
      throw error;
    });
  return initialization;
}
async function initializeStorage() {
  if (
    isProduction &&
    (!process.env.ACCESS_TOKEN_SECRET ||
      process.env.ACCESS_TOKEN_SECRET.length < 32 ||
      !process.env.MONGODB_URI ||
      !process.env.CLIENT_ORIGINS)
  )
    throw new Error(
      "Production requires ACCESS_TOKEN_SECRET (32+ characters), MONGODB_URI, and CLIENT_ORIGINS.",
    );
  if (process.env.MONGODB_URI) {
    mongo = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    await mongo.connect();
    db = mongo.db("studybuddy");
    await db.command({ ping: 1 });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db
      .collection("users")
      .createIndex({ firebaseUid: 1 }, { unique: true, sparse: true });
    await db.collection("states").createIndex({ userId: 1 }, { unique: true });
    await db.collection("assignments").createIndex({ id: 1 }, { unique: true });
    await db.collection("messages").createIndex({ room: 1, createdAt: -1 });
    await db
      .collection("auth_limits")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection("audit_logs").createIndex({ createdAt: -1 });
    await db.collection("cms_pages").createIndex({ slug: 1 }, { unique: true });
    await db.collection("courses").createIndex({ id: 1 }, { unique: true });
    await db.collection("seed_runs").createIndex({ id: 1 }, { unique: true });
    if (process.env.SEED_SAMPLE_CONTENT === "true") {
      const seeded = await require("./seed-samples").seedSamples(db);
      console.log("Sample-content seed:", JSON.stringify(seeded));
    }
  } else {
    try {
      fileData = JSON.parse(await fs.readFile(dataFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    console.log(
      "Development storage: local file. Set MONGODB_URI for shared database storage.",
    );
  }
}
async function start() {
  await initialize();
  const port = Number(process.env.PORT || 5000);
  const server = app.listen(port, "0.0.0.0", () =>
    console.log(`StudyBuddy API listening on ${port}`),
  );
  async function stop() {
    server.close(async () => {
      await writes.catch(() => {});
      if (mongo) await mongo.close();
      process.exit(0);
    });
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { app, start, initialize, validateState };
