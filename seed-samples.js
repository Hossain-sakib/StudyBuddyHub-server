const demo = require("./data/demo-content.json");
const sampleAssignments = demo.collections.assignments;
const sampleMessages = demo.collections.messages;
async function seedSamples(db) {
  const marker = { id: "studybuddy-starter-v2" };
  if (await db.collection("seed_runs").findOne(marker))
    return { alreadySeeded: true, total: demo.total };
  const counts = {};
  for (const [collection, records] of Object.entries(demo.collections)) {
    const rows = records.map((row) => ({ ...row, isSample: true }));
    await db.collection(collection).bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { id: row.id },
          update: { $setOnInsert: row },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    counts[collection] = rows.length;
  }
  await db.collection("seed_runs").updateOne(
    marker,
    {
      $setOnInsert: {
        ...marker,
        total: demo.total,
        completedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  return { total: demo.total, counts };
}
module.exports = { seedSamples, sampleAssignments, sampleMessages };
