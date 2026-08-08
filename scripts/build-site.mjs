import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, readDailyEntries, readTopics, shanghaiDate } from "./lib.mjs";

const DIST = path.join(ROOT, "dist");
const SITE = path.join(ROOT, "site");
const topics = await readTopics();
const entries = await readDailyEntries();
const today = shanghaiDate();
const latest = entries.find((entry) => entry.date <= today) ?? entries[0];
const moduleMap = new Map(topics.modules.map((module) => [module.id, module]));

async function readCurriculum() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "config", "curriculum.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      startDate: topics.curriculumStartDate ?? topics.rotationStartDate,
      tracks: topics.modules.map((module) => ({
        module: module.id,
        goal: module.description,
        principles: [],
        newsEligible: false,
        stages: []
      }))
    };
  }
}

const curriculum = await readCurriculum();
const trackMap = new Map(curriculum.tracks.map((track) => [track.module, track]));
const orderedTracks = [
  ...topics.modules.map((module) => trackMap.get(module.id)).filter(Boolean),
  ...curriculum.tracks.filter((track) => !moduleMap.has(track.module))
];

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

function moduleDescription(id) {
  return moduleMap.get(id)?.description ?? trackMap.get(id)?.goal ?? "";
}

function entryLessons(entry) {
  return Array.isArray(entry.lessons) ? entry.lessons : (Array.isArray(entry.sections) ? entry.sections : []);
}

function entryRadar(entry) {
  return Array.isArray(entry.radar) ? entry.radar : [];
}

function entryModules(entry) {
  return [...new Set(entryLessons(entry).map((lesson) => lesson.module).filter(Boolean))];
}

