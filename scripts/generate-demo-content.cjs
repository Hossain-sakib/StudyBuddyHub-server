/* Deterministic sample data only. This script never connects to a database. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "data/catalog.json");
const core = JSON.parse(fs.readFileSync(catalogPath, "utf8")).filter(
  (c) => !c.id.startsWith("demo-"),
);
const topics = [
  [
    "accessibility",
    "Designing for Everyone",
    "Design",
    "design",
    "purple",
    "Make interfaces easier to use with keyboard navigation, clear labels, and thoughtful contrast.",
    "Accessible interfaces support different ways of seeing, moving, and understanding. Semantic structure, keyboard access, and useful labels help more people complete a task.",
    "Test a simple form using only your keyboard. Label every input and make its focus state visible.",
  ],
  [
    "layouts",
    "CSS Layouts That Work",
    "Development",
    "code",
    "orange",
    "Build flexible page layouts with modern CSS grids and responsive spacing.",
    "A useful layout follows the content. Grid handles two-dimensional structure; flexbox arranges a row or column. Flexible tracks and breakpoints help content adapt without fixed device assumptions.",
    "Sketch a single-column mobile page, then create a two-column layout when the content has enough room.",
  ],
  [
    "react",
    "Your First React Components",
    "Development",
    "code",
    "pink",
    "Break a small interface into reusable components and learn how props and state fit together.",
    "Components describe reusable interface pieces. Props carry inputs from a parent. State stores values that change in response to interaction and cause the interface to render again.",
    "Build a counter with a heading, a button, and a state value. Pass the heading as a prop.",
  ],
  [
    "git",
    "Git for Everyday Projects",
    "Development",
    "code",
    "green",
    "Keep a clear project history with commits, branches, and small reviewable changes.",
    "Git records snapshots of a project. Small commits make changes easier to understand and undo. Branches let you prepare a change while keeping the main line stable.",
    "Create a practice repository, commit a README, and make a separate branch for a small improvement.",
  ],
  [
    "typography",
    "Typography with Personality",
    "Design",
    "design",
    "orange",
    "Use type size, rhythm, and spacing to make content clear and expressive.",
    "Typography creates hierarchy and rhythm. A restrained type scale, comfortable line length, and enough contrast make content easier to read. Font choice should support the message.",
    "Arrange a title, introduction, and body paragraph using one font family and three deliberate sizes.",
  ],
  [
    "research",
    "Ask Better User Questions",
    "Design",
    "design",
    "green",
    "Learn to listen, observe, and turn useful questions into better product decisions.",
    "Useful research questions focus on behavior and context rather than asking people to predict what they might do. Open questions and concrete examples reveal more than leading questions.",
    "Ask someone to describe the last time they learned a new skill. Note their steps without suggesting an answer.",
  ],
  [
    "writing",
    "Write Clearer Digital Content",
    "Personal growth",
    "growth",
    "purple",
    "Make your writing simpler, warmer, and easier to act on.",
    "Clear writing begins with a reader and a purpose. Put the useful point early, choose familiar words, and use specific actions. Read the text aloud to catch unnecessary complexity.",
    "Rewrite a long instruction as a short explanation followed by one clear next step.",
  ],
  [
    "focus",
    "Build a Sustainable Focus Habit",
    "Personal growth",
    "growth",
    "green",
    "Plan focused sessions, manage distractions, and build a routine you can repeat.",
    "Focus is easier when the next action is specific. Reduce avoidable interruptions, choose a manageable session length, and leave time for rest. Consistency matters more than a perfect streak.",
    "Choose one task for a short focus session. Write the next step before you start and one reflection afterward.",
  ],
  [
    "charts",
    "Tell a Story with Data",
    "Development",
    "code",
    "purple",
    "Choose useful charts, label them honestly, and explain what the evidence supports.",
    "Choose a chart to match the question. Bars compare categories; lines show change over time. Labels, units, sources, and uncertainty are part of the explanation, not decoration.",
    "Compare a small set of weekly study minutes with a labeled bar chart. Write one supported conclusion.",
  ],
  [
    "planning",
    "From Idea to Small Project",
    "Personal growth",
    "growth",
    "orange",
    "Turn an ambitious idea into a useful first version with achievable milestones.",
    "A small project begins with a clear outcome and a narrow first version. Separate essential needs from later improvements, identify dependencies, and review progress against observable results.",
    "Describe a project in one sentence. Choose three milestones and define how you will know each one is complete.",
  ],
  [
    "feedback",
    "Give Feedback That Helps",
    "Personal growth",
    "growth",
    "pink",
    "Practice useful, specific feedback that supports another person’s next step.",
    "Helpful feedback describes an observable choice, explains its effect, and offers a possible next step. Ask about intent before assuming a mistake, and leave room for a different solution.",
    "Review a sample interface. Name one effective choice and one focused improvement, each with a reason.",
  ],
  [
    "systems",
    "Design a Tiny Design System",
    "Design",
    "design",
    "pink",
    "Create a small set of reusable colors, spacing, and interface components.",
    "A design system is a set of shared decisions. Tokens capture values such as color and spacing; components apply them consistently. Document when a pattern should be used as well as how it looks.",
    "Define a spacing scale, two button states, and a form input. Check consistency across a small screen.",
  ],
];
const extra = topics.map(
  ([id, title, category, icon, color, description, concept, exercise], i) => ({
    id: "demo-" + id,
    title,
    category,
    level: "Beginner",
    icon,
    color,
    teacher: "Studybuddy sample studio",
    duration: `${1 + (i % 2)}h ${i % 2 ? "20" : "40"}m`,
    description,
    isSample: true,
    lessons: [
      {
        title: "Understand the core idea",
        body:
          concept +
          "\n\nThis course is sample educational content for exploring the platform.",
      },
      {
        title: "Try a small practical exercise",
        body:
          exercise +
          "\n\nKeep your first attempt small. Explain the choices you made and note one thing you want to improve.",
      },
      {
        title: "Reflect, improve, and share",
        body: "Review your work against the main idea from the first lesson. Check the result, identify one specific improvement, and try it.\n\nShare a short reflection with a study buddy: what you tried, what happened, and what you would change next.",
      },
    ],
    quiz: [
      {
        question: "What is a useful way to begin this practice?",
        choices: [
          "Choose one small, clear task",
          "Try to finish everything at once",
          "Skip the basic idea",
        ],
        answer: 0,
      },
      {
        question: "What makes reflection useful?",
        choices: [
          "Only counting time spent",
          "Naming a specific result and next improvement",
          "Avoiding anything that was difficult",
        ],
        answer: 1,
      },
      {
        question: "What helps when sharing feedback?",
        choices: [
          "Vague judgments",
          "Personal assumptions",
          "An observation, its effect, and a useful next step",
        ],
        answer: 2,
      },
    ],
  }),
);
const courses = [...core.map(course=>({...course,isSample:true})), ...extra];
const stamp = "2026-11-01T09:00:00.000Z";
const names = [
  "Amina Rahman",
  "Rafi Ahmed",
  "Nadia Hasan",
  "Arif Karim",
  "Maya Chowdhury",
  "Sami Khan",
  "Lina Akter",
  "Tariq Islam",
  "Nila Sen",
  "Imran Ali",
  "Sara Noor",
  "Fahim Das",
];
const rows = (count, make) =>
  Array.from({ length: count }, (_, i) => ({
    ...make(i),
    isSample: true,
    createdAt: stamp,
    updatedAt: stamp,
  }));
const assignments = rows(36, (i) => {
  const c = courses[i % courses.length];
  return {
    id: "demo-challenge-" + String(i + 1).padStart(3, "0"),
    title: (i < 18 ? "Try it: " : "Practice project: ") + c.title,
    description: `Sample challenge: complete a small exercise inspired by ${c.title}. Explain your process, share a project link or reflection, and identify one next step. This is self-guided sample practice without grading.`,
    category: c.category,
    marks: 100,
    courseId: c.id,
    ownerId: "sample-studio",
    ownerName: "Studybuddy · sample content",
    due: "",
    submissions: [],
  };
});
const prompts = [
  "What is one small thing you learned today?",
  "Share a project idea you can finish in one afternoon.",
  "What helped you get unstuck this week?",
  "Which lesson would you like to practice with a buddy?",
  "Share one useful resource and explain why you chose it.",
  "What makes a learning routine sustainable for you?",
];
const messages = rows(30, (i) => ({
  id: "demo-message-" + String(i + 1).padStart(3, "0"),
  userId: "sample-studio",
  name: names[i % names.length] + " (demo)",
  room: ["general", "design", "development"][i % 3],
  text: "Sample discussion: " + prompts[i % prompts.length],
  createdAt: new Date(Date.parse(stamp) + i * 3600000).toISOString(),
}));
const contacts = rows(20, (i) => ({
  id: "demo-contact-" + i,
  name: names[i % names.length] + " (demo)",
  email: `contact${i + 1}@example.com`,
  phone: "",
  company: [
    "Sample Studio",
    "Example Learning",
    "Demo Workshop",
    "Practice Lab",
  ][i % 4],
  notes: "Fictional contact for interface demonstration. Not a real customer.",
}));
const leads = rows(15, (i) => ({
  id: "demo-lead-" + i,
  name: `Sample learning partnership ${i + 1}`,
  email: `lead${i + 1}@example.com`,
  source: ["Course enquiry", "Community event", "Website form"][i % 3],
  status: ["New", "Contacted", "Qualified", "Won", "Lost"][i % 5],
  notes: "Fictional CRM lead. No real sale or agreement.",
}));
const tasks = rows(15, (i) => ({
  id: "demo-task-" + i,
  title:
    [
      "Review course outline",
      "Prepare practice workshop",
      "Update resource guide",
      "Review accessibility checklist",
      "Plan community session",
    ][i % 5] + ` · sample ${i + 1}`,
  assignee: names[i % names.length] + " (demo)",
  due: `2026-12-${String(1 + i).padStart(2, "0")}`,
  status: ["To do", "In progress", "Done"][i % 3],
  notes: "Sample operational task for demonstrating workflow.",
}));
const inventory = rows(12, (i) => ({
  id: "demo-item-" + i,
  name:
    ["Workshop notebook", "Practice kit", "Reference book", "Drawing tablet"][
      i % 4
    ] + ` · demo ${i + 1}`,
  sku: "DEMO-" + String(i + 1).padStart(4, "0"),
  quantity: 8 + i * 3,
  unit: "pieces",
  reorderAt: 10,
  notes: "Fictional stock. Not a real inventory balance.",
}));
const employees = rows(10, (i) => ({
  id: "demo-employee-" + i,
  name: names[i] + " (demo)",
  email: `team${i + 1}@example.com`,
  department: ["Learning", "Content", "Operations"][i % 3],
  position: ["Sample coordinator", "Sample editor", "Sample facilitator"][
    i % 3
  ],
  startedAt: "2026-10-01",
  status: ["Active", "On leave", "Inactive"][i % 3],
}));
const invoices = rows(12, (i) => ({
  id: "demo-invoice-" + i,
  number: "DEMO-2026-" + String(i + 1).padStart(3, "0"),
  customer: "Example organization " + (i + 1),
  amountMinor: (1500 + i * 250) * 100,
  currency: "BDT",
  due: `2026-12-${String(1 + i).padStart(2, "0")}`,
  status: ["Draft", "Sent", "Paid", "Void"][i % 4],
  notes:
    "DEMO ONLY. Fictional invoice for interface testing. No real payment or financial balance.",
}));
const pages = rows(6, (i) => ({
  id: "demo-page-" + i,
  title: [
    "Getting started with Studybuddy",
    "How to choose your next course",
    "A simple weekly learning routine",
    "Thoughtful community feedback",
    "Making time for practice",
    "Your first small project",
  ][i],
  slug: "sample-resource-" + (i + 1),
  body: "Sample resource\n\nChoose one useful idea, put it into practice, and reflect on what happened. Start with a small task that fits the time you have. Ask a buddy for specific feedback.\n\nThis page is demonstration content and can be edited or removed by the administrator.",
  description:
    "A sample learning resource from the Studybuddy demonstration collection.",
  status: i < 3 ? "Published" : "Draft",
}));
const collections = {
  courses,
  assignments,
  messages,
  crm_contacts: contacts,
  crm_leads: leads,
  work_tasks: tasks,
  inventory_items: inventory,
  hr_employees: employees,
  finance_invoices: invoices,
  cms_pages: pages,
};
const total = Object.values(collections).reduce(
  (n, list) => n + list.length,
  0,
);
fs.writeFileSync(catalogPath, JSON.stringify(courses, null, 2) + "\n");
fs.writeFileSync(
  path.join(root, "data/demo-content.json"),
  JSON.stringify({ version: 2, total, collections }, null, 2) + "\n",
);
console.log(
  `Prepared ${total} clearly labeled demo records across ${Object.keys(collections).length} collections. No database writes performed.`,
);
