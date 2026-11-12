const mail = require("../mailer");
module.exports = function workflows(
  app,
  { admin, handle, storage, persist, audit },
) {
  app.get(
    "/api/admin/integrations",
    ...admin,
    handle(async (req, res) => {
      const { db } = storage();
      const demo = db
        ? await db
            .collection("seed_runs")
            .findOne({ id: "studybuddy-starter-v2" })
        : null;
      res.json({
        database: db ? "connected" : "development",
        media: require("../media/routes").configured()
          ? "configured"
          : "missing",
        email: mail.configured() ? "configured" : "missing",
        demo: demo
          ? { total: demo.total, completedAt: demo.completedAt }
          : null,
      });
    }),
  );
  app.post(
    "/api/admin/leads/:id/convert",
    ...admin,
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const lead = db
        ? await db.collection("crm_leads").findOne({ id: req.params.id })
        : fileData.admin?.crm_leads?.find((r) => r.id === req.params.id);
      if (!lead) return res.status(404).json({ error: "Lead not found." });
      const alreadyConverted = !!lead.contactId;
      const contact = {
        id: `lead-${lead.id}`,
        name: lead.name,
        email: lead.email || "",
        notes: lead.notes || "",
        sourceLeadId: lead.id,
        createdAt: new Date().toISOString(),
        ...(lead.isSample ? { isSample: true } : {}),
      };
      if (db) {
        await db
          .collection("crm_contacts")
          .updateOne(
            { id: contact.id },
            { $setOnInsert: contact },
            { upsert: true },
          );
        await db
          .collection("crm_leads")
          .updateOne(
            { id: lead.id },
            { $set: { status: "Won", contactId: contact.id } },
          );
      } else {
        fileData.admin.crm_contacts ||= [];
        if (!fileData.admin.crm_contacts.some((r) => r.id === contact.id))
          fileData.admin.crm_contacts.push(contact);
        Object.assign(lead, { status: "Won", contactId: contact.id });
        await persist();
      }
      if (!alreadyConverted)
        await audit(req, "convert-to-contact", "leads", lead.id);
      res.json({ id: contact.id, message: "Lead converted to a contact." });
    }),
  );
  app.post(
    "/api/admin/inventory/:id/adjust",
    ...admin,
    handle(async (req, res) => {
      const { delta, reason } = req.body;
      if (
        !Number.isSafeInteger(delta) ||
        !delta ||
        Math.abs(delta) > 1000000 ||
        typeof reason !== "string" ||
        !reason.trim() ||
        reason.length > 200
      )
        return res.status(400).json({
          error:
            "Enter a nonzero whole-number change and a reason (up to 200 characters).",
        });
      const { db, fileData } = storage();
      let item;
      if (db)
        item = await db.collection("inventory_items").findOneAndUpdate(
          {
            id: req.params.id,
            quantity: {
              $gte: Math.max(0, -delta),
              $lte: 100000000 - Math.max(0, delta),
            },
          },
          {
            $inc: { quantity: delta },
            $set: { updatedAt: new Date().toISOString() },
          },
          { returnDocument: "after", projection: { _id: 0 } },
        );
      else {
        item = fileData.admin?.inventory_items?.find(
          (r) => r.id === req.params.id,
        );
        if (
          item &&
          item.quantity + delta >= 0 &&
          item.quantity + delta <= 100000000
        ) {
          item.quantity += delta;
          await persist();
        } else item = null;
      }
      if (!item)
        return res.status(409).json({
          error:
            "Item unavailable or this adjustment would put stock outside the allowed range. Refresh and retry.",
        });
      await audit(
        req,
        `stock ${delta > 0 ? "+" : ""}${delta}: ${reason.trim()}`,
        "inventory",
        req.params.id,
      );
      res.json(item);
    }),
  );
};
