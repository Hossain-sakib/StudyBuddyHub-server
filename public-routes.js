const { escapeHtml: escape, origin, renderPage } = require("./public-pages");
const catalog = require("./data/catalog.json");
function assets() {
  try {
    return require("./data/page-assets.json");
  } catch {
    return process.env.NODE_ENV === "production" ? {} : {stylesheet:"/src/styles.css?direct"};
  }
}
function render(page, stylesheet) {
  const url = origin() + "/resources/" + encodeURIComponent(page.slug);
  return renderPage({
    ...assets(),
    stylesheet: stylesheet || assets().stylesheet,
    title: page.title,
    description: page.description || page.title,
    path: "/resources/" + encodeURIComponent(page.slug),
    graph: {
      "@type": "Article",
      headline: page.title,
      description: page.description || page.title,
      url,
      datePublished: page.createdAt,
      dateModified: page.updatedAt || page.createdAt,
      publisher: {
        "@type": "Organization",
        name: "Studybuddy",
        url: origin() + "/",
      },
    },
    content: `<p class="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-300">Learning resources${page.isSample ? " · Demo content" : ""}</p>
<h1 class="mt-4 text-3xl font-bold leading-tight sm:text-4xl">${escape(page.title)}</h1>
${page.description ? `<p class="mt-5 text-lg leading-8 text-slate-500 dark:text-slate-400">${escape(page.description)}</p>` : ""}
<div class="mt-8 space-y-5 text-base leading-8 text-slate-600 dark:text-slate-300">${String(
      page.body || "",
    )
      .split(/\n\s*\n/)
      .map((p) => `<p class="whitespace-pre-wrap break-words">${escape(p)}</p>`)
      .join("")}</div>`,
  });
}
function renderCourse(course) {
  const path = "/courses/" + encodeURIComponent(course.id);
  return renderPage({
    ...assets(),
    title: course.title,
    description: course.description || course.title,
    path,
    graph: {
      "@type": "Course",
      name: course.title,
      description: course.description,
      provider: {
        "@type": "Organization",
        name: "Studybuddy",
        sameAs: origin() + "/",
      },
      url: origin() + path,
      educationalLevel: course.level,
      inLanguage: "en",
    },
    content: `<p class="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-300">${escape(course.category)}${course.isSample ? " · Demo curriculum" : ""}</p>
<h1 class="mt-4 text-3xl font-bold leading-tight sm:text-4xl">${escape(course.title)}</h1>
<p class="mt-5 text-lg leading-8 text-slate-500 dark:text-slate-400">${escape(course.description)}</p>
<p class="mt-5 text-sm text-slate-500 dark:text-slate-400">${escape(course.level)} · ${escape(course.duration)} · ${(course.lessons || []).length} lessons</p>
${course.teacher ? `<p class="mt-3 text-sm text-slate-500 dark:text-slate-400">Instructor: ${escape(course.teacher)}</p>` : ""}
<h2 class="mt-8 text-xl font-bold">What you will learn</h2>
<ol class="mt-4 space-y-3">${(course.lessons || []).map((lesson, index) => `<li class="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700"><span class="mr-3 font-semibold text-violet-600 dark:text-violet-300">${index + 1}.</span>${escape(lesson.title)}</li>`).join("")}</ol>
<a href="/?signup=1" class="mt-8 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">Create an account to start learning →</a>`,
  });
}
module.exports = function publicRoutes(app, { storage, handle }) {
  async function publishedPages() {
    const { db, fileData } = storage();
    return db
      ? db
          .collection("cms_pages")
          .find(
            { status: "Published" },
            { projection: { _id: 0, slug: 1, updatedAt: 1, createdAt: 1 } },
          )
          .limit(1000)
          .toArray()
      : (fileData.admin?.cms_pages || []).filter(
          (p) => p.status === "Published",
        );
  }
  async function courses() {
    const { db, fileData } = storage();
    if (db)
      return db
        .collection("courses")
        .find({}, { projection: { _id: 0, id: 1, updatedAt: 1, createdAt: 1 } })
        .limit(1000)
        .toArray();
    return [
      ...new Map(
        [...catalog, ...(fileData.admin?.courses || [])].map((c) => [c.id, c]),
      ).values(),
    ];
  }
  function notFound(res) {
    return res
      .status(404)
      .type("html")
      .send(
        renderPage({
          ...assets(),
          title: "Page not found",
          description: "The requested page is unavailable.",
          path: "/",
          noindex: true,
          graph: { "@type": "WebPage", name: "Page not found" },
          content:
            '<h1 class="text-3xl font-bold">Page not found</h1><p class="mt-4 text-slate-500 dark:text-slate-400">This page may have moved or is no longer published.</p>',
        }),
      );
  }
  app.get(
    "/resources/:slug",
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const page = db
        ? await db
            .collection("cms_pages")
            .findOne(
              { slug: req.params.slug, status: "Published" },
              { projection: { _id: 0 } },
            )
        : (fileData.admin?.cms_pages || []).find(
            (p) => p.slug === req.params.slug && p.status === "Published",
          );
      if (!page) return notFound(res);
      res.type("html").send(render(page));
    }),
  );
  app.get(
    "/courses/:id",
    handle(async (req, res) => {
      const { db, fileData } = storage();
      const course = db
        ? await db
            .collection("courses")
            .findOne({ id: req.params.id }, { projection: { _id: 0 } })
        : fileData.admin?.courses?.find((c) => c.id === req.params.id) ||
          catalog.find((c) => c.id === req.params.id);
      if (!course) return notFound(res);
      res.type("html").send(renderCourse(course));
    }),
  );
  app.get(
    "/sitemap.xml",
    handle(async (req, res) => {
      const [pages, rows] = await Promise.all([publishedPages(), courses()]);
      const entries = [
        { url: origin() + "/" },
        ...pages.map((p) => ({
          url: origin() + "/resources/" + encodeURIComponent(p.slug),
          date: p.updatedAt || p.createdAt,
        })),
        ...rows.map((c) => ({
          url: origin() + "/courses/" + encodeURIComponent(c.id),
          date: c.updatedAt || c.createdAt,
        })),
      ];
      res
        .type("application/xml")
        .send(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((e) => `<url><loc>${escape(e.url)}</loc>${e.date && Number.isFinite(Date.parse(e.date)) ? `<lastmod>${new Date(e.date).toISOString()}</lastmod>` : ""}</url>`).join("")}</urlset>`,
        );
    }),
  );
};
module.exports.render = render;
