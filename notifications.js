const crypto = require("node:crypto");
module.exports = function registerNotifications(
  app,
  { authenticated, handle, storage, persist, getState },
) {
  async function create(userId, event) {
    if (!userId || !event.key) return;
    const record = {
      id: crypto.randomUUID(),
      userId,
      key: event.key,
      type: event.type || "info",
      title: event.title.slice(0, 160),
      body: (event.body || "").slice(0, 1000),
      target: event.target || "dashboard",
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    const { db, fileData } = storage();
    if (db)
      await db
        .collection("notifications")
        .updateOne(
          { userId, key: event.key },
          { $setOnInsert: record },
          { upsert: true },
        );
    else {
      fileData.notifications ||= [];
      if (
        !fileData.notifications.some(
          (n) => n.userId === userId && n.key === event.key,
        )
      ) {
        fileData.notifications.push(record);
        await persist();
      }
    }
  }
  app.get(
    "/api/notifications",
    authenticated,
    handle(async (req, res) => {
      const state = await getState(req.user.id, req.user.name);
      const today = new Date().toISOString().slice(0, 10);
      for (const task of state.assignments
        .filter((t) => !t.done && t.due && t.due <= today)
        .slice(0, 30))
        await create(req.user.id, {
          key: `task-due:${task.id}:${task.due}`,
          type: "reminder",
          title:
            task.due < today
              ? "An assignment needs a little attention"
              : "Due today",
          body: task.title,
          target: "assignments",
        });
      const { db, fileData } = storage();
      if (db) {
        const [items, unreadCount] = await Promise.all([
          db
            .collection("notifications")
            .find(
              { userId: req.user.id },
              { projection: { _id: 0, userId: 0, key: 0 } },
            )
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray(),
          db
            .collection("notifications")
            .countDocuments({ userId: req.user.id, readAt: null }),
        ]);
        return res.json({ items, unreadCount });
      }
      const mine = (fileData.notifications || [])
        .filter((n) => n.userId === req.user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({
        items: mine.slice(0, 50).map(({ userId, key, ...n }) => n),
        unreadCount: mine.filter((n) => !n.readAt).length,
      });
    }),
  );
  app.patch(
    "/api/notifications/read",
    authenticated,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const readAt = new Date().toISOString();
      if (db)
        await db
          .collection("notifications")
          .updateMany(
            { userId: req.user.id, readAt: null },
            { $set: { readAt } },
          );
      else {
        for (const n of fileData.notifications || [])
          if (n.userId === req.user.id && !n.readAt) n.readAt = readAt;
        await persist();
      }
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/notifications/:id",
    authenticated,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const query = { id: req.params.id, userId: req.user.id };
      if (db) {
        const result = await db
          .collection("notifications")
          .updateOne(query, { $set: { readAt: new Date().toISOString() } });
        if (!result.matchedCount)
          return res.status(404).json({ error: "Notification not found." });
      } else {
        const n = (fileData.notifications || []).find(
          (n) => n.id === query.id && n.userId === query.userId,
        );
        if (!n)
          return res.status(404).json({ error: "Notification not found." });
        n.readAt ||= new Date().toISOString();
        await persist();
      }
      res.json({ ok: true });
    }),
  );
  return create;
};
