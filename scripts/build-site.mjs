import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, readDailyEntries, readTopics, shanghaiDate } from "./lib.mjs";

const DIST = path.join(ROOT, "dist");
const SITE = path.join(ROOT, "site");
const topics = await readTopics();
const entries = await readDailyEntries();
const today = shanghaiDate();
const latest = entries.find((entry) => entry.date <= today) ?? entries[0];
const moduleMap = new Map(topics.modules.map((module) => [module.id, module]));

function inferSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository?.includes("/")) return "";
  const [owner, name] = repository.split("/");
  const suffix = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? "/" : `/${name}/`;
  return `https://${owner}.github.io${suffix}`;
}

const inferredSiteUrl = inferSiteUrl();
const siteUrl = inferredSiteUrl ? inferredSiteUrl.replace(/\/?$/, "/") : "";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value = "") {
  return escapeHtml(value);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function displayDate(date, withYear = true) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(withYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date(`${date}T12:00:00+08:00`));
}

function compactDate(date) {
  const [year, month, day] = date.split("-");
  return { year, month, day };
}

function rootPrefix(depth) {
  return depth === 0 ? "./" : "../".repeat(depth);
}

function absolute(relative) {
  return siteUrl ? new URL(relative.replace(/^\.\//, ""), siteUrl).href : "";
}

function moduleTitle(id) {
  return moduleMap.get(id)?.title ?? id;
}

function pageShell({ title, description, body, depth = 0, page = "article", canonical = "", imageAlt = "每日学习" }) {
  const root = page === "not-found" && siteUrl ? siteUrl : rootPrefix(depth);
  const canonicalUrl = canonical === null ? "" : absolute(canonical);
  const socialImage = absolute("assets/og.png");
  const headLinks = [
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : "",
    `<link rel="alternate" type="application/rss+xml" title="每日学习 RSS" href="${root}feed.xml">`,
    socialImage ? `<meta property="og:image" content="${escapeHtml(socialImage)}"><meta property="og:image:alt" content="${escapeHtml(imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(socialImage)}">` : ""
  ].filter(Boolean).join("\n    ");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#f2eee4">
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="zh_CN">
    <meta property="og:site_name" content="每日学习">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
    ${headLinks}
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${root}assets/styles.css">
    <script defer src="${root}assets/app.js"></script>
  </head>
  <body data-page="${escapeHtml(page)}">
    <div class="reading-progress" aria-hidden="true"><span></span></div>
    <a class="skip-link" href="#main">跳到正文</a>
    ${siteHeader(depth, page, root)}
    ${body}
    ${siteFooter(depth, root)}
  </body>
</html>`;
}

function siteHeader(depth, page, rootOverride) {
  const root = rootOverride ?? rootPrefix(depth);
  return `<header class="site-header">
    <div class="header-inner">
      <a class="wordmark" href="${root}" aria-label="每日学习首页">
        <span class="wordmark-mark">日</span>
        <span class="wordmark-copy"><strong>每日学习</strong><small>DAILY LEARNING</small></span>
      </a>
      <nav class="main-nav" aria-label="主导航">
        <a href="${root}"${page === "article" ? ' aria-current="page"' : ""}>今日</a>
        <a href="${root}archive/"${page === "archive" ? ' aria-current="page"' : ""}>往期</a>
        <a class="rss-link" href="${root}feed.xml">RSS</a>
      </nav>
      <button class="theme-toggle" type="button" aria-label="切换深色模式" title="切换显示模式"><span aria-hidden="true">◐</span></button>
    </div>
  </header>`;
}

function siteFooter(depth, rootOverride) {
  const root = rootOverride ?? rootPrefix(depth);
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div>
        <p class="footer-title">慢慢建立，长期复利。</p>
        <p>约 30% 最新变化，约 70% 长期知识。每天 30–45 分钟。</p>
      </div>
      <div class="footer-links">
        <a href="${root}">今天</a>
        <a href="${root}archive/">全部往期</a>
        <a href="${root}content/archive.json">数据索引</a>
      </div>
    </div>
  </footer>`;
}

function topicPills(entry) {
  return `<div class="topic-pills" aria-label="本期主题">${entry.sections
    .map((section) => `<span>${escapeHtml(moduleTitle(section.module))}</span>`)
    .join("")}</div>`;
}

function hero(entry, isHome) {
  const { month, day } = compactDate(entry.date);
  return `<section class="lesson-hero">
    <div class="hero-orbit" aria-hidden="true"><span>${month}</span><strong>${day}</strong></div>
    <div class="hero-copy">
      <p class="hero-kicker"><span class="status-dot"></span>${isHome ? "今日学习" : "往期学习"} · ${escapeHtml(displayDate(entry.date))}</p>
      <h1>${escapeHtml(entry.title)}</h1>
      <p class="hero-subtitle">${escapeHtml(entry.subtitle)}</p>
      <div class="lesson-meta" aria-label="学习信息">
        <span><b>${entry.estimatedMinutes}</b> 分钟</span>
        <span><b>${entry.sections.length}</b> 个模块</span>
        <span><b>${Math.round(entry.freshRatio * 100)} / ${Math.round((1 - entry.freshRatio) * 100)}</b> 新知与沉淀</span>
      </div>
    </div>
    <div class="hero-note">
      <span>今日母题</span>
      <strong>${escapeHtml(entry.theme)}</strong>
      <a href="#lesson-start">开始学习 <span aria-hidden="true">↓</span></a>
    </div>
  </section>`;
}

function tableOfContents(entry) {
  return `<aside class="lesson-toc" aria-label="本期目录">
    <p class="toc-label">本期路径</p>
    <ol>
      ${entry.sections.map((section, index) => `<li><a href="#${escapeHtml(section.id)}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(moduleTitle(section.module))}</a></li>`).join("")}
      <li><a href="#practice"><span>→</span>今日练习</a></li>
    </ol>
    <div class="mix-card">
      <span>内容配比</span>
      <div class="mix-bar" aria-label="${Math.round(entry.freshRatio * 100)}% 最新变化，${Math.round((1 - entry.freshRatio) * 100)}% 长期知识"><i style="width:${Math.round(entry.freshRatio * 100)}%"></i></div>
      <p><b>${Math.round(entry.freshRatio * 100)}%</b> 最新变化<br><b>${Math.round((1 - entry.freshRatio) * 100)}%</b> 长期知识</p>
    </div>
  </aside>`;
}

function renderSources(sources) {
  if (!sources.length) return "";
  return `<details class="sources">
    <summary>来源与延伸阅读 <span>${sources.length}</span></summary>
    <ol>${sources.map((source) => `<li><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher)}${source.publishedAt ? ` · ${escapeHtml(source.publishedAt)}` : ""}</small></a></li>`).join("")}</ol>
  </details>`;
}

function lessonSection(section, index) {
  const isLatest = section.freshness === "latest";
  return `<section class="lesson-section" id="${escapeHtml(section.id)}" data-lesson-section>
    <div class="section-rail" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div>
    <article>
      <header class="section-header">
        <div class="section-labels">
          <span class="module-label">${escapeHtml(section.eyebrow)}</span>
          <span class="freshness ${isLatest ? "is-latest" : "is-evergreen"}">${isLatest ? "近期变化" : "长期框架"}</span>
          <span class="section-time">${section.estimatedMinutes} min</span>
        </div>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.summary)}</p>
      </header>
      <div class="section-body">${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
      <div class="key-points">
        <p class="mini-heading">值得带走</p>
        <ul>${section.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
      </div>
      <blockquote><span>一句话</span><p>${escapeHtml(section.takeaway)}</p></blockquote>
      <div class="reflection"><span aria-hidden="true">?</span><div><strong>想一想</strong><p>${escapeHtml(section.reflection)}</p></div></div>
      ${renderSources(section.sources)}
    </article>
  </section>`;
}

function practiceBlock(practice) {
  return `<section class="practice-card" id="practice">
    <div class="practice-topline"><span>PUT IT TO WORK</span><b>${escapeHtml(practice.estimatedMinutes)} MIN</b></div>
    <h2>${escapeHtml(practice.title)}</h2>
    <p class="practice-prompt">${escapeHtml(practice.prompt)}</p>
    <ol>${practice.steps.map((step, index) => `<li><span>${index + 1}</span><p>${escapeHtml(step)}</p></li>`).join("")}</ol>
    <button class="copy-practice" type="button" data-copy="${escapeHtml([practice.title, practice.prompt, ...practice.steps.map((step, index) => `${index + 1}. ${step}`)].join("\n"))}">复制练习</button>
  </section>`;
}

function entryNavigation(index, depth) {
  const root = rootPrefix(depth);
  const newer = entries[index - 1];
  const older = entries[index + 1];
  if (!newer && !older) return "";
  return `<nav class="entry-nav" aria-label="往期翻页">
    ${older ? `<a class="entry-prev" href="${root}${older.date}/"><span>← 更早一期</span><strong>${escapeHtml(older.title)}</strong><small>${escapeHtml(displayDate(older.date, false))}</small></a>` : `<span></span>`}
    ${newer ? `<a class="entry-next" href="${root}${newer.date}/"><span>更新一期 →</span><strong>${escapeHtml(newer.title)}</strong><small>${escapeHtml(displayDate(newer.date, false))}</small></a>` : `<a class="entry-next" href="${root}"><span>回到今日 →</span><strong>继续今天的学习</strong></a>`}
  </nav>`;
}

function renderEntryPage(entry, { depth, isHome, index }) {
  const introduction = `<section class="editor-note" id="lesson-start">
    <div class="editor-label"><span>EDITOR'S NOTE</span><i></i></div>
    <div>${entry.introduction.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
  </section>`;
  const article = `<main id="main">
    <div class="page-wrap">
      ${hero(entry, isHome)}
      ${topicPills(entry)}
      ${introduction}
      <div class="lesson-layout">
        ${tableOfContents(entry)}
        <div class="lesson-flow">
          ${entry.sections.map(lessonSection).join("")}
          ${practiceBlock(entry.practice)}
          <section class="closing-note"><span>今天留下什么</span><p>${escapeHtml(entry.closing)}</p></section>
          ${entryNavigation(index, depth)}
        </div>
      </div>
    </div>
  </main>`;
  const title = isHome ? `每日学习｜${entry.title}` : `${entry.date}｜${entry.title}｜每日学习`;
  return pageShell({
    title,
    description: entry.subtitle,
    body: article,
    depth,
    page: "article",
    canonical: isHome ? "" : `${entry.date}/`,
    imageAlt: `${entry.date} 每日学习：${entry.title}`
  });
}

function archiveCard(entry, depth) {
  const root = rootPrefix(depth);
  const { year, month, day } = compactDate(entry.date);
  const searchable = [entry.title, entry.subtitle, entry.theme, ...entry.sections.map((section) => moduleTitle(section.module))].join(" ");
  return `<article class="archive-card" data-archive-card data-search="${escapeHtml(searchable.toLowerCase())}">
    <a href="${root}${entry.date}/" aria-label="阅读 ${entry.date}：${escapeHtml(entry.title)}">
      <div class="archive-date"><strong>${day}</strong><span>${year}.${month}</span></div>
      <div class="archive-copy">
        <p>${escapeHtml(entry.theme)} · ${entry.estimatedMinutes} 分钟</p>
        <h2>${escapeHtml(entry.title)}</h2>
        <span>${escapeHtml(entry.subtitle)}</span>
        <div>${entry.sections.slice(0, 4).map((section) => `<small>${escapeHtml(moduleTitle(section.module))}</small>`).join("")}</div>
      </div>
      <span class="archive-arrow" aria-hidden="true">↗</span>
    </a>
  </article>`;
}

function renderArchivePage() {
  const moduleCounts = new Map();
  for (const entry of entries) {
    for (const section of entry.sections) moduleCounts.set(section.module, (moduleCounts.get(section.module) ?? 0) + 1);
  }
  const archiveBody = `<main id="main">
    <div class="page-wrap archive-page">
      <section class="archive-hero">
        <p class="hero-kicker"><span class="status-dot"></span>LEARNING ARCHIVE</p>
        <h1>把每天的输入，<br><em>连成长期的认知。</em></h1>
        <div class="archive-intro"><p>这里保存每一期完整内容。历史不会被新稿覆盖，你可以按日期回看，也可以搜索一个正在思考的主题。</p><strong>${entries.length}<span>期已归档</span></strong></div>
      </section>
      <section class="module-map" aria-labelledby="module-map-title">
        <div class="section-title-row"><div><span>KNOWLEDGE MAP</span><h2 id="module-map-title">长期覆盖的主题</h2></div><p>四个重点模块作为正式主线，其余主题按周轮换。</p></div>
        <div class="module-grid">${topics.modules.map((module, index) => `<div class="module-chip${module.core ? " is-core" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(module.title)}${module.core ? "<small>核心主线</small>" : ""}</p><b>${moduleCounts.get(module.id) ?? 0}</b></div>`).join("")}</div>
      </section>
      <section class="archive-list" aria-labelledby="archive-list-title">
        <div class="archive-toolbar">
          <div><span>ALL ISSUES</span><h2 id="archive-list-title">全部往期</h2></div>
          <label class="archive-search"><span aria-hidden="true">⌕</span><span class="sr-only">搜索往期内容</span><input type="search" placeholder="搜索主题或标题…" data-archive-search autocomplete="off"></label>
        </div>
        <p class="archive-empty" data-archive-empty hidden>没有找到相符的内容，换个关键词试试。</p>
        <div class="archive-cards">${entries.map((entry) => archiveCard(entry, 1)).join("")}</div>
      </section>
    </div>
  </main>`;
  return pageShell({
    title: "往期归档｜每日学习",
    description: "按日期浏览每日学习往期内容，覆盖广告、营销、品牌、产品、管理、财务、认知科学、AI 与数据分析。",
    body: archiveBody,
    depth: 1,
    page: "archive",
    canonical: "archive/"
  });
}

function render404() {
  const body = `<main id="main" class="not-found"><div><span>404</span><h1>这一页还没有学习笔记。</h1><p>日期可能写错了，或者这一天的内容还没生成。</p><a href="./">回到今日学习</a></div></main>`;
  return pageShell({ title: "页面未找到｜每日学习", description: "没有找到这期每日学习内容。", body, depth: 0, page: "not-found", canonical: null });
}

function archiveData() {
  return entries.map((entry) => ({
    date: entry.date,
    title: entry.title,
    subtitle: entry.subtitle,
    theme: entry.theme,
    estimatedMinutes: entry.estimatedMinutes,
    modules: entry.sections.map((section) => section.module),
    path: `./${entry.date}/`
  }));
}

function renderFeed() {
  const base = siteUrl || "https://example.com/";
  const items = entries.slice(0, 20).map((entry) => `<item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(new URL(`${entry.date}/`, base).href)}</link>
      <guid isPermaLink="true">${escapeXml(new URL(`${entry.date}/`, base).href)}</guid>
      <pubDate>${new Date(`${entry.date}T08:00:00+08:00`).toUTCString()}</pubDate>
      <description>${escapeXml(entry.subtitle)}</description>
    </item>`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>每日学习</title>
    <link>${escapeXml(base)}</link>
    <description>每天 30–45 分钟，约 30% 最新变化与 70% 长期知识。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date(`${latest.date}T08:00:00+08:00`).toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

function renderSitemap() {
  if (!siteUrl) return "";
  const urls = ["", "archive/", ...entries.map((entry) => `${entry.date}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(new URL(url, siteUrl).href)}</loc></url>`).join("\n")}
</urlset>`;
}

async function write(relative, content) {
  const target = path.join(DIST, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, "assets"), { recursive: true });
await Promise.all([
  copyFile(path.join(SITE, "styles.css"), path.join(DIST, "assets", "styles.css")),
  copyFile(path.join(SITE, "app.js"), path.join(DIST, "assets", "app.js"))
]);

try {
  await copyFile(path.join(SITE, "og.png"), path.join(DIST, "assets", "og.png"));
} catch {
  // Social artwork is optional in forks of this template.
}

await write("index.html", renderEntryPage(latest, { depth: 0, isHome: true, index: entries.indexOf(latest) }));
await write("archive/index.html", renderArchivePage());
await write("404.html", render404());
await write("feed.xml", renderFeed());
await write(".nojekyll", "");
await write("robots.txt", siteUrl ? `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", siteUrl).href}\n` : "User-agent: *\nAllow: /\n");
await write("content/latest.json", `${JSON.stringify(latest, null, 2)}\n`);
await write("content/archive.json", `${JSON.stringify(archiveData(), null, 2)}\n`);

if (siteUrl) await write("sitemap.xml", renderSitemap());

for (const [index, entry] of entries.entries()) {
  await write(`${entry.date}/index.html`, renderEntryPage(entry, { depth: 1, isHome: false, index }));
  await write(`content/daily/${entry.date}.json`, `${JSON.stringify(entry, null, 2)}\n`);
}

console.log(`✓ 已构建 ${entries.length} 个日期页面，首页为 ${latest.date}`);
