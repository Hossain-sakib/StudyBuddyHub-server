const escape = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function origin() {
  return (
    process.env.APP_URL ||
    (process.env.CLIENT_ORIGINS || "https://studybuddy-hub.netlify.app").split(
      ",",
    )[0]
  ).replace(/\/$/, "");
}
function render(page, stylesheet) {
  const title = escape(page.title),
    description = escape(page.description || page.title),
    url = `${origin()}/resources/${encodeURIComponent(page.slug)}`;
  const graph = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description || page.title,
    url,
    dateModified: page.updatedAt || page.createdAt,
    publisher: { "@type": "Organization", name: "Studybuddy" },
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Studybuddy</title><meta name="description" content="${description}"><link rel="canonical" href="${escape(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${origin()}/brand/social-card.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${stylesheet ? `<link rel="stylesheet" href="${escape(stylesheet)}">` : ""}<script src="/theme-init.js"></script><script type="application/ld+json">${graph}</script></head><body class="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-100"><header class="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div class="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-5"><a class="flex items-center gap-3 text-lg font-bold" href="/"><img src="/brand/mark.svg" alt="" width="36" height="36">Studybuddy</a><a href="/" class="text-sm text-violet-600 dark:text-violet-300">Explore courses →</a></div></header><main class="mx-auto max-w-4xl px-6 py-12"><article class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 dark:border-slate-700 dark:bg-slate-900"><p class="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-300">Learning resources${page.isSample ? " · Demo content" : ""}</p><h1 class="mt-4 text-3xl font-bold leading-tight sm:text-4xl">${title}</h1>${page.description ? `<p class="mt-5 text-lg leading-8 text-slate-500 dark:text-slate-400">${description}</p>` : ""}<div class="mt-8 space-y-5 text-base leading-8 text-slate-600 dark:text-slate-300">${String(
    page.body || "",
  )
    .split(/\n\s*\n/)
    .map((p) => `<p class="whitespace-pre-wrap break-words">${escape(p)}</p>`)
    .join(
      "",
    )}</div></article><a href="/" class="mt-8 inline-block text-sm font-semibold text-violet-600 dark:text-violet-300">← Back to Studybuddy</a></main></body></html>`;
}
module.exports = function cmsRoutes(app, { storage, handle }) {
  async function pages() {
    const { db, fileData } = storage();
    return db
      ? db
          .collection("cms_pages")
          .find({ status: "Published" }, { projection: { _id: 0 } })
          .limit(1000)
          .toArray()
      : (fileData.admin?.cms_pages || []).filter(
          (p) => p.status === "Published",
        );
  }
  app.get(
    "/resources/:slug",
    handle(async (req, res) => {
      const page = (await pages()).find((p) => p.slug === req.params.slug);
      if (!page)
        return res
          .status(404)
          .type("html")
          .send(
            '<!doctype html><html lang="en"><head><title>Page not found — Studybuddy</title><meta name="robots" content="noindex"></head><body><h1>Page not found</h1><a href="/">Return to Studybuddy</a></body></html>',
          );
      let stylesheet = "";
      try {
        stylesheet = require("./data/page-assets.json").stylesheet;
      } catch {}
      res.type("html").send(render(page, stylesheet));
    }),
  );
  app.get(
    "/sitemap.xml",
    handle(async (req, res) => {
      const urls = [
        origin() + "/",
        ...(await pages()).map(
          (p) => `${origin()}/resources/${encodeURIComponent(p.slug)}`,
        ),
      ];
      res
        .type("application/xml")
        .send(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join("")}</urlset>`,
        );
    }),
  );
};
module.exports.render = render;
