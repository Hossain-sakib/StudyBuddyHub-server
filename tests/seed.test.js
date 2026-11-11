const { test } = require("node:test");
const assert = require("node:assert/strict");
const { seedSamples } = require("../seed-samples");
test("sample seeding is repeatable and preserves existing course content", async () => {
  const collections = new Map();
  const db = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const rows = collections.get(name);
      return {
        async findOne({ id }) {
          return rows.get(id);
        },
        async bulkWrite(operations) {
          for (const op of operations) {
            const { filter, update } = op.updateOne;
            if (!rows.has(filter.id))
              rows.set(filter.id, structuredClone(update.$setOnInsert));
          }
        },
        async updateOne({ id }, change) {
          assert.ok(change.$setOnInsert);
          if (!rows.has(id)) rows.set(id, structuredClone(change.$setOnInsert));
        },
      };
    },
  };
  db.collection("courses");
  collections
    .get("courses")
    .set("design", { id: "design", title: "Existing custom course" });
  const first = await seedSamples(db);
  assert.equal(first.counts.assignments, 36);
  assert.equal(first.counts.messages, 30);
  assert.equal(
    collections.get("courses").get("design").title,
    "Existing custom course",
  );
  assert.equal(collections.get("assignments").size, 36);
  assert.equal((await seedSamples(db)).alreadySeeded, true);
  assert.equal(collections.get("assignments").size, 36);
  for (const row of collections.get("assignments").values())
    assert.equal(row.isSample, true);
});
