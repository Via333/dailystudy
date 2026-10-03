import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, readDailyEntries, readTopics, shanghaiDate } from "./lib.mjs";

const DIST = path.join(ROOT, "dist");
const SITE = path.join(ROOT, "site");
import { readIdentities, identityContext, identityPlanForDate, identityProgress } from "./identities.mjs";
const identities = await readIdentities();
const topics = await readTopics();
const entries = await readDailyEntries();

async function readStarterLessons() {
  try {
    const data = JSON.parse(await readFile(path.join(ROOT, "content", "starter-lessons.json"), "utf8"));
    return Array.isArray(data?.lessons) ? data.lessons : [];
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return [];
  }
}

const starterLessons = await readStarterLessons();
const today = shanghaiDate();
const latest = entries.find((entry) => entry.date <= today) ?? entries[0];
const moduleMap = new Map(topics.modules.map((module) => [module.id, module]));
const starterLessonMap = new Map(starterLessons.map((lesson) => [lesson.module, lesson]));
const learningDomains = topics.learningDomains?.length
  ? topics.learningDomains
  : [{ id: "all", title: "全部主题", description: "完整学习体系", modules: topics.modules.map((module) => module.id) }];
const scheduleDayByModule = new Map();
topics.dailySchedule.forEach((modules, dayIndex) => {
  modules.forEach((module) => scheduleDayByModule.set(module, dayIndex + 1));
});

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
    const publishedUnitIds = new Set();
    const lessonHistory = [];

    for (const entry of relevantEntries) {
      for (const lesson of entryLessons(entry)) {
        if (lesson.module !== track.module) continue;
        const unitId = lesson.curriculum?.unitId;
        if (unitId && units.some((unit) => unit.id === unitId)) publishedUnitIds.add(unitId);
        lessonHistory.push({
          date: entry.date,
          lessonId: lesson.id,
          learningIdentity: lesson.learningIdentity ?? null,
          title: entry.title,
          lessonTitle: lesson.title,
          unitId,
          sequence: lessonSequence(lesson, track)
        });
      }
    }

    lessonHistory.sort((a, b) => a.date.localeCompare(b.date));
    const completedUnits = publishedUnitIds.size;
    const totalUnits = units.length;
    const nextUnit = units.find((unit) => !publishedUnitIds.has(unit.id))
      ?? (totalUnits ? units[lessonHistory.length % totalUnits] : null);
    const currentCycle = totalUnits ? Math.floor(lessonHistory.length / totalUnits) + 1 : 1;
    result.set(track.module, {
      module: track.module,
      title: moduleTitle(track.module),
      completedUnits,
      totalUnits,
      percent: totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0,
      lessonCount: lessonHistory.length,
      currentCycle,
      publishedUnitIds,
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
        publishedUnitIds: [...progress.publishedUnitIds],
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

function pageShell({ title, description, body, depth = 0, page = "article", canonical = "", imageAlt = "每日学习", identity = null }) {
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
    <meta name="theme-color" content="#f5f6f8">
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
    ${siteHeader(depth, page, root, identity)}
    ${body}
    ${siteFooter(depth, root, identity)}
  </body>
</html>`;
}

function siteHeader(depth, page, rootOverride, identity = null) {
  const root = rootOverride ?? rootPrefix(depth);
  return `<header class="site-header">
    <div class="header-inner">
      <a class="wordmark" href="${identity ? `${root}${identity.path}/` : root}" aria-label="${identity ? escapeHtml(identity.title) : "每日学习首页"}">
        <span class="wordmark-mark">日</span>
        <span class="wordmark-copy"><strong>${identity ? escapeHtml(identity.title) : "每日学习"}</strong><small>DAILY LEARNING</small></span>
      </a>
      <nav class="main-nav${identity ? " identity-nav" : ""}" aria-label="主导航">
        ${identity ? `<a href="${root}${identity.path}/">${escapeHtml(identity.title)}</a><a href="${root}${identity.path}/#identity-curriculum">课程</a><a href="${root}${identity.path}/#identity-history">记录</a><a href="${root}">总览</a>` : `
        <a href="${root}"${page === "article" ? ' aria-current="page"' : ""}>今日</a>
        <a href="${root}curriculum/"${page === "curriculum" ? ' aria-current="page"' : ""}>学习地图</a>
        <a href="${root}archive/"${page === "archive" ? ' aria-current="page"' : ""}>往期</a>
        <a class="rss-link" href="${root}feed.xml">RSS</a>`}
      </nav>
      <button class="theme-toggle" type="button" aria-label="切换深色模式" title="切换显示模式"><span aria-hidden="true">◐</span></button>
    </div>
  </header>`;
}

function siteFooter(depth, rootOverride, identity = null) {
  const root = rootOverride ?? rootPrefix(depth);
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div>
        <p class="footer-title">慢慢建立，长期复利。</p>
        <p>核心课程沿知识树推进，行业变化放进独立雷达。每天 30–45 分钟。</p>
      </div>
      <div class="footer-links">
        ${identity ? `<a href="${root}${identity.path}/">${escapeHtml(identity.title)}</a>` : `<a href="${root}">今天</a>`}
        <a href="${root}curriculum/">学习地图</a>
        <a href="${root}archive/">全部往期</a>
        <a href="${root}content/progress.json">全站发布进度</a>
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
  const moduleNames = entryModules(entry).map((module) => moduleTitle(module)).join(" · ");
  return `<section class="lesson-hero">
    <div class="hero-orbit" aria-hidden="true"><span>${month}</span><strong>${day}</strong></div>
    <div class="hero-copy">
      <p class="hero-kicker"><span class="status-dot"></span>${isHome ? "今日学习" : "往期学习"} · ${escapeHtml(displayDate(entry.date))}</p>
      <h1>${escapeHtml(entry.title)}</h1>
      <p class="hero-subtitle">${escapeHtml(entry.subtitle)}</p>
      <div class="lesson-meta" aria-label="学习信息">
        <span><b>${topics.modules.length}</b> 条完整主线</span>
        <span><b>${lessons.length}</b> 条今日推进</span>
        <span><b>${entry.estimatedMinutes}</b> 分钟</span>
      </div>
    </div>
    <div class="hero-note">
      <span>当日独立更新</span>
      <strong>${escapeHtml(moduleNames || `${lessons.length} 条课程`)}</strong>
      <a href="#today-plan">查看今日计划 <span aria-hidden="true">↓</span></a>
    </div>
  </section>`;
}

function todayCurriculumPosition(entry, depth, isHome) {
  const lessons = entryLessons(entry).filter((lesson) => lesson.curriculum);
  if (!lessons.length) return "";
  const root = rootPrefix(depth);
  return `<section class="today-position" aria-labelledby="today-position-title">
    <div class="today-position-intro">
      <span>TODAY'S FOCUS</span>
      <h2 id="today-position-title">${isHome ? `今天深入 ${lessons.length} 条主线` : "本期课程位置"}</h2>
      <p>${isHome ? `这是 7 天轮换中的一天；其余 ${Math.max(0, topics.modules.length - lessons.length)} 条主线不会消失，会按固定顺序继续推进。` : "本期内容沿每个主题的固定课程顺序推进。"}</p>
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
        <p>${escapeHtml(stageTitle)} · ${escapeHtml(lesson.curriculum?.unitTitle || "当前单元")}</p>
        <h3>${escapeHtml(lesson.coreQuestion || lesson.curriculum?.unitTitle)}</h3>
        <div class="course-progress" role="progressbar" aria-label="${escapeHtml(moduleTitle(lesson.module))}课程位置" aria-valuemin="0" aria-valuemax="${total || 0}" aria-valuenow="${sequence}"><i style="width:${progress}%"></i></div>
        <small>查看完整知识树 <span aria-hidden="true">→</span></small>
      </a>`;
    }).join("")}</div>
  </section>`;
}

function learningSystemOverview(entry, depth) {
  const root = rootPrefix(depth);
  const todayModules = new Set(entryModules(entry));
  const totalUnits = orderedTracks.reduce((sum, track) => sum + flattenTrack(track).length, 0);
  return `<section class="learning-system" aria-labelledby="learning-system-title">
    <div class="learning-system-head">
      <div><span>INDEPENDENT LEARNING LIBRARY</span><h2 id="learning-system-title">13 个独立主题，现在都能开始学</h2></div>
      <p>每条主线都有自己的核心问题、知识框架和练习，不需要与当天其他主题强行关联。点击任意卡片，直接阅读完整起步课。</p>
      <div class="learning-system-stats" aria-label="课程体系规模"><span><b>${topics.modules.length}</b> 条独立主线</span><span><b>${starterLessons.length}</b> 节起步课</span><span><b>${totalUnits}</b> 个规划单元</span></div>
    </div>
    <div class="system-browser">
      <div class="system-domains">${learningDomains.map((domain) => `<section class="system-domain">
        <header><div><span>${escapeHtml(domain.title)}</span><small>${escapeHtml(domain.description)}</small></div><b>${domain.modules.length}</b></header>
        <div>${domain.modules.map((module) => {
          const progress = currentProgress.get(module);
          const isToday = todayModules.has(module);
          const starter = starterLessonMap.get(module);
          const coreQuestion = starter?.coreQuestion || progress?.nextUnit?.title || moduleDescription(module);
          const conclusion = starter?.conclusion || moduleDescription(module);
          return `<a class="system-topic${isToday ? " is-today" : ""}" href="${root}curriculum/${escapeHtml(module)}/">
            <div><span>${escapeHtml(moduleTitle(module))}</span><small>${isToday ? "今日有更新" : "起步课可读"}</small></div>
            <h3>${escapeHtml(coreQuestion)}</h3>
            <p>${escapeHtml(conclusion)}</p>
            <b>进入主题并阅读起步课 <span aria-hidden="true">→</span></b>
          </a>`;
        }).join("")}</div>
      </section>`).join("")}</div>
    </div>
    <a class="system-map-link" href="${root}curriculum/">打开完整学习地图 <span aria-hidden="true">→</span></a>
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
    </ol>
    <div class="mix-card course-mix-card">
      <span>学习结构</span>
      <p><b>${coreMinutes || "—"}</b> 分钟独立课程<br>${radar.length ? `<b>${radarMinutes || "—"}</b> 分钟可选雷达` : "本期无独立雷达"}</p>
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

function lessonSection(lesson, index, depth, identity = null) {
  const root = rootPrefix(depth);
  const curriculumPosition = lesson.curriculum ?? {};
  const stageLabel = curriculumPosition.stageTitle || "课程主线";
  const sequence = curriculumPosition.sequence;
  const total = curriculumPosition.totalUnits;
  const framework = lesson.framework ?? {};
  const keyPoints = lesson.keyPoints ?? [];
  const caseStudy = lesson.caseStudy ?? {};
  const exercise = lesson.exercise ?? {};
  return `<section class="lesson-section" id="${escapeHtml(lesson.id)}" data-lesson-section>
    <div class="section-rail" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div>
    <article>
      <header class="section-header">
        <div class="section-labels">
          <a class="module-label" href="${root}${identity ? `${identity.path}/` : ""}curriculum/${escapeHtml(lesson.module)}/">${escapeHtml(moduleTitle(lesson.module))}</a>
          ${lesson.learningIdentity ? `<a class="identity-label" href="${root}${identityById(lesson.learningIdentity).path}/">${escapeHtml(identityById(lesson.learningIdentity).title)}</a>` : ""}
          <span class="freshness is-evergreen">${escapeHtml(stageLabel)}</span>
          ${sequence ? `<span class="course-sequence">第 ${sequence}${total ? ` / ${total}` : ""} 课</span>` : ""}
          <span class="section-time">${lesson.estimatedMinutes} min</span>
        </div>
        <p class="course-unit">${escapeHtml(curriculumPosition.unitTitle || stageLabel)}</p>
        <h2>${escapeHtml(lesson.coreQuestion)}</h2>
      </header>
      <section class="framework-card">
        <header><span>FRAMEWORK · 核心框架</span><h3>${escapeHtml(framework.name)}</h3><p>${escapeHtml(framework.definition)}</p></header>
        <ol>${(framework.steps ?? []).map((step, stepIndex) => `<li><span>${stepIndex + 1}</span><div><h4>${escapeHtml(step.title)}</h4><p>${escapeHtml(step.text)}</p></div></li>`).join("")}</ol>
        ${framework.boundary ? `<details class="framework-boundary"><summary>适用边界 <span aria-hidden="true">＋</span></summary><p>${escapeHtml(framework.boundary)}</p></details>` : ""}
      </section>
      <section class="lesson-key-points" aria-label="三个关键点">
        <p class="mini-heading">3 KEY POINTS · 三个重点</p>
        <div>${keyPoints.map((point, pointIndex) => `<article><span>${String(pointIndex + 1).padStart(2, "0")}</span><h3>${escapeHtml(point.title)}</h3><p>${escapeHtml(point.text)}</p></article>`).join("")}</div>
      </section>
      <section class="case-study">
        <div class="case-study-label"><span>CASE · 例子</span><b>${escapeHtml(caseStudy.title)}</b></div>
        <p>${escapeHtml(caseStudy.context)}</p>
        <div><span>拆解</span><p>${escapeHtml(caseStudy.analysis)}</p></div>
        <strong>${escapeHtml(caseStudy.lesson)}</strong>
      </section>
      <section class="lesson-exercise">
        <div><span>TRY IT · 立即应用</span><h3>${escapeHtml(exercise.prompt)}</h3></div>
        <ol>${(exercise.steps ?? []).map((step, stepIndex) => `<li><span>${stepIndex + 1}</span><p>${escapeHtml(step)}</p></li>`).join("")}</ol>
        <p class="exercise-deliverable"><b>输出</b>${escapeHtml(exercise.deliverable)}</p>
      </section>
      <div class="lesson-conclusion"><span>一句结论</span><p>${escapeHtml(lesson.conclusion)}</p></div>
      ${renderSources(lesson.sources)}
    </article>
  </section>`;
}

function radarSection(items, depth) {
  if (!items.length) return "";
  const root = rootPrefix(depth);
  const totalMinutes = items.reduce((sum, item) => sum + (Number(item.estimatedMinutes) || 0), 0);
  return `<details class="radar-section" id="radar" data-lesson-section>
    <summary class="radar-header">
      <div><span>OPTIONAL · INDEPENDENT RADAR</span><h2>独立行业雷达</h2></div>
      <p>${totalMinutes || 5} 分钟 · 独立观察，不与课程强行关联 <b aria-hidden="true">＋</b></p>
    </summary>
    <div class="radar-grid">${items.map((item) => {
      const radarModule = item.module;
      return `<article class="radar-card" id="${escapeHtml(item.id)}">
      <div class="radar-card-meta"><span>近期变化</span>${item.estimatedMinutes ? `<b>${item.estimatedMinutes} min</b>` : ""}</div>
      <h3>${escapeHtml(item.title)}</h3>
      <dl class="radar-points"><div><dt>发生了什么</dt><dd>${escapeHtml(item.whatChanged)}</dd></div><div><dt>为什么重要</dt><dd>${escapeHtml(item.whyItMatters)}</dd></div><div><dt>接下来观察</dt><dd>${escapeHtml(item.watchNext)}</dd></div></dl>
      ${radarModule ? `<div class="radar-related"><span>所属领域</span><a href="${root}curriculum/${escapeHtml(radarModule)}/">${escapeHtml(moduleTitle(radarModule))}</a></div>` : ""}
      ${renderSources(item.sources)}
    </article>`;
    }).join("")}</div>
  </details>`;
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
  const introduction = asParagraphs(entry.introduction).length ? `<section class="daily-brief" id="lesson-start">
    <span>今日学习路径</span>
    <p>${escapeHtml(asParagraphs(entry.introduction).join(" "))}</p>
  </section>` : `<div id="lesson-start"></div>`;
  const lessons = entryLessons(entry);
  const radar = entryRadar(entry);
  const article = `<main id="main">
    <div class="page-wrap">
      ${isHome ? identitySwitchboard(depth) : ""}
      ${hero(entry, isHome)}
      ${isHome ? learningSystemOverview(entry, depth) : topicPills(entry, depth)}
      <div id="today-plan">${todayCurriculumPosition(entry, depth, isHome)}</div>
      ${introduction}
      <div class="lesson-layout">
        ${tableOfContents(entry)}
        <div class="lesson-flow">
          ${lessons.map((lesson, lessonIndex) => lessonSection(lesson, lessonIndex, depth)).join("")}
          ${radarSection(radar, depth)}
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
  const entryTopicLabel = entryModules(entry).map((module) => moduleTitle(module)).join(" · ") || "独立课程";
  const searchable = [entry.title, entry.subtitle, ...lessons.map((lesson) => moduleTitle(lesson.module)), ...lessons.map((lesson) => lesson.coreQuestion ?? lesson.title)].join(" ");
  return `<article class="archive-card" data-archive-card data-search="${escapeHtml(searchable.toLowerCase())}">
    <a href="${root}${entry.date}/" aria-label="阅读 ${entry.date}：${escapeHtml(entry.title)}">
      <div class="archive-date"><strong>${day}</strong><span>${year}.${month}</span></div>
      <div class="archive-copy">
        <p>${escapeHtml(entryTopicLabel)} · ${entry.estimatedMinutes} 分钟</p>
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
  return `<a class="curriculum-card${module?.core ? " is-core" : ""}" href="./${escapeHtml(track.module)}/">
    <div class="curriculum-card-top"><span>${String(index + 1).padStart(2, "0")}</span><b>${module?.core ? "核心 · " : ""}第 ${scheduleDayByModule.get(track.module) ?? "—"} 天</b></div>
    <h2>${escapeHtml(moduleTitle(track.module))}</h2>
    <p>${escapeHtml(track.goal || moduleDescription(track.module))}</p>
    <div class="curriculum-card-progress">
      <div><span>已发布 ${progress.completedUnits} / ${progress.totalUnits}</span><b>${progress.percent}%</b></div>
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
      ${identitySwitchboard(1)}
      <section class="curriculum-hero">
        <div>
          <p class="hero-kicker"><span class="status-dot"></span>STRUCTURED CURRICULUM</p>
          <h1>全部 13 条主线，<br><em>都在这里推进。</em></h1>
        </div>
        <div class="curriculum-hero-copy">
          <p>每个主题从基础概念、分析框架一路走向实际应用。每天只推进其中一小步，长期积累成完整的能力结构。</p>
          <dl><div><dt>${orderedTracks.length}</dt><dd>条主题主线</dd></div><div><dt>${totalUnits}</dt><dd>个核心单元</dd></div><div><dt>${completedUnits}</dt><dd>个单元已发布</dd></div></dl>
        </div>
      </section>
      <section class="curriculum-overview" aria-labelledby="curriculum-overview-title">
        <div class="section-title-row"><div><span>4 DOMAINS · 13 TRACKS</span><h2 id="curriculum-overview-title">先看能力域，再选学习主线</h2></div><p>每条主线都显示当前进度和下一课，避免被大量阶段标签淹没。</p></div>
        <div class="curriculum-domains">${learningDomains.map((domain) => {
          const tracks = domain.modules.map((module) => trackMap.get(module)).filter(Boolean);
          return `<section class="curriculum-domain">
            <header><div><span>${escapeHtml(domain.title)}</span><p>${escapeHtml(domain.description)}</p></div><b>${tracks.length} 条主线</b></header>
            <div class="curriculum-grid">${tracks.map((track) => curriculumCard(track, orderedTracks.indexOf(track))).join("")}</div>
          </section>`;
        }).join("")}</div>
      </section>
    </div>
  </main>`;
  return pageShell({
    title: "学习地图｜每日学习",
    description: "13 个主题的独立系统课程地图：分阶段、按顺序学习，并记录已发布内容与下一课。",
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

function resolvedStarterLesson(moduleId) {
  const starter = starterLessonMap.get(moduleId);
  if (!starter) return null;
  const unitId = starter.curriculum?.unitId;
  const publishedEntry = entries.find((entry) => entryLessons(entry).some((lesson) => (
    lesson.module === moduleId && lesson.curriculum?.unitId === unitId
  )));
  const publishedLesson = publishedEntry
    ? entryLessons(publishedEntry).find((lesson) => lesson.module === moduleId && lesson.curriculum?.unitId === unitId)
    : null;
  return {
    lesson: publishedLesson ?? starter,
    publishedEntry: publishedLesson ? publishedEntry : null,
    starter
  };
}

function renderTrackPage(track, identity = null) {
  const depth = identity ? 3 : 2;
  const root = rootPrefix(depth);
  const module = moduleMap.get(track.module) ?? { title: track.module, description: track.goal };
  const progress = currentProgress.get(track.module);
  const historyByUnit = unitHistoryMap(progress);
  const starterDisplay = identity ? { lesson: starterLessonMap.get(track.module), starter: starterLessonMap.get(track.module), publishedEntry: null } : resolvedStarterLesson(track.module);
  const starterUnitId = starterDisplay?.starter?.curriculum?.unitId;
  const relatedEntries = entries.filter((entry) => entryLessons(entry).some((lesson) => lesson.module === track.module && (!identity || lesson.learningIdentity === identity.id)));
  const body = `<main id="main">
    <div class="page-wrap track-page">
      <nav class="crumbs" aria-label="面包屑"><a href="${identity ? `${root}${identity.path}/` : `${root}curriculum/`}">${identity ? escapeHtml(identity.title) : "学习地图"}</a><span>／</span><span>${escapeHtml(module.title)}</span></nav>
      <section class="track-hero">
        <div class="track-heading">
          <p class="hero-kicker"><span class="status-dot"></span>${module.core ? "CORE CURRICULUM" : "CURRICULUM TRACK"}</p>
          <h1>${escapeHtml(module.title)}</h1>
          <p>${escapeHtml(track.goal || module.description)}</p>
        </div>
        <aside class="track-progress-panel">
          ${identity ? `<p>本身份已发布 ${identityLessons(identity).filter((item) => item.lesson.module === track.module).length} 课；下方为全站共用知识树。</p>` : ""}
          <div><span>${identity ? "共用知识树发布进度" : "日更发布进度"}</span><strong>${progress.percent}<small>%</small></strong></div>
          <div class="course-progress" role="progressbar" aria-label="${escapeHtml(module.title)}日更发布进度" aria-valuemin="0" aria-valuemax="${progress.totalUnits}" aria-valuenow="${progress.completedUnits}"><i style="width:${progress.percent}%"></i></div>
          <p>日期归档已发布 ${progress.completedUnits} / ${progress.totalUnits} 个单元 · 第 ${progress.currentCycle} 轮</p>
          <div class="track-next"><span>下一课</span><b>${escapeHtml(progress.nextUnit?.stageTitle ?? "课程")}</b><strong>${escapeHtml(progress.nextUnit?.title ?? "即将开始")}</strong></div>
        </aside>
      </section>
      ${identity ? identityPractice(identity, track.module) : ""}
      ${(track.principles ?? []).length ? `<section class="track-principles"><div><span>LEARNING PRINCIPLES</span><h2>这条主线如何学习</h2></div><ol>${track.principles.map((principle, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(principle)}</p></li>`).join("")}</ol></section>` : ""}
      ${starterDisplay ? `<section class="track-starter" id="starter-lesson" aria-labelledby="starter-lesson-title">
        <div class="section-title-row track-starter-heading"><div><span>START HERE · 完整起步课</span><h2 id="starter-lesson-title">先用这一课建立主题底座</h2></div><p>${starterDisplay.publishedEntry ? `已优先采用 ${escapeHtml(starterDisplay.publishedEntry.date)} 的正式日更版本。` : (identity ? "以下保留常驻基础课原文，案例可能来自不同场景；用上方身份练习替换原练习。它不计入身份发布记录。" : "这是常驻主题课，不占用日期归档进度。") }</p></div>
        ${lessonSection(starterDisplay.lesson, 0, depth, identity)}
      </section>` : ""}
      <section class="knowledge-tree" aria-labelledby="knowledge-tree-title">
        <div class="section-title-row"><div><span>FULL ROADMAP</span><h2 id="knowledge-tree-title">完整分阶段知识树</h2></div><p>${track.stages?.length ?? 0} 个阶段 · ${progress.totalUnits} 个核心单元</p></div>
        <div class="stage-list">${(track.stages ?? []).map((stage, stageIndex) => {
          const stageUnits = stage.units ?? [];
          const stageCompleted = stageUnits.filter((unit) => historyByUnit.has(unit.id)).length;
          const isCurrentStage = stageUnits.some((unit) => unit.id === progress.nextUnit?.id);
          return `<details class="stage-block"${isCurrentStage ? " open" : ""}>
          <summary><span>${String(stageIndex + 1).padStart(2, "0")}</span><div><p>STAGE ${stageIndex + 1}</p><h3>${escapeHtml(stage.title)}</h3><small>${escapeHtml(stage.outcome)}</small></div><b>${stageCompleted} / ${stageUnits.length}<i aria-hidden="true">＋</i></b></summary>
          <ol>${stageUnits.map((unit, unitIndex) => {
            const history = historyByUnit.get(unit.id);
            const hasStarter = !history && starterUnitId === unit.id;
            const isNext = progress.nextUnit?.id === unit.id;
            const state = history ? "is-complete" : (hasStarter ? "is-starter" : (isNext ? "is-next" : "is-upcoming"));
            const status = history ? (identity ? (history.learningIdentity === identity.id ? "本身份已发布" : (history.learningIdentity ? "另一身份应用" : "历史基础原文")) : "已发布") : (hasStarter ? "起步课可读" : (isNext ? "下一课" : "待发布"));
            const content = `<span class="unit-index">${String(unitIndex + 1).padStart(2, "0")}</span><p>${escapeHtml(unit.title)}</p><b>${status}</b>${history ? `<small>${escapeHtml(history.date)}</small>` : ""}`;
            const historyPath = history?.learningIdentity ? `${identityById(history.learningIdentity).path}/daily/${history.date}/` : `${history?.date}/`;
            return `<li class="${state}">${history ? `<a href="${root}${identity ? historyPath : `${history.date}/`}#${escapeHtml(history.lessonId)}">${content}</a>` : (hasStarter ? `<a href="#starter-lesson">${content}</a>` : `<div>${content}</div>`)}</li>`;
          }).join("")}</ol>
        </details>`;
        }).join("")}</div>
      </section>
      <section class="track-history" aria-labelledby="track-history-title">
        <div class="section-title-row"><div><span>LEARNING RECORD</span><h2 id="track-history-title">${identity ? escapeHtml(identity.title) : "这条主线"}的学习记录</h2></div><p>每一期都保留在日期归档中。</p></div>
        ${relatedEntries.length ? `<div class="track-history-list">${relatedEntries.map((entry) => {
          const lesson = entryLessons(entry).find((item) => item.module === track.module);
          return `<a href="${identity ? `${root}${identity.path}/daily/${entry.date}/` : `${root}${entry.date}/`}"><time>${escapeHtml(entry.date)}</time><div><span>${escapeHtml(lesson.curriculum?.stageTitle ?? module.title)}</span><h3>${escapeHtml(lesson.coreQuestion ?? lesson.title)}</h3></div><b aria-hidden="true">↗</b></a>`;
        }).join("")}</div>` : `<p class="track-empty">${identity ? "本身份尚无该主线的日更；上方常驻基础课与身份练习可先使用。" : "日期归档尚无这条主线的更新；上方完整起步课已经可以直接阅读。"}</p>`}
      </section>
    </div>
  </main>`;
  return pageShell({
    title: `${module.title}｜${identity ? identity.title : "学习地图"}｜每日学习`,
    description: track.goal || module.description,
    body,
    depth,
    identity,
    page: "curriculum",
    canonical: `${identity ? `${identity.path}/` : ""}curriculum/${track.module}/`
  });
}

function identityById(id) { return identities.identities.find((item) => item.id === id); }
function identityModules(identity) { return [...new Set([...identity.primaryModules, ...identity.foundationModules])]; }
function identityLessons(identity, cutoff = latest?.date) {
  return entries.filter((entry) => entry.date >= identities.effectiveDate && (!cutoff || entry.date <= cutoff))
    .flatMap((entry) => entryLessons(entry).filter((lesson) => lesson.learningIdentity === identity.id)
      .map((lesson) => ({ date: entry.date, lesson })));
}
function identitySwitchboard(depth) {
  const root = rootPrefix(depth);
  return `<section class="identity-switchboard" aria-label="选择学习身份"><div class="identity-grid">${identities.identities.map((identity) => `<a class="identity-entry ${identity.id}" href="${root}${identity.path}/"><span>${identity.id === "personal" ? "PERSONAL DEVELOPMENT" : "DTC GROWTH"}</span><h2>${escapeHtml(identity.title)}</h2><p>${escapeHtml(identity.description)}</p><b>进入独立学习页面 →</b></a>`).join("")}</div><p>两个可独立收藏的入口，各自保留场景和发布记录。每天合计 1–2 课、30–45 分钟，共用基础知识，不重复加课。</p></section>`;
}
function identityPractice(identity, module) {
  const context = identityContext(identity.id, module, identities);
  return `<section class="identity-practice" aria-label="${escapeHtml(identity.title)}应用练习"><span class="identity-eyebrow">${escapeHtml(identity.title)} · 应用方向</span><h2>把这一课用在你的场景</h2><p>以下是该主题的练习方向。阅读时围绕当前单元选一个问题，替换原课练习，不增加每天的课量。</p><dl><dt>案例场景</dt><dd>${escapeHtml(context.caseContext)}</dd><dt>动手练习</dt><dd>${escapeHtml(context.exercise)}</dd><dt>留下一个输出</dt><dd>${escapeHtml(context.deliverable)}</dd></dl></section>`;
}
function nextIdentitySchedule() {
  const nextAfterLatest = new Date(Date.parse(`${latest.date}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  const start = [today, identities.effectiveDate, nextAfterLatest].sort().at(-1);
  return Array.from({length: 7}, (_, index) => {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + index * 86400000).toISOString().slice(0,10);
    return {date, plan: identityPlanForDate(date, topics, curriculum, entries, identities)};
  });
}
function renderIdentityPage(identity) {
  const modules = identityModules(identity);
  const published = identityLessons(identity);
  const roleProgress = identityProgress(entries, identities, latest?.date).identities.find((item) => item.id === identity.id);
  const foundationPublished = modules.reduce((sum,module) => sum + currentProgress.get(module).completedUnits,0);
  const roleEntries = [...new Set(published.map((item) => item.date))];
  const schedule = nextIdentitySchedule();
  const body = `<main id="main"><div class="page-wrap identity-page" data-learning-identity="${identity.id}">
    <section class="identity-hero"><div><p class="hero-kicker"><span class="status-dot"></span>${identity.id === "personal" ? "PERSONAL DEVELOPMENT" : "DTC GROWTH"}</p><h1>${escapeHtml(identity.title)}</h1><p class="hero-subtitle">${escapeHtml(identity.description)}</p><p>${escapeHtml(identity.goal)}</p></div><aside class="identity-stats"><strong>${roleProgress.publishedLessons}</strong><p>节本身份课程已发布</p><p>${modules.length} 条可复用知识主线 · ${foundationPublished} 个已有基础单元可回看</p><p>从 ${identities.effectiveDate} 分身份积累；发布进度不等于你的学习完成度。</p></aside></section>
    <nav class="identity-local-nav" aria-label="${escapeHtml(identity.title)}页内导航"><a href="#identity-focus">学习方向</a><a href="#identity-curriculum">课程入口</a><a href="#identity-plan">近期安排</a><a href="#identity-history">本身份记录</a></nav>
    <section class="identity-section" id="identity-focus"><h2>沿着这些问题往前走</h2><p class="identity-note">以现有知识树为基础，下面是课程的应用方向，不代表新增完整课程已全部写好。每次日更严格沿当前单元推进。</p><div class="identity-grid">${identity.focusAreas.map((area) => `<article class="identity-focus"><h3>${escapeHtml(area.title)}</h3><p>${escapeHtml(area.description)}</p><p><b>练习方向：</b>${escapeHtml(area.practice)}</p><small>对应主线：${area.modules.map(moduleTitle).map(escapeHtml).join("、")}</small></article>`).join("")}</div></section>
    <section class="identity-section" id="identity-curriculum"><h2>从这里进入课程</h2><p class="identity-note">知识框架与原有课程共用；新课案例与身份练习围绕「${escapeHtml(identity.title)}」。旧课保留原文及原场景，未自动计入身份记录。</p><div class="identity-grid">${modules.map((module) => {
      const progress = currentProgress.get(module);
      const count = published.filter((item) => item.lesson.module === module).length;
      const context = identityContext(identity.id,module,identities);
      return `<a class="identity-track" href="./curriculum/${module}/"><small>${identity.primaryModules.includes(module) ? "重点主线" : "共用基础"} · 本身份已发布 ${count} 课</small><h3>${escapeHtml(moduleTitle(module))}</h3><p>${escapeHtml(context.caseContext)}</p><strong>已有基础 ${progress.completedUnits} / ${progress.totalUnits} 单元 · 起步课可读</strong><p>知识树下一单元：${escapeHtml(progress.nextUnit?.title ?? "继续复习")}</p><b>阅读与练习 →</b></a>`;
    }).join("")}</div></section>
    <section class="identity-section" id="identity-plan"><h2>接下来怎样安排</h2><p>两条身份合计每天 1–2 课：双课日约 36 分钟，单课日约 30 分钟。轮到另一身份的日期，可以回顾旧课或休息，不补做额外课程。</p><div class="identity-schedule">${schedule.map(({date,plan}) => { const own = plan.filter((item) => item.learningIdentity === identity.id); return `<div><b>${date.slice(5)}</b>${own.length ? own.map((item) => `<p>${escapeHtml(moduleTitle(item.module))}</p>`).join("") : "<p>另一身份推进<br>可选复习 / 休息</p>"}</div>`; }).join("")}</div><p class="identity-note">这是固定轮换计划，未发布的内容不计进度。共用主题的个人与职场应用交替出现；消费者心理、数据分析、沟通等基础沿同一知识顺序前进。</p></section>
    <section class="identity-section" id="identity-history"><h2>本身份发布记录</h2>${published.length ? `<div class="identity-history">${published.map(({date,lesson}) => `<a href="./daily/${date}/#${escapeHtml(lesson.id)}"><time>${date} · ${escapeHtml(moduleTitle(lesson.module))}</time><strong>${escapeHtml(lesson.coreQuestion)}</strong></a>`).join("")}</div><p>${roleEntries.length} 个日期 · ${published.length} 节课程</p>` : `<p>从 ${identities.effectiveDate} 起，新课程会按身份出现在这里。现在可先打开上方起步课，使用本身份的练习方向；旧归档不会被改写或重新贴标签。</p>`}</section>
    <p class="identity-note">保留原来的 ${topics.modules.length} 条课程、${orderedTracks.reduce((sum,track) => sum + flattenTrack(track).length,0)} 个规划单元和全部历史内容。<a href="../archive/">查看分身份之前的完整历史归档 →</a></p>
  </div></main>`;
  return pageShell({title:`${identity.title}｜每日学习`,description:identity.description,body,depth:1,page:"identity",canonical:`${identity.path}/`,identity});
}
function renderIdentityDaily(entry, identity) {
  const lessons = entryLessons(entry).filter((lesson) => lesson.learningIdentity === identity.id);
  const body = `<main id="main"><div class="page-wrap"><nav class="crumbs" aria-label="面包屑"><a href="../../">${escapeHtml(identity.title)}</a><span>／</span><span>${entry.date}</span></nav><section class="identity-hero"><div><p class="hero-kicker">${entry.date} · ${escapeHtml(identity.title)}</p><h1>今天的 ${lessons.length} 节课</h1><p>本页只包含${escapeHtml(identity.title)}课程，共 ${lessons.reduce((sum,lesson) => sum + lesson.estimatedMinutes,0)} 分钟。</p></div></section>${lessons.map((lesson,index) => lessonSection(lesson,index,3,identity)).join("")}<p><a href="../../#identity-history">返回本身份记录 →</a></p></div></main>`;
  return pageShell({title:`${entry.date}｜${identity.title}｜每日学习`,description:`${identity.title}独立课程`,body,depth:3,page:"identity",canonical:`${identity.path}/daily/${entry.date}/`,identity});
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
    estimatedMinutes: entry.estimatedMinutes,
    modules: entryModules(entry),
    lessons: entryLessons(entry).map((lesson) => ({
      id: lesson.id,
      module: lesson.module,
      title: lesson.coreQuestion ?? lesson.title,
      learningIdentity: lesson.learningIdentity ?? null,
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
    ...identities.identities.flatMap((identity) => [ `${identity.path}/`, ...identityModules(identity).map((module) => `${identity.path}/curriculum/${module}/`), ...entries.filter((entry) => entryLessons(entry).some((lesson) => lesson.learningIdentity === identity.id)).map((entry) => `${identity.path}/daily/${entry.date}/`) ]),
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

await write("content/identities.json", `${JSON.stringify(identities, null, 2)}\n`);
await write("content/identity-progress.json", `${JSON.stringify(identityProgress(entries, identities, latest?.date), null, 2)}\n`);
for (const identity of identities.identities) {
  await write(`${identity.path}/index.html`, renderIdentityPage(identity));
  for (const module of identityModules(identity)) await write(`${identity.path}/curriculum/${module}/index.html`, renderTrackPage(trackMap.get(module), identity));
  for (const entry of entries.filter((item) => entryLessons(item).some((lesson) => lesson.learningIdentity === identity.id))) await write(`${identity.path}/daily/${entry.date}/index.html`, renderIdentityDaily(entry, identity));
}

if (siteUrl) await write("sitemap.xml", renderSitemap());

for (const track of orderedTracks) {
  await write(`curriculum/${track.module}/index.html`, renderTrackPage(track));
}

for (const [index, entry] of entries.entries()) {
  await write(`${entry.date}/index.html`, renderEntryPage(entry, { depth: 1, isHome: false, index }));
  await write(`content/daily/${entry.date}.json`, `${JSON.stringify(entry, null, 2)}\n`);
}

console.log(`✓ 已构建 ${entries.length} 个日期页面与 ${orderedTracks.length} 条课程主线，首页为 ${latest.date}`);
