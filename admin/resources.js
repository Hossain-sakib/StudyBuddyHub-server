// Resource keys are allowlisted: clients can never choose arbitrary collections.
const text = (label, required = false) => ({
  label,
  type: "text",
  required,
  max: 200,
});
const area = (label) => ({ label, type: "textarea", max: 5000 });
const choice = (label, options) => ({ label, type: "select", options });
const number = (label) => ({ label, type: "number", min: 0, max: 100000000 });
const email = { label: "Email", type: "email", max: 254 };
const date = (label) => ({ label, type: "date" });
const resources = {
  contacts: {
    title: "Contacts",
    group: "CRM",
    collection: "crm_contacts",
    fields: {
      name: text("Full name", true),
      email,
      phone: text("Phone"),
      company: text("Company"),
      notes: area("Notes"),
    },
  },
  leads: {
    title: "Leads",
    group: "CRM",
    collection: "crm_leads",
    fields: {
      name: text("Lead name", true),
      email,
      source: text("Source"),
      status: choice("Stage", ["New", "Contacted", "Qualified", "Won", "Lost"]),
      notes: area("Next steps"),
    },
  },
  tasks: {
    title: "Tasks",
    group: "Operations",
    collection: "work_tasks",
    fields: {
      title: text("Task title", true),
      assignee: text("Assignee"),
      due: date("Due date"),
      status: choice("Status", ["To do", "In progress", "Done"]),
      notes: area("Details"),
    },
  },
  pages: {
    title: "Content pages",
    group: "CMS",
    collection: "cms_pages",
    fields: {
      title: text("Page title", true),
      slug: text("URL slug", true),
      body: area("Content"),
      status: choice("Publication", ["Draft", "Published"]),
      description: area("Search description"),
    },
  },
  inventory: {
    title: "Inventory",
    group: "ERP",
    collection: "inventory_items",
    fields: {
      name: text("Item name", true),
      sku: text("SKU", true),
      quantity: number("Quantity"),
      unit: text("Unit"),
      reorderAt: number("Reorder level"),
      notes: area("Notes"),
    },
  },
  employees: {
    title: "Employees",
    group: "ERP",
    collection: "hr_employees",
    fields: {
      name: text("Full name", true),
      email,
      department: text("Department"),
      position: text("Position"),
      startedAt: date("Start date"),
      status: choice("Status", ["Active", "On leave", "Inactive"]),
    },
  },
  invoices: {
    title: "Invoices",
    group: "ERP",
    collection: "finance_invoices",
    fields: {
      number: text("Invoice number", true),
      customer: text("Customer", true),
      amountMinor: number("Amount in minor units (BDT paisa)"),
      currency: choice("Currency", ["BDT", "USD", "EUR"]),
      due: date("Due date"),
      status: choice("Status", ["Draft", "Sent", "Paid", "Void"]),
      notes: area("Notes"),
    },
  },
  courses: {
    title: "Courses",
    group: "Learning",
    collection: "courses",
    fields: {
      title: text("Course title", true),
      description: area("Description"),
      category: choice("Category", [
        "Design",
        "Development",
        "Personal growth",
      ]),
      level: choice("Level", ["Beginner", "Intermediate", "All levels"]),
      teacher: text("Instructor"),
      duration: text("Duration"),
      lessons: { label: "Lessons", type: "lessons", required: true },
      quiz: { label: "Practice questions", type: "quiz", required: true },
    },
  },
};
function validate(resource, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid form.");
  const value = {};
  for (const [key, field] of Object.entries(resource.fields)) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) throw new Error(`${field.label} is required.`);
      continue;
    }
    if (field.type === "lessons" || field.type === "quiz") {
      if (!Array.isArray(raw) || !raw.length || raw.length > 50)
        throw new Error(`${field.label} must contain 1–50 items.`);
      const string = (v, max) =>
        typeof v === "string" && v.trim().length > 0 && v.length <= max;
      value[key] = raw.map((item) => {
        if (!item || typeof item !== "object")
          throw new Error(`Invalid ${field.label.toLowerCase()}.`);
        if (field.type === "lessons") {
          if (!string(item.title, 200) || !string(item.body, 10000))
            throw new Error(
              "Each lesson needs a title and content (up to 10,000 characters).",
            );
          return { title: item.title.trim(), body: item.body.trim() };
        }
        if (
          !string(item.question, 500) ||
          !Array.isArray(item.choices) ||
          item.choices.length < 2 ||
          item.choices.length > 6 ||
          item.choices.some((c) => !string(c, 300)) ||
          !Number.isInteger(item.answer) ||
          item.answer < 0 ||
          item.answer >= item.choices.length
        )
          throw new Error(
            "Each question needs 2–6 answers and a valid correct answer.",
          );
        return {
          question: item.question.trim(),
          choices: item.choices.map((c) => c.trim()),
          answer: item.answer,
        };
      });
      continue;
    }
    if (field.type === "number") {
      if (!Number.isSafeInteger(raw) || raw < field.min || raw > field.max)
        throw new Error(`${field.label} must be a nonnegative whole number.`);
      value[key] = raw;
      continue;
    }
    if (typeof raw !== "string" || raw.length > (field.max || 200))
      throw new Error(`${field.label} is too long.`);
    const v = raw.trim();
    if (field.required && !v) throw new Error(`${field.label} is required.`);
    if (field.type === "select" && !field.options.includes(v))
      throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
      throw new Error("Enter a valid email.");
    if (
      field.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)))
    )
      throw new Error("Choose a valid date.");
    if (key === "slug" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v))
      throw new Error("Use lowercase words separated by hyphens for the slug.");
    value[key] = v;
  }
  return value;
}
module.exports = { resources, validate };
