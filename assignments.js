const crypto = require("node:crypto");
module.exports = function registerAssignments(
  app,
  { authenticated, handle, storage, persist, notifyUser },
) {
  function valid(body) {
    return (
      body &&
      typeof body.title === "string" &&
      body.title.trim() &&
      body.title.length <= 120 &&
      typeof body.description === "string" &&
      body.description.length <= 2000 &&
      Number.isInteger(body.marks) &&
      body.marks >= 1 &&
      body.marks <= 1000 &&
      ["Design", "Development", "Personal growth", "Other"].includes(
        body.category,
      ) &&
      (!body.due ||
        (typeof body.due === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(body.due) &&
          Number.isFinite(Date.parse(body.due))))
    );
  }
  async function list() {
    const { db, fileData } = storage();
    return db
      ? db
          .collection("assignments")
          .find({}, { projection: { _id: 0 } })
          .sort({ createdAt: -1 })
          .limit(200)
          .toArray()
      : (fileData.assignments || []).slice(-200).reverse();
  }
  async function find(id) {
    const { db, fileData } = storage();
    return db
      ? db.collection("assignments").findOne({ id }, { projection: { _id: 0 } })
      : (fileData.assignments || []).find((a) => a.id === id);
  }
  async function save(assignment) {
    const { db, fileData } = storage();
    if (db)
      await db
        .collection("assignments")
        .replaceOne({ id: assignment.id }, assignment, { upsert: true });
    else {
      fileData.assignments ||= [];
      const i = fileData.assignments.findIndex((a) => a.id === assignment.id);
      if (i < 0) fileData.assignments.push(assignment);
      else fileData.assignments[i] = assignment;
      await persist();
    }
  }
  function visible(a, user) {
    return {
      ...a,
      submissions: a.submissions.filter(
        (s) => a.ownerId === user.id || s.userId === user.id,
      ),
    };
  }
  app.get(
    "/api/assignments",
    authenticated,
    handle(async (req, res) =>
      res.json((await list()).map((a) => visible(a, req.user))),
    ),
  );
  app.post(
    "/api/assignments",
    authenticated,
    handle(async (req, res) => {
      if (!valid(req.body))
        return res.status(400).json({
          error:
            "Enter an assignment title, topic, and a mark total between 1 and 1,000.",
        });
      const { title, description, marks, category, due } = req.body;
      const a = {
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        ownerName: req.user.name,
        title: title.trim(),
        description,
        marks,
        category,
        due: due || "",
        createdAt: new Date().toISOString(),
        submissions: [],
      };
      await save(a);
      res.status(201).json(a);
    }),
  );
  app.put(
    "/api/assignments/:id",
    authenticated,
    handle(async (req, res) => {
      const a = await find(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found." });
      if (a.ownerId !== req.user.id)
        return res
          .status(403)
          .json({ error: "Only the assignment author can edit it." });
      if (!valid(req.body))
        return res.status(400).json({ error: "Invalid assignment details." });
      if (
        a.submissions.some((s) => s.grade !== null) &&
        req.body.marks !== a.marks
      )
        return res.status(409).json({
          error:
            "The mark total cannot change after grading. Create a new assignment instead.",
        });
      const { title, description, marks, category, due } = req.body;
      const details = {
        title: title.trim(),
        description,
        marks,
        category,
        due: due || "",
      };
      const { db, fileData } = storage();
      if (db) {
        const result = await db.collection("assignments").updateOne(
          {
            id: a.id,
            marks: a.marks,
            ...(marks !== a.marks
              ? { "submissions.grade": { $not: { $type: "number" } } }
              : {}),
          },
          { $set: details },
        );
        if (!result.matchedCount)
          return res
            .status(409)
            .json({ error: "The assignment changed. Refresh before editing." });
      } else {
        const current = fileData.assignments.find((t) => t.id === a.id);
        Object.assign(current, details);
        await persist();
      }
      res.json({ ...a, ...details });
    }),
  );
  app.delete(
    "/api/assignments/:id",
    authenticated,
    handle(async (req, res) => {
      const a = await find(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found." });
      if (a.ownerId !== req.user.id)
        return res
          .status(403)
          .json({ error: "Only the assignment author can remove it." });
      const { db, fileData } = storage();
      if (db) await db.collection("assignments").deleteOne({ id: a.id });
      else {
        fileData.assignments = fileData.assignments.filter(
          (t) => t.id !== a.id,
        );
        await persist();
      }
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/assignments/:id/submissions",
    authenticated,
    handle(async (req, res) => {
      const a = await find(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found." });
      if (a.ownerId === req.user.id)
        return res.status(400).json({
          error:
            "You can review submissions to your own assignment. Choose another assignment to submit work.",
        });
      if (
        typeof req.body.text !== "string" ||
        !req.body.text.trim() ||
        req.body.text.length > 4000
      )
        return res.status(400).json({
          error: "Enter your work or a project link (up to 4,000 characters).",
        });
      const existing = a.submissions.find((s) => s.userId === req.user.id);
      if (existing?.grade !== null && existing)
        return res
          .status(409)
          .json({ error: "This submission has already been graded." });
      const submission = {
        userId: req.user.id,
        name: req.user.name,
        text: req.body.text.trim(),
        submittedAt: new Date().toISOString(),
        grade: null,
        feedback: "",
      };
      const { db, fileData } = storage();
      if (db) {
        if (existing) {
          const result = await db.collection("assignments").updateOne(
            {
              id: a.id,
              submissions: {
                $elemMatch: { userId: req.user.id, grade: null },
              },
            },
            { $set: { "submissions.$": submission } },
          );
          if (!result.matchedCount)
            return res.status(409).json({
              error: "The assignment changed. Refresh and try again.",
            });
        } else {
          const result = await db
            .collection("assignments")
            .updateOne(
              { id: a.id, "submissions.userId": { $ne: req.user.id } },
              { $push: { submissions: submission } },
            );
          if (!result.matchedCount)
            return res.status(409).json({
              error: "The assignment changed. Refresh and try again.",
            });
        }
      } else {
        const current = (fileData.assignments || []).find((t) => t.id === a.id);
        const index = current.submissions.findIndex(
          (s) => s.userId === req.user.id,
        );
        if (index >= 0 && current.submissions[index].grade !== null)
          return res
            .status(409)
            .json({ error: "This submission has already been graded." });
        if (index >= 0) current.submissions[index] = submission;
        else current.submissions.push(submission);
        await persist();
      }
      if (a.ownerId !== "sample-studio")
        await notifyUser(a.ownerId, {
          key: `submission:${a.id}:${req.user.id}:${submission.submittedAt}`,
          type: "assignment",
          title: "New work to review",
          body: `${req.user.name} submitted work for ${a.title}.`,
          target: "shared-assignments",
        }).catch(() => {});
      res.status(201).json({ ok: true });
    }),
  );
  app.patch(
    "/api/assignments/:id/submissions/:userId",
    authenticated,
    handle(async (req, res) => {
      const a = await find(req.params.id);
      if (!a) return res.status(404).json({ error: "Assignment not found." });
      if (a.ownerId !== req.user.id)
        return res
          .status(403)
          .json({ error: "Only the assignment author can grade submissions." });
      if (
        typeof req.body.grade !== "number" ||
        !Number.isFinite(req.body.grade) ||
        req.body.grade < 0 ||
        req.body.grade > a.marks ||
        typeof req.body.feedback !== "string" ||
        req.body.feedback.length > 2000
      )
        return res.status(400).json({
          error: `Enter a mark from 0 to ${a.marks} and feedback up to 2,000 characters.`,
        });
      if (!a.submissions.some((s) => s.userId === req.params.userId))
        return res.status(404).json({ error: "Submission not found." });
      const { db, fileData } = storage();
      if (db) {
        const result = await db.collection("assignments").updateOne(
          {
            id: a.id,
            marks: a.marks,
            "submissions.userId": req.params.userId,
          },
          {
            $set: {
              "submissions.$.grade": req.body.grade,
              "submissions.$.feedback": req.body.feedback,
            },
          },
        );
        if (!result.matchedCount)
          return res
            .status(409)
            .json({ error: "The assignment changed. Refresh before grading." });
      } else {
        const current = fileData.assignments
          .find((t) => t.id === a.id)
          .submissions.find((s) => s.userId === req.params.userId);
        current.grade = req.body.grade;
        current.feedback = req.body.feedback;
        await persist();
      }
      await notifyUser(req.params.userId, {
        key: `feedback:${a.id}:${req.params.userId}:${req.body.grade}:${crypto.createHash("sha256").update(req.body.feedback).digest("hex").slice(0, 12)}`,
        type: "feedback",
        title: "Your feedback is ready",
        body: `${a.title}: ${req.body.grade}/${a.marks} marks.`,
        target: "shared-assignments",
      }).catch(() => {});
      res.json({ ok: true });
    }),
  );
};
