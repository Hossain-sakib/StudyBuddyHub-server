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
  assert.equal(first.assignments, 3);
  assert.equal(first.messages, 3);
  assert.equal(
    collections.get("courses").get("design").title,
    "Existing custom course",
  );
  assert.equal(collections.get("assignments").size, 3);
  assert.equal((await seedSamples(db)).alreadySeeded, true);
  assert.equal(collections.get("assignments").size, 3);
  for (const row of collections.get("assignments").values())
    assert.equal(row.isSample, true);
});
