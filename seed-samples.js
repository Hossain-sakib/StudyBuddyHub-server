const catalog = require("./data/catalog.json");
const stamp = "2026-11-10T08:00:00.000Z";
const sampleAssignments = [
  {
    id: "sample-starter-design",
    title: "Design a welcoming course card",
    description:
      "Sample challenge: sketch a course card with a clear title, a short description, accessible colors, and one primary action. Share your sketch or describe your design decisions. This is self-guided practice; sample challenges are not graded.",
    category: "Design",
    marks: 100,
    courseId: "design",
  },
  {
    id: "sample-starter-web",
    title: "Build your personal introduction page",
    description:
      "Sample challenge: create a responsive introduction page using semantic HTML and CSS. Include your learning goals and one project you would like to build. Submit a project link or a short reflection. This self-guided sample does not receive grades.",
    category: "Development",
    marks: 100,
    courseId: "web",
  },
  {
    id: "sample-starter-growth",
    title: "Plan your next seven days of learning",
    description:
      "Sample challenge: choose a small daily learning goal, plan three focused sessions, and schedule a review. Share your plan and one way you will reduce distractions. This is self-guided practice without grading.",
    category: "Personal growth",
    marks: 50,
    courseId: "productivity",
  },
].map((a) => ({
  ...a,
  ownerId: "sample-studio",
  ownerName: "Studybuddy · sample content",
  createdAt: stamp,
  isSample: true,
  submissions: [],
}));
const sampleMessages = [
  {
    id: "sample-welcome-general",
    room: "general",
    text: "Sample welcome: introduce yourself and share one thing you want to learn. This is an example discussion prompt, not a message from a real learner.",
  },
  {
    id: "sample-welcome-design",
    room: "design",
    text: "Sample discussion: what makes a website feel welcoming? Try naming one layout choice and one color choice you would make.",
  },
  {
    id: "sample-welcome-development",
    room: "development",
    text: "Sample discussion: share a small project idea you can build this week. Break it into three steps before you start.",
  },
].map((m) => ({
  ...m,
  userId: "sample-studio",
  name: "Studybuddy · sample guide",
  createdAt: stamp,
  isSample: true,
}));
async function seedSamples(db) {
  const marker = { id: "studybuddy-starter-v1" };
  if (await db.collection("seed_runs").findOne(marker))
    return { alreadySeeded: true };
  for (const course of catalog)
    await db
      .collection("courses")
      .updateOne(
        { id: course.id },
        { $setOnInsert: { ...course, isSample: true } },
        { upsert: true },
      );
  for (const a of sampleAssignments)
    await db
      .collection("assignments")
      .updateOne({ id: a.id }, { $setOnInsert: a }, { upsert: true });
  for (const m of sampleMessages)
    await db
      .collection("messages")
      .updateOne({ id: m.id }, { $setOnInsert: m }, { upsert: true });
  await db
    .collection("seed_runs")
    .updateOne(
      marker,
      { $setOnInsert: { ...marker, completedAt: new Date().toISOString() } },
      { upsert: true },
    );
  return {
    courses: catalog.length,
    assignments: sampleAssignments.length,
    messages: sampleMessages.length,
  };
}
module.exports = { seedSamples, sampleAssignments, sampleMessages };
