const crypto = require("node:crypto");
const { resources, validate } = require("./resources");
module.exports = (app, { authenticated, handle, storage, persist }) => {
  app.get(
    "/api/content",
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const pages = db
        ? await db
            .collection("cms_pages")
            .find(
              { status: "Published" },
              { projection: { _id: 0, title: 1, slug: 1, description: 1 } },
            )
            .limit(100)
            .toArray()
        : (fileData.admin?.cms_pages || [])
            .filter((p) => p.status === "Published")
            .map(({ title, slug, description }) => ({
              title,
              slug,
              description,
            }));
      res.json(pages);
    }),
  );

  const admin = [
    authenticated,
    (req, res, next) =>
      req.user.role === "admin" && !req.user.disabled
        ? next()
        : res.status(403).json({ error: "Administrator access is required." }),
  ];
  async function list(collection) {
    const { db, fileData } = storage();
    return db
      ? db
          .collection(collection)
          .find({}, { projection: { _id: 0, hash: 0, salt: 0 } })
          .limit(500)
          .toArray()
      : collection === "users"
        ? fileData.users.map(({ hash, salt, ...u }) => u)
        : collection === "assignments"
          ? fileData.assignments || []
          : collection === "messages"
            ? fileData.messages
            : fileData.admin?.[collection] || [];
  }
  async function audit(req, action, resource, id) {
    const event = {
      id: crypto.randomUUID(),
      actorId: req.user.id,
      action,
      resource,
      recordId: id,
      createdAt: new Date().toISOString(),
    };
    const { db, fileData } = storage();
    if (db) await db.collection("audit_logs").insertOne(event);
    else {
      fileData.audit ||= [];
      fileData.audit.push(event);
      await persist();
    }
  }
  app.get(
    "/api/admin/overview",
    ...admin,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const counts = {};
      for (const [key, r] of Object.entries(resources))
        counts[key] = db
          ? await db.collection(r.collection).countDocuments()
          : (await list(r.collection)).length;
      counts.users = db
        ? await db.collection("users").countDocuments()
        : fileData.users.length;
      counts.assignments = db
        ? await db.collection("assignments").countDocuments()
        : (fileData.assignments || []).length;
      const auditLogs = db
        ? await db
            .collection("audit_logs")
            .find({}, { projection: { _id: 0 } })
            .sort({ createdAt: -1 })
            .limit(30)
            .toArray()
        : (fileData.audit || []).slice(-30).reverse();
      res.json({
        counts,
        resources: Object.entries(resources).map(([key, r]) => ({
          key,
          title: r.title,
          group: r.group,
          fields: r.fields,
        })),
        auditLogs,
      });
    }),
  );
  app.get(
    "/api/admin/users",
    ...admin,
    handle(async (_, res) =>
      res.json(
        (await list("users")).map(
          ({ id, name, email, role, provider, disabled, createdAt }) => ({
            id,
            name,
            email,
            role: role || "learner",
            provider: provider || "password",
            disabled: !!disabled,
            createdAt,
          }),
        ),
      ),
    ),
  );
  app.patch(
    "/api/admin/users/:id",
    ...admin,
    handle(async (req, res) => {
      if (typeof req.body.disabled !== "boolean")
        return res
          .status(400)
          .json({ error: "Choose whether the account is disabled." });
      if (req.params.id === req.user.id)
        return res.status(400).json({
          error: "You cannot disable your own administrator account.",
        });
      const { db, fileData } = storage();
      if (db) {
        const result = await db
          .collection("users")
          .updateOne(
            { id: req.params.id, role: { $ne: "admin" } },
            { $set: { disabled: req.body.disabled } },
          );
        if (!result.matchedCount)
          return res.status(404).json({
            error: "Learner not found, or this is an administrator account.",
          });
      } else {
        const user = fileData.users.find(
          (u) => u.id === req.params.id && u.role !== "admin",
        );
        if (!user) return res.status(404).json({ error: "Learner not found." });
        user.disabled = req.body.disabled;
        await persist();
      }
      await audit(
        req,
        req.body.disabled ? "disable" : "enable",
        "users",
        req.params.id,
      );
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/admin/assignments",
    ...admin,
    handle(async (_, res) => res.json(await list("assignments"))),
  );
  app.delete(
    "/api/admin/assignments/:id",
    ...admin,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      if (db)
        await db.collection("assignments").deleteOne({ id: req.params.id });
      else {
        fileData.assignments = (fileData.assignments || []).filter(
          (a) => a.id !== req.params.id,
        );
        await persist();
      }
      await audit(req, "moderate-delete", "assignments", req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/admin/messages",
    ...admin,
    handle(async (_, res) => res.json(await list("messages"))),
  );
  app.delete(
    "/api/admin/messages/:id",
    ...admin,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      if (db) await db.collection("messages").deleteOne({ id: req.params.id });
      else {
        fileData.messages = fileData.messages.filter(
          (m) => m.id !== req.params.id,
        );
        await persist();
      }
      await audit(req, "moderate-delete", "messages", req.params.id);
      res.json({ ok: true });
    }),
  );
  // Resource validation runs before every resource route; no arbitrary database selectors.
  app.use("/api/admin/resources/:resource", ...admin, (req, res, next) => {
    req.resource = resources[req.params.resource];
    if (!req.resource)
      return res.status(404).json({ error: "Unknown admin module." });
    next();
  });
  app.get(
    "/api/admin/resources/:resource",
    handle(async (req, res) => res.json(await list(req.resource.collection))),
  );
  async function save(req, res, editing) {
    let data;
    try {
      data = validate(req.resource, req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const id = editing ? req.params.id : crypto.randomUUID();
    const now = new Date().toISOString();
    const { db, fileData } = storage();
    if (req.params.resource === "courses") {
      const current = editing
        ? (await list("courses")).find((c) => c.id === id)
        : null;
      if (
        !editing &&
        (!data.lessonTitle ||
          !data.lessonBody ||
          !data.question ||
          !data.answerOne ||
          !data.answerTwo ||
          !data.answerThree ||
          !data.correctAnswer)
      )
        return res.status(400).json({
          error:
            "A new course needs a first lesson and a complete practice question.",
        });
      if (data.lessonBody)
        data.lessons = [
          {
            title:
              data.lessonTitle ||
              current?.lessons?.[0]?.title ||
              "Getting started",
            body: data.lessonBody,
          },
          ...(current?.lessons?.slice(1) || []),
        ];
      if (
        data.question &&
        data.answerOne &&
        data.answerTwo &&
        data.answerThree &&
        data.correctAnswer
      )
        data.quiz = [
          {
            question: data.question,
            choices: [data.answerOne, data.answerTwo, data.answerThree],
            answer: ["A", "B", "C"].indexOf(data.correctAnswer),
          },
          ...(current?.quiz?.slice(1) || []),
        ];
      for (const key of [
        "lessonBody",
        "lessonTitle",
        "question",
        "answerOne",
        "answerTwo",
        "answerThree",
        "correctAnswer",
      ])
        delete data[key];
      if (!editing) Object.assign(data, { color: "purple", icon: "design" });
    }
    const row = { ...data, updatedAt: now };
    if (db) {
      if (editing) {
        const result = await db
          .collection(req.resource.collection)
          .updateOne({ id }, { $set: row });
        if (!result.matchedCount)
          return res.status(404).json({ error: "Record not found." });
      } else
        await db
          .collection(req.resource.collection)
          .insertOne({ id, ...row, createdAt: now });
    } else {
      fileData.admin ||= {};
      const rows = (fileData.admin[req.resource.collection] ||= []);
      if (editing) {
        const index = rows.findIndex((r) => r.id === id);
        if (index < 0)
          return res.status(404).json({ error: "Record not found." });
        rows[index] = { ...rows[index], ...row };
      } else rows.push({ id, ...row, createdAt: now });
      await persist();
    }
    await audit(req, editing ? "update" : "create", req.params.resource, id);
    res.status(editing ? 200 : 201).json({ id, ...row });
  }
  app.post(
    "/api/admin/resources/:resource",
    handle((req, res) => save(req, res, false)),
  );
  app.put(
    "/api/admin/resources/:resource/:id",
    handle((req, res) => save(req, res, true)),
  );
  app.delete(
    "/api/admin/resources/:resource/:id",
    handle(async (req, res) => {
      if (
        req.params.resource === "courses" &&
        (await list("courses")).length <= 1
      )
        return res
          .status(409)
          .json({ error: "Keep at least one course available." });
      const { db, fileData } = storage();
      if (db)
        await db
          .collection(req.resource.collection)
          .deleteOne({ id: req.params.id });
      else {
        fileData.admin ||= {};
        fileData.admin[req.resource.collection] = (
          fileData.admin[req.resource.collection] || []
        ).filter((r) => r.id !== req.params.id);
        await persist();
      }
      await audit(req, "delete", req.params.resource, req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/pages/:slug",
    handle(async (req, res) => {
      const { db } = storage();
      const page = db
        ? await db
            .collection("cms_pages")
            .findOne(
              { slug: req.params.slug, status: "Published" },
              { projection: { _id: 0 } },
            )
        : (await list("cms_pages")).find(
            (p) => p.slug === req.params.slug && p.status === "Published",
          );
      if (!page) return res.status(404).json({ error: "Page not found." });
      res.json(page);
    }),
  );
};
