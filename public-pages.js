// Shared HTML and metadata for public pages. User content is always escaped.
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const jsonLd = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const origin = () =>
  new URL(
    process.env.APP_URL ||
      (
        process.env.CLIENT_ORIGINS || "https://studybuddy-hub.netlify.app"
      ).split(",")[0],
  ).origin;
function renderPage({
  title,
  description,
  path,
  content,
  graph,
  stylesheet,
  media = {},
  noindex = false,
}) {
  const url = origin() + path;
  const image =
    media["/brand/social-card.png"]?.url || origin() + "/brand/social-card.png";
  const logo = media["/brand/mark.svg"]?.url || "/brand/mark.svg";
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      graph,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Studybuddy",
            item: origin() + "/",
          },
          { "@type": "ListItem", position: 2, name: title, item: url },
        ],
      },
    ],
  };
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Studybuddy</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : `<link rel="canonical" href="${escapeHtml(url)}">`}
<meta property="og:type" content="${graph["@type"] === "Article" ? "article" : "website"}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="Studybuddy — Learn, practice, and grow together">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
${stylesheet ? `<link rel="stylesheet" href="${escapeHtml(stylesheet)}">` : ""}
<script src="/theme-init.js"></script><script type="application/ld+json">${jsonLd(structured)}</script>
</head><body class="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-100">
<header class="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
<div class="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-5">
<a class="flex items-center gap-3 text-lg font-bold" href="/"><img src="${escapeHtml(logo)}" alt="" width="36" height="36">Studybuddy</a>
<a href="/#explore" class="text-sm text-violet-600 dark:text-violet-300">Explore courses →</a>
</div></header>
<main class="mx-auto max-w-4xl px-6 py-12">
<article class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 dark:border-slate-700 dark:bg-slate-900">
${content}
</article><a href="/" class="mt-8 inline-block text-sm font-semibold text-violet-600 dark:text-violet-300">← Back to Studybuddy</a>
</main></body></html>`;
}
module.exports = { escapeHtml, jsonLd, origin, renderPage };