function asParagraphs(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function flattenTrack(track) {
  return (track?.stages ?? []).flatMap((stage, stageIndex) => (stage.units ?? []).map((unit, unitIndex) => ({
    ...unit,
    stageId: stage.id,
    stageTitle: stage.title,
    stageOutcome: stage.outcome,
    stageIndex,
    unitIndex
  })));
}

function lessonSequence(lesson, track) {
  if (Number.isInteger(lesson.curriculum?.sequence)) return lesson.curriculum.sequence;
  const units = flattenTrack(track);
  const index = units.findIndex((unit) => unit.id === lesson.curriculum?.unitId);
  return index >= 0 ? index + 1 : null;
}

function curriculumProgress(cutoff = latest?.date) {
  const relevantEntries = entries.filter((entry) => !cutoff || entry.date <= cutoff);
  const result = new Map();

  for (const track of orderedTracks) {
    const units = flattenTrack(track);
    const learnedUnitIds = new Set();
    const lessonHistory = [];

    for (const entry of relevantEntries) {
      for (const lesson of entryLessons(entry)) {
        if (lesson.module !== track.module) continue;
        const unitId = lesson.curriculum?.unitId;
        if (unitId && units.some((unit) => unit.id === unitId)) learnedUnitIds.add(unitId);
        lessonHistory.push({
          date: entry.date,
          title: entry.title,
          lessonTitle: lesson.title,
          unitId,
          sequence: lessonSequence(lesson, track)
        });
      }
    }

    lessonHistory.sort((a, b) => a.date.localeCompare(b.date));
    const nextUnit = units.find((unit) => !learnedUnitIds.has(unit.id)) ?? units[0] ?? null;
    const completedUnits = learnedUnitIds.size;
    const totalUnits = units.length;
    const currentCycle = totalUnits ? Math.floor(lessonHistory.length / totalUnits) + 1 : 1;
    result.set(track.module, {
      module: track.module,
      title: moduleTitle(track.module),
      completedUnits,
      totalUnits,
      percent: totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0,
      lessonCount: lessonHistory.length,
      currentCycle,
      learnedUnitIds,
      nextUnit,
      lessonHistory
    });
  }

  return result;
}

const currentProgress = curriculumProgress();

function progressData() {
  return {
    schemaVersion: 1,
    throughDate: latest?.date ?? null,
    tracks: orderedTracks.map((track) => {
      const progress = currentProgress.get(track.module);
      return {
        module: track.module,
        title: moduleTitle(track.module),
        completedUnits: progress.completedUnits,
        totalUnits: progress.totalUnits,
        percent: progress.percent,
        lessonCount: progress.lessonCount,
        currentCycle: progress.currentCycle,
        learnedUnitIds: [...progress.learnedUnitIds],
        nextUnit: progress.nextUnit ? {
          id: progress.nextUnit.id,
          title: progress.nextUnit.title,
          stageId: progress.nextUnit.stageId,
          stageTitle: progress.nextUnit.stageTitle
        } : null,
        path: `./curriculum/${track.module}/`
      };
    })
  };
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
        <a href="${root}curriculum/"${page === "curriculum" ? ' aria-current="page"' : ""}>学习地图</a>
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
        <p>核心课程沿知识树推进，行业变化放进独立雷达。每天 30–45 分钟。</p>
      </div>
      <div class="footer-links">
        <a href="${root}">今天</a>
        <a href="${root}curriculum/">学习地图</a>
        <a href="${root}archive/">全部往期</a>
        <a href="${root}content/progress.json">学习进度</a>
      </div>
    </div>
  </footer>`;
}

function topicPills(entry, depth) {
  const root = rootPrefix(depth);
  return `<div class="topic-pills" aria-label="本期主题">${entryModules(entry)
    .map((module) => `<a href="${root}curriculum/${escapeHtml(module)}/">${escapeHtml(moduleTitle(module))}<span aria-hidden="true">↗</span></a>`)
    .join("")}</div>`;
}

function hero(entry, isHome) {
  const { month, day } = compactDate(entry.date);
  const lessons = entryLessons(entry);
  const radar = entryRadar(entry);
  return `<section class="lesson-hero">
    <div class="hero-orbit" aria-hidden="true"><span>${month}</span><strong>${day}</strong></div>
    <div class="hero-copy">
      <p class="hero-kicker"><span class="status-dot"></span>${isHome ? "今日学习" : "往期学习"} · ${escapeHtml(displayDate(entry.date))}</p>
      <h1>${escapeHtml(entry.title)}</h1>
      <p class="hero-subtitle">${escapeHtml(entry.subtitle)}</p>
      <div class="lesson-meta" aria-label="学习信息">
        <span><b>${entry.estimatedMinutes}</b> 分钟</span>
        <span><b>${lessons.length}</b> 节系统课程</span>
        ${radar.length ? `<span><b>${radar.length}</b> 则行业雷达</span>` : ""}
      </div>
    </div>
    <div class="hero-note">
      <span>今日母题</span>
      <strong>${escapeHtml(entry.theme)}</strong>
      <a href="#lesson-start">开始学习 <span aria-hidden="true">↓</span></a>
    </div>
  </section>`;
}

function curriculumBreadcrumb(lesson) {
  const curriculumPosition = lesson.curriculum ?? {};
  const stage = curriculumPosition.stageTitle || trackMap.get(lesson.module)?.stages?.find((item) => item.id === curriculumPosition.stageId)?.title;
  const unit = curriculumPosition.unitTitle;
  return [moduleTitle(lesson.module), stage, unit].filter(Boolean).join(" · ");
}

function todayCurriculumPosition(entry, depth, isHome) {
  const lessons = entryLessons(entry).filter((lesson) => lesson.curriculum);
  if (!lessons.length) return "";
  const root = rootPrefix(depth);
  return `<section class="today-position" aria-labelledby="today-position-title">
    <div class="today-position-intro">
      <span>CURRICULUM POSITION</span>
      <h2 id="today-position-title">${isHome ? "今天" : "本期"}在知识树中的位置</h2>
      <p>每天不是随机抽取一个点，而是沿每个主题的固定课程顺序继续向前。</p>
    </div>
    <div class="today-position-grid">${lessons.map((lesson) => {
      const track = trackMap.get(lesson.module);
      const units = flattenTrack(track);
      const sequence = lessonSequence(lesson, track) ?? 1;
      const total = lesson.curriculum?.totalUnits ?? units.length;
      const stageTitle = lesson.curriculum?.stageTitle || units[sequence - 1]?.stageTitle || "课程主线";
      const progress = total ? Math.min(100, Math.round((sequence / total) * 100)) : 0;
      return `<a class="today-position-card" href="${root}curriculum/${escapeHtml(lesson.module)}/">
        <div><span>${escapeHtml(moduleTitle(lesson.module))}</span><b>${String(sequence).padStart(2, "0")} / ${String(total || 0).padStart(2, "0")}</b></div>
        <p>${escapeHtml(stageTitle)}</p>
        <h3>${escapeHtml(lesson.curriculum?.unitTitle || lesson.title)}</h3>
        <div class="course-progress" role="progressbar" aria-label="${escapeHtml(moduleTitle(lesson.module))}课程位置" aria-valuemin="0" aria-valuemax="${total || 0}" aria-valuenow="${sequence}"><i style="width:${progress}%"></i></div>
        <small>查看完整知识树 <span aria-hidden="true">→</span></small>
      </a>`;
    }).join("")}</div>
  </section>`;
}

function tableOfContents(entry) {
  const lessons = entryLessons(entry);
  const radar = entryRadar(entry);
  const coreMinutes = lessons.reduce((sum, lesson) => sum + (Number(lesson.estimatedMinutes) || 0), 0);
  const radarMinutes = radar.reduce((sum, item) => sum + (Number(item.estimatedMinutes) || 0), 0);
  return `<aside class="lesson-toc" aria-label="本期目录">
    <p class="toc-label">本期路径</p>
    <ol>
      ${lessons.map((lesson, index) => `<li><a href="#${escapeHtml(lesson.id)}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(moduleTitle(lesson.module))}</a></li>`).join("")}
      ${radar.length ? `<li><a href="#radar"><span>R</span>行业雷达</a></li>` : ""}
      ${entry.practice ? `<li><a href="#practice"><span>→</span>今日练习</a></li>` : ""}
    </ol>
    <div class="mix-card course-mix-card">
      <span>学习结构</span>
      <p><b>${coreMinutes || "—"}</b> 分钟系统课程<br>${radar.length ? `<b>${radarMinutes || "—"}</b> 分钟行业雷达` : "本期无独立雷达"}</p>
    </div>
  </aside>`;
}

function renderSources(sources = []) {
  if (!sources.length) return "";
  return `<details class="sources">
    <summary>来源与延伸阅读 <span>${sources.length}</span></summary>
    <ol>${sources.map((source) => `<li><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher)}${source.publishedAt ? ` · ${escapeHtml(source.publishedAt)}` : ""}</small></a></li>`).join("")}</ol>
  </details>`;
}

function renderApplication(application) {
  if (!application) return "";
  if (typeof application === "string") {
    return `<div class="lesson-application"><span>APPLY</span><p>${escapeHtml(application)}</p></div>`;
  }
  const title = application.title ?? application.label ?? "如何应用";
  const description = application.prompt ?? application.description ?? application.body ?? "";
  const steps = application.steps ?? application.items ?? [];
  return `<div class="lesson-application"><span>APPLY</span><h3>${escapeHtml(title)}</h3>${description ? `<p>${escapeHtml(description)}</p>` : ""}${steps.length ? `<ul>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>` : ""}</div>`;
}

function lessonSection(lesson, index, depth) {
  const root = rootPrefix(depth);
  const curriculumPosition = lesson.curriculum ?? {};
  const stageLabel = curriculumPosition.stageTitle || "课程主线";
  const sequence = curriculumPosition.sequence;
  const total = curriculumPosition.totalUnits;
  const isLegacyLatest = lesson.freshness === "latest";
  return `<section class="lesson-section" id="${escapeHtml(lesson.id)}" data-lesson-section>
    <div class="section-rail" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div>
    <article>
      <header class="section-header">
        <div class="section-labels">
          <a class="module-label" href="${root}curriculum/${escapeHtml(lesson.module)}/">${escapeHtml(lesson.eyebrow || moduleTitle(lesson.module))}</a>
          ${lesson.curriculum ? `<span class="freshness is-evergreen">${escapeHtml(stageLabel)}</span>` : `<span class="freshness ${isLegacyLatest ? "is-latest" : "is-evergreen"}">${isLegacyLatest ? "近期变化" : "长期框架"}</span>`}
          ${sequence ? `<span class="course-sequence">第 ${sequence}${total ? ` / ${total}` : ""} 课</span>` : ""}
          <span class="section-time">${lesson.estimatedMinutes} min</span>
        </div>
        ${lesson.curriculum ? `<p class="course-breadcrumb">${escapeHtml(curriculumBreadcrumb(lesson))}</p>` : ""}
        <h2>${escapeHtml(lesson.title)}</h2>
        <p>${escapeHtml(lesson.summary)}</p>
      </header>
      ${(lesson.learningObjectives ?? []).length ? `<div class="lesson-objectives"><span>学完你会</span><ul>${lesson.learningObjectives.map((objective) => `<li>${escapeHtml(objective)}</li>`).join("")}</ul></div>` : ""}
      <div class="section-body">${asParagraphs(lesson.body).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
      ${(lesson.keyPoints ?? []).length ? `<div class="key-points"><p class="mini-heading">值得带走</p><ul>${lesson.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>` : ""}
      ${renderApplication(lesson.application)}
      ${lesson.boundary ? `<div class="lesson-boundary"><span>适用边界</span><p>${escapeHtml(lesson.boundary)}</p></div>` : ""}
      ${lesson.takeaway ? `<blockquote><span>一句话</span><p>${escapeHtml(lesson.takeaway)}</p></blockquote>` : ""}
      ${lesson.reflection ? `<div class="reflection"><span aria-hidden="true">?</span><div><strong>想一想</strong><p>${escapeHtml(lesson.reflection)}</p></div></div>` : ""}
      ${renderSources(lesson.sources)}
    </article>
  </section>`;
}

function radarSection(items, depth) {
  if (!items.length) return "";
  const root = rootPrefix(depth);
  return `<section class="radar-section" id="radar" data-lesson-section>
    <header class="radar-header">
      <div><span>INDUSTRY RADAR</span><h2>行业变化，单独观察</h2></div>
      <p>最新事件只作为课程的证据与案例，不打乱核心知识的学习顺序。</p>
    </header>
    <div class="radar-grid">${items.map((item) => `<article class="radar-card" id="${escapeHtml(item.id)}">
      <div class="radar-card-meta"><span>近期变化</span>${item.estimatedMinutes ? `<b>${item.estimatedMinutes} min</b>` : ""}</div>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="radar-summary">${escapeHtml(item.summary)}</p>` : ""}
      <div class="radar-body">${asParagraphs(item.body).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
      ${(item.relatedModules ?? []).length ? `<div class="radar-related"><span>关联课程</span>${item.relatedModules.map((module) => `<a href="${root}curriculum/${escapeHtml(module)}/">${escapeHtml(moduleTitle(module))}</a>`).join("")}</div>` : ""}
      ${renderSources(item.sources)}
    </article>`).join("")}</div>
  </section>`;
}

function practiceBlock(practice) {
  if (!practice) return "";
  const steps = practice.steps ?? [];
  return `<section class="practice-card" id="practice">
    <div class="practice-topline"><span>PUT IT TO WORK</span><b>${escapeHtml(practice.estimatedMinutes)} MIN</b></div>
    <h2>${escapeHtml(practice.title)}</h2>
    <p class="practice-prompt">${escapeHtml(practice.prompt)}</p>
    <ol>${steps.map((step, index) => `<li><span>${index + 1}</span><p>${escapeHtml(step)}</p></li>`).join("")}</ol>
    <button class="copy-practice" type="button" data-copy="${escapeHtml([practice.title, practice.prompt, ...steps.map((step, index) => `${index + 1}. ${step}`)].filter(Boolean).join("\n"))}">复制练习</button>
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
    <div>${asParagraphs(entry.introduction).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
  </section>`;
  const lessons = entryLessons(entry);
  const radar = entryRadar(entry);
  const article = `<main id="main">
    <div class="page-wrap">
      ${hero(entry, isHome)}
      ${topicPills(entry, depth)}
      ${todayCurriculumPosition(entry, depth, isHome)}
      ${introduction}
      <div class="lesson-layout">
        ${tableOfContents(entry)}
        <div class="lesson-flow">
          ${lessons.map((lesson, lessonIndex) => lessonSection(lesson, lessonIndex, depth)).join("")}
          ${radarSection(radar, depth)}
          ${practiceBlock(entry.practice)}
          ${entry.closing ? `<section class="closing-note"><span>今天留下什么</span><p>${escapeHtml(entry.closing)}</p></section>` : ""}
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
  const lessons = entryLessons(entry);
  const searchable = [entry.title, entry.subtitle, entry.theme, ...lessons.map((lesson) => moduleTitle(lesson.module)), ...lessons.map((lesson) => lesson.title)].join(" ");
  return `<article class="archive-card" data-archive-card data-search="${escapeHtml(searchable.toLowerCase())}">
    <a href="${root}${entry.date}/" aria-label="阅读 ${entry.date}：${escapeHtml(entry.title)}">
      <div class="archive-date"><strong>${day}</strong><span>${year}.${month}</span></div>
      <div class="archive-copy">
        <p>${escapeHtml(entry.theme)} · ${entry.estimatedMinutes} 分钟</p>
        <h2>${escapeHtml(entry.title)}</h2>
        <span>${escapeHtml(entry.subtitle)}</span>
        <div>${entryModules(entry).slice(0, 4).map((module) => `<small>${escapeHtml(moduleTitle(module))}</small>`).join("")}</div>
      </div>
      <span class="archive-arrow" aria-hidden="true">↗</span>
    </a>
  </article>`;
}

function renderArchivePage() {
  const moduleCounts = new Map();
  for (const entry of entries) {
    for (const lesson of entryLessons(entry)) moduleCounts.set(lesson.module, (moduleCounts.get(lesson.module) ?? 0) + 1);
  }
  const archiveBody = `<main id="main">
    <div class="page-wrap archive-page">
      <section class="archive-hero">
        <p class="hero-kicker"><span class="status-dot"></span>LEARNING ARCHIVE</p>
        <h1>把每天的输入，<br><em>连成长期的认知。</em></h1>
        <div class="archive-intro"><p>这里保存每一期完整内容。历史不会被新稿覆盖；你既可以按日期回看，也可以回到学习地图，看每一期在课程中的位置。</p><strong>${entries.length}<span>期已归档</span></strong></div>
      </section>
      <section class="module-map" aria-labelledby="module-map-title">
        <div class="section-title-row"><div><span>KNOWLEDGE MAP</span><h2 id="module-map-title">13 条完整学习主线</h2></div><p>每个主题都有独立的阶段、核心知识与固定顺序。</p></div>
        <div class="module-grid">${topics.modules.map((module, index) => `<a href="../curriculum/${escapeHtml(module.id)}/" class="module-chip${module.core ? " is-core" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(module.title)}${module.core ? "<small>核心主线</small>" : ""}</p><b>${moduleCounts.get(module.id) ?? 0}</b></a>`).join("")}</div>
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
    description: "按日期浏览每日学习往期内容，并回到 13 个主题的系统课程中继续学习。",
    body: archiveBody,
    depth: 1,
    page: "archive",
    canonical: "archive/"
  });
}

function curriculumCard(track, index) {
  const progress = currentProgress.get(track.module);
  const module = moduleMap.get(track.module);
  const stages = track.stages ?? [];
  return `<a class="curriculum-card${module?.core ? " is-core" : ""}" href="./${escapeHtml(track.module)}/">
    <div class="curriculum-card-top"><span>${String(index + 1).padStart(2, "0")}</span>${module?.core ? "<b>核心主线</b>" : ""}</div>
    <h2>${escapeHtml(moduleTitle(track.module))}</h2>
    <p>${escapeHtml(track.goal || moduleDescription(track.module))}</p>
    <div class="curriculum-stage-preview">${stages.slice(0, 4).map((stage) => `<small>${escapeHtml(stage.title)}</small>`).join("")}${stages.length > 4 ? `<small>+ ${stages.length - 4} 个阶段</small>` : ""}</div>
    <div class="curriculum-card-progress">
      <div><span>已学 ${progress.completedUnits} / ${progress.totalUnits}</span><b>${progress.percent}%</b></div>
      <div class="course-progress"><i style="width:${progress.percent}%"></i></div>
    </div>
    <div class="curriculum-next"><span>下一课</span><strong>${escapeHtml(progress.nextUnit?.title ?? "课程即将开始")}</strong></div>
  </a>`;
}

function renderCurriculumPage() {
  const totalUnits = orderedTracks.reduce((sum, track) => sum + flattenTrack(track).length, 0);
  const completedUnits = [...currentProgress.values()].reduce((sum, progress) => sum + progress.completedUnits, 0);
  const body = `<main id="main">
    <div class="page-wrap curriculum-page">
      <section class="curriculum-hero">
        <div>
          <p class="hero-kicker"><span class="status-dot"></span>STRUCTURED CURRICULUM</p>
          <h1>不是知识碎片，<br><em>而是 13 棵知识树。</em></h1>
        </div>
        <div class="curriculum-hero-copy">
          <p>每个主题从基础概念、分析框架一路走向实际应用。每天只推进其中一小步，长期积累成完整的能力结构。</p>
          <dl><div><dt>${orderedTracks.length}</dt><dd>条主题主线</dd></div><div><dt>${totalUnits}</dt><dd>个核心单元</dd></div><div><dt>${completedUnits}</dt><dd>个单元已学</dd></div></dl>
        </div>
      </section>
      <section class="curriculum-overview" aria-labelledby="curriculum-overview-title">
        <div class="section-title-row"><div><span>KNOWLEDGE TREES</span><h2 id="curriculum-overview-title">选择一条主线深入</h2></div><p>进入主题后可以查看全部阶段、已学内容和下一课。</p></div>
        <div class="curriculum-grid">${orderedTracks.map(curriculumCard).join("")}</div>
      </section>
      <section class="curriculum-method">
        <div><span>01</span><h2>主线按顺序推进</h2><p>当天内容由课程位置决定，不随意抽取孤立知识点。</p></div>
        <div><span>02</span><h2>新变化独立观察</h2><p>新闻、平台更新与案例进入行业雷达，用来补充而不是替代课程。</p></div>
        <div><span>03</span><h2>每次学习可回看</h2><p>所有日期永久归档，主题页把分散日期重新连回同一条知识路径。</p></div>
      </section>
    </div>
  </main>`;
  return pageShell({
    title: "学习地图｜每日学习",
    description: "13 个主题的系统课程地图：分阶段、按顺序学习，并自动记录已学内容与下一课。",
    body,
    depth: 1,
    page: "curriculum",
    canonical: "curriculum/"
  });
}

function unitHistoryMap(progress) {
  const map = new Map();
  for (const item of progress.lessonHistory) {
    if (item.unitId) map.set(item.unitId, item);
  }
  return map;
}

function renderTrackPage(track) {
  const module = moduleMap.get(track.module) ?? { title: track.module, description: track.goal };
  const progress = currentProgress.get(track.module);
  const historyByUnit = unitHistoryMap(progress);
  const relatedEntries = entries.filter((entry) => entryLessons(entry).some((lesson) => lesson.module === track.module));
  const body = `<main id="main">
    <div class="page-wrap track-page">
      <nav class="crumbs" aria-label="面包屑"><a href="../../curriculum/">学习地图</a><span>／</span><span>${escapeHtml(module.title)}</span></nav>
      <section class="track-hero">
        <div class="track-heading">
          <p class="hero-kicker"><span class="status-dot"></span>${module.core ? "CORE CURRICULUM" : "CURRICULUM TRACK"}</p>
          <h1>${escapeHtml(module.title)}</h1>
          <p>${escapeHtml(track.goal || module.description)}</p>
        </div>
        <aside class="track-progress-panel">
          <div><span>当前进度</span><strong>${progress.percent}<small>%</small></strong></div>
          <div class="course-progress" role="progressbar" aria-label="${escapeHtml(module.title)}学习进度" aria-valuemin="0" aria-valuemax="${progress.totalUnits}" aria-valuenow="${progress.completedUnits}"><i style="width:${progress.percent}%"></i></div>
          <p>已学 ${progress.completedUnits} / ${progress.totalUnits} 个单元 · 第 ${progress.currentCycle} 轮</p>
          <div class="track-next"><span>下一课</span><b>${escapeHtml(progress.nextUnit?.stageTitle ?? "课程")}</b><strong>${escapeHtml(progress.nextUnit?.title ?? "即将开始")}</strong></div>
        </aside>
      </section>
      ${(track.principles ?? []).length ? `<section class="track-principles"><div><span>LEARNING PRINCIPLES</span><h2>这条主线如何学习</h2></div><ol>${track.principles.map((principle, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(principle)}</p></li>`).join("")}</ol></section>` : ""}
      <section class="knowledge-tree" aria-labelledby="knowledge-tree-title">
        <div class="section-title-row"><div><span>FULL ROADMAP</span><h2 id="knowledge-tree-title">完整分阶段知识树</h2></div><p>${track.stages?.length ?? 0} 个阶段 · ${progress.totalUnits} 个核心单元</p></div>
        <div class="stage-list">${(track.stages ?? []).map((stage, stageIndex) => `<section class="stage-block">
          <header><span>${String(stageIndex + 1).padStart(2, "0")}</span><div><p>STAGE ${stageIndex + 1}</p><h3>${escapeHtml(stage.title)}</h3><small>${escapeHtml(stage.outcome)}</small></div></header>
          <ol>${(stage.units ?? []).map((unit, unitIndex) => {
            const history = historyByUnit.get(unit.id);
            const isNext = progress.nextUnit?.id === unit.id;
            const state = history ? "is-complete" : (isNext ? "is-next" : "is-upcoming");
            const status = history ? "已学" : (isNext ? "下一课" : "待学习");
            const content = `<span class="unit-index">${String(unitIndex + 1).padStart(2, "0")}</span><p>${escapeHtml(unit.title)}</p><b>${status}</b>${history ? `<small>${escapeHtml(history.date)}</small>` : ""}`;
            return `<li class="${state}">${history ? `<a href="../../${history.date}/">${content}</a>` : `<div>${content}</div>`}</li>`;
          }).join("")}</ol>
        </section>`).join("")}</div>
      </section>
      <section class="track-history" aria-labelledby="track-history-title">
        <div class="section-title-row"><div><span>LEARNING RECORD</span><h2 id="track-history-title">这条主线的学习记录</h2></div><p>每一期都保留在日期归档中。</p></div>
        ${relatedEntries.length ? `<div class="track-history-list">${relatedEntries.map((entry) => {
          const lesson = entryLessons(entry).find((item) => item.module === track.module);
          return `<a href="../../${entry.date}/"><time>${escapeHtml(entry.date)}</time><div><span>${escapeHtml(lesson.curriculum?.stageTitle ?? module.title)}</span><h3>${escapeHtml(lesson.title)}</h3></div><b aria-hidden="true">↗</b></a>`;
        }).join("")}</div>` : `<p class="track-empty">第一课尚未发布。知识树已经准备好，会按照固定顺序开始推进。</p>`}
      </section>
    </div>
  </main>`;
  return pageShell({
    title: `${module.title}｜学习地图｜每日学习`,
    description: track.goal || module.description,
    body,
    depth: 2,
    page: "curriculum",
    canonical: `curriculum/${track.module}/`
  });
}

function render404() {
  const home = siteUrl || "./";
  const body = `<main id="main" class="not-found"><div><span>404</span><h1>这一页还没有学习笔记。</h1><p>日期可能写错了，或者这一天的内容还没生成。</p><a href="${escapeHtml(home)}">回到今日学习</a></div></main>`;
  return pageShell({ title: "页面未找到｜每日学习", description: "没有找到这期每日学习内容。", body, depth: 0, page: "not-found", canonical: null });
}

function archiveData() {
  return entries.map((entry) => ({
    date: entry.date,
    title: entry.title,
    subtitle: entry.subtitle,
    theme: entry.theme,
    estimatedMinutes: entry.estimatedMinutes,
    modules: entryModules(entry),
    lessons: entryLessons(entry).map((lesson) => ({
      id: lesson.id,
      module: lesson.module,
      title: lesson.title,
      curriculum: lesson.curriculum ?? null
    })),
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
    <description>沿 13 条系统课程主线持续学习，行业变化放进独立雷达。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date(`${latest.date}T08:00:00+08:00`).toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

function renderSitemap() {
  if (!siteUrl) return "";
  const urls = [
    "",
    "archive/",
    "curriculum/",
    ...orderedTracks.map((track) => `curriculum/${track.module}/`),
    ...entries.map((entry) => `${entry.date}/`)
  ];
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
await write("curriculum/index.html", renderCurriculumPage());
await write("404.html", render404());
await write("feed.xml", renderFeed());
await write(".nojekyll", "");
await write("robots.txt", siteUrl ? `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", siteUrl).href}\n` : "User-agent: *\nAllow: /\n");
await write("content/latest.json", `${JSON.stringify(latest, null, 2)}\n`);
await write("content/archive.json", `${JSON.stringify(archiveData(), null, 2)}\n`);
await write("content/curriculum.json", `${JSON.stringify(curriculum, null, 2)}\n`);
await write("content/progress.json", `${JSON.stringify(progressData(), null, 2)}\n`);

if (siteUrl) await write("sitemap.xml", renderSitemap());

for (const track of orderedTracks) {
  await write(`curriculum/${track.module}/index.html`, renderTrackPage(track));
}

for (const [index, entry] of entries.entries()) {
  await write(`${entry.date}/index.html`, renderEntryPage(entry, { depth: 1, isHome: false, index }));
  await write(`content/daily/${entry.date}.json`, `${JSON.stringify(entry, null, 2)}\n`);
}

console.log(`✓ 已构建 ${entries.length} 个日期页面与 ${orderedTracks.length} 条课程主线，首页为 ${latest.date}`);
