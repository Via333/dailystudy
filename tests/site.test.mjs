import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectGroundedSourceUrls,
  curriculumPlanForDate,
  flattenTrack,
  lessonVisibleCharacters,
  normalizeSourceUrl,
  readDailyEntries,
  scheduleForDate,
  validateCurriculum,
  validateEntry,
  validateStandaloneLesson
} from "../scripts/lib.mjs";

const rootUrl = new URL("../", import.meta.url);
const distUrl = new URL("../dist/", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const distPath = fileURLToPath(distUrl);
const expectedTopics = [
  ["advertising_frontier", "广告与平台前沿", false, 6, 24],
  ["marketing_case", "营销案例", false, 6, 24],
  ["aesthetics_creative", "审美与创意", false, 6, 24],
  ["consumer_psychology", "消费者心理", false, 8, 32],
  ["brand_product_research", "品牌 / 产品 / 用户研究", true, 7, 28],
  ["ai", "AI", false, 6, 24],
  ["data_analysis", "数据分析", false, 7, 28],
  ["management_organization", "管理与组织认知", true, 7, 28],
  ["finance_macro", "财务 / 投资 / 宏观经济", true, 7, 28],
  ["cognitive_decision", "认知科学与决策能力", true, 7, 28],
  ["communication", "沟通与表达", false, 6, 24],
  ["personal_growth", "个人成长", false, 6, 24],
  ["media_ecommerce", "媒介与电商行业", false, 7, 28]
];
const expectedSchedule = [
  ["consumer_psychology", "brand_product_research"],
  ["advertising_frontier", "data_analysis"],
  ["management_organization", "communication"],
  ["finance_macro", "cognitive_decision"],
  ["marketing_case", "aesthetics_creative"],
  ["ai", "media_ecommerce"],
  ["personal_growth"]
];

async function text(relative) {
  return readFile(new URL(relative, distUrl), "utf8");
}

async function sourceJson(relative) {
  return readFile(new URL(relative, rootUrl), "utf8").then(JSON.parse);
}

async function filesUnder(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesUnder(absolute));
    else result.push(absolute);
  }
  return result;
}

test("首页先展示 13 门可直接阅读的独立课程，再进入今日更新", async () => {
  const [html, topics, starters, entries] = await Promise.all([
    text("index.html"),
    sourceJson("config/topics.json"),
    sourceJson("content/starter-lessons.json"),
    readDailyEntries()
  ]);
  assert.match(html, /<html lang="zh-CN">/);
  const latest = entries[0];
  assert.ok(html.includes(`每日学习｜${latest.title}`));
  assert.match(html, /<b>13<\/b> 条完整主线/);
  assert.ok(html.includes(`<b>${latest.lessons.length}</b> 条今日推进`));
  assert.match(html, /13 个独立主题，现在都能开始学/);
  assert.match(html, /<b>13<\/b> 条独立主线.*<b>13<\/b> 节起步课.*<b>344<\/b> 个规划单元/s);
  assert.equal((html.match(/class="system-topic(?: is-today)?"/g) ?? []).length, 13);
  for (const module of topics.modules) {
    assert.match(html, new RegExp(module.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const starter = starters.lessons.find((lesson) => lesson.module === module.id);
    assert.ok(starter, `${module.id} 缺少起步课`);
    assert.match(html, new RegExp(starter.coreQuestion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(starter.conclusion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((html.match(/class="system-topic is-today"/g) ?? []).length, latest.lessons.length);
  assert.ok(html.includes(`今天深入 ${latest.lessons.length} 条主线`));
  assert.match(html, /3 KEY POINTS · 三个重点/);
  assert.match(html, /FRAMEWORK · 核心框架/);
  assert.match(html, /CASE · 例子/);
  assert.match(html, /TRY IT · 立即应用/);
  const firstLesson = html.slice(html.indexOf('class="lesson-section"'), html.indexOf('class="lesson-section"', html.indexOf('class="lesson-section"') + 1));
  const lessonBlocks = [
    "section-header",
    "framework-card",
    "lesson-key-points",
    "case-study",
    "lesson-exercise",
    "lesson-conclusion"
  ];
  for (let index = 1; index < lessonBlocks.length; index += 1) {
    assert.ok(firstLesson.indexOf(lessonBlocks[index - 1]) < firstLesson.indexOf(lessonBlocks[index]), `课程区块顺序错误：${lessonBlocks[index - 1]} → ${lessonBlocks[index]}`);
  }
  assert.match(html, /<details class="radar-section"/);
  assert.match(html, /独立观察，不与课程强行关联/);
  assert.doesNotMatch(html, /id="practice"|practice-card|学完你会|值得带走|想一想|30% 最新变化|codex-preview|Starter Project/i);
});

test("默认采用柔和纸张底与白色卡片，并保留手动深色切换", async () => {
  const [html, css, app] = await Promise.all([
    text("index.html"),
    readFile(new URL("site/styles.css", rootUrl), "utf8"),
    readFile(new URL("site/app.js", rootUrl), "utf8")
  ]);
  assert.match(html, /<meta name="theme-color" content="#f5f6f8">/);
  assert.match(css, /--paper: #f5f6f8/);
  assert.match(css, /--card: #ffffff/);
  assert.match(css, /--accent: #1d4ed8/);
  assert.match(css, /--highlight: #fff7d9/);
  assert.match(css, /\.lesson-exercise[\s\S]*background: var\(--sage-soft\)/);
  assert.match(app, /daily-learning-theme-v2/);
  assert.match(app, /setTheme\(savedTheme \|\| "light"\)/);
  assert.match(app, /theme === "dark" \? "#0f172a" : "#f5f6f8"/);
  assert.doesNotMatch(app, /prefers-color-scheme/);
});

test("每日助手更新与无 API 的 GitHub 发布分离", async () => {
  const [workflow, readme] = await Promise.all([
    readFile(new URL(".github/workflows/publish.yml", rootUrl), "utf8"),
    readFile(new URL("README.md", rootUrl), "utf8")
  ]);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|npm run generate|schedule:|cron:|contents: write/);
  assert.match(workflow, /push:\s*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /run: npm test/);
  assert.match(readme, /每天 08:00（Asia\/Shanghai）/);
});

test("学习地图为全部 13 个主题生成独立知识树与完整起步课", async () => {
  const [topics, curriculum, starters, overview] = await Promise.all([
    sourceJson("config/topics.json"),
    sourceJson("config/curriculum.json"),
    sourceJson("content/starter-lessons.json"),
    text("curriculum/index.html")
  ]);
  assert.equal(curriculum.tracks.length, 13);
  assert.equal(starters.lessons.length, 13);
  assert.match(overview, /4 DOMAINS · 13 TRACKS/);
  assert.match(overview, /344/);
  for (const domain of topics.learningDomains) assert.match(overview, new RegExp(domain.title));
  const entries = await readDailyEntries();
  for (const module of topics.modules) {
    assert.match(overview, new RegExp(module.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const page = await text(`curriculum/${module.id}/index.html`);
    const track = curriculum.tracks.find((item) => item.module === module.id);
    const starter = starters.lessons.find((item) => item.module === module.id);
    const published = entries.flatMap((entry) => entry.lessons).find((lesson) => lesson.module === module.id && lesson.curriculum.unitId === starter.curriculum.unitId);
    const displayed = published ?? starter;
    assert.match(page, /START HERE · 完整起步课/);
    assert.match(page, new RegExp(displayed.coreQuestion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, new RegExp(displayed.framework.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, new RegExp(displayed.caseStudy.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, new RegExp(displayed.exercise.prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, new RegExp(displayed.conclusion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, /完整分阶段知识树/);
    assert.match(page, /<details class="stage-block/);
    assert.match(page, /下一课/);
    assert.match(page, /LEARNING PRINCIPLES/);
    for (const stage of track.stages) {
      assert.match(page, new RegExp(stage.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      for (const unit of stage.units) {
        assert.match(page, new RegExp(unit.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    }
  }
});

test("消费者心理完整知识树、独立起步课与 schema v4 日期课均可访问", async () => {
  const [curriculum, page, issue, entry] = await Promise.all([
    sourceJson("config/curriculum.json"),
    text("curriculum/consumer_psychology/index.html"),
    text("2026-08-08/index.html"),
    sourceJson("content/daily/2026-08-08.json")
  ]);
  const track = curriculum.tracks.find((item) => item.module === "consumer_psychology");
  assert.equal(track.stages.length, 8);
  assert.equal(track.stages.flatMap((stage) => stage.units).length, 32);
  for (const stage of track.stages) {
    assert.match(page, new RegExp(stage.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const unit of stage.units) {
      assert.match(page, new RegExp(unit.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
  const consumerCount = (await readDailyEntries())
    .flatMap((entry) => entry.lessons)
    .filter((lesson) => lesson.module === "consumer_psychology").length;
  assert.ok(page.includes(`日期归档已发布 ${consumerCount} / 32 个单元`));
  assert.match(page, /START HERE · 完整起步课/);
  assert.match(page, /<details class="stage-block" open>/);
  assert.match(issue, /为什么长期存在的需要，只有在特定情境下才会启动行动？/);
  assert.match(issue, /情境—差距—行动链/);
  assert.match(issue, /3 KEY POINTS · 三个重点/);
  assert.match(issue, /适用边界/);
  assert.equal(entry.schemaVersion, 4);
  for (const removed of ["theme", "practice", "closing"]) assert.equal(removed in entry, false);
  assert.equal(entry.lessons[0].keyPoints.length, 3);
  assert.ok(entry.lessons[0].framework.steps.length >= 2);
  for (const removed of ["body", "learningObjectives", "takeaway", "reflection", "application"]) {
    assert.equal(removed in entry.lessons[0], false);
  }
  assert.equal(entry.radar[0].module, "advertising_frontier");
  assert.ok(entry.radar[0].watchNext);
  assert.equal("courseConnection" in entry.radar[0], false);
  assert.equal("relatedModules" in entry.radar[0], false);
});

test("历史列表、日期直达页面和公开 JSON 都可独立访问", async () => {
  const [archive, issue, latest, progress, publicCurriculum] = await Promise.all([
    text("archive/index.html"),
    text("2026-08-08/index.html"),
    text("content/latest.json").then(JSON.parse),
    text("content/progress.json").then(JSON.parse),
    text("content/curriculum.json").then(JSON.parse)
  ]);
  assert.match(archive, /全部往期/);
  assert.match(archive, /\.\.\/2026-08-08\//);
  assert.match(archive, /data-archive-search/);
  assert.match(issue, /2026-08-08｜今日课程｜消费者心理 · 品牌与用户研究｜每日学习/);
  assert.match(issue, /href="\.\.\/assets\/styles\.css"/);
  assert.equal(latest.schemaVersion, 4);
  const [topics, entries] = await Promise.all([sourceJson("config/topics.json"), readDailyEntries()]);
  assert.equal(latest.date, entries[0].date);
  assert.deepEqual(latest.lessons.map((lesson) => lesson.module), scheduleForDate(latest.date, topics));
  assert.equal(progress.tracks.length, 13);
  assert.equal(publicCurriculum.tracks.length, 13);
});

test("课程目录、13 节起步课、每周覆盖和每日推进顺序均由程序强制", async () => {
  const [topics, curriculum, starters, entry] = await Promise.all([
    sourceJson("config/topics.json"),
    sourceJson("config/curriculum.json"),
    sourceJson("content/starter-lessons.json"),
    sourceJson("content/daily/2026-08-08.json")
  ]);
  assert.deepEqual(validateCurriculum(curriculum, topics), []);
  assert.deepEqual(topics.modules.map((module) => [module.id, module.title, Boolean(module.core)]), expectedTopics.map((item) => item.slice(0, 3)));
  assert.deepEqual(topics.dailySchedule, expectedSchedule);
  const groupedModules = topics.learningDomains.flatMap((domain) => domain.modules);
  assert.equal(new Set(groupedModules).size, expectedTopics.length);
  assert.deepEqual([...groupedModules].sort(), expectedTopics.map(([id]) => id).sort());
  expectedTopics.forEach(([id, , , stages, units]) => {
    const track = curriculum.tracks.find((item) => item.module === id);
    assert.equal(track.stages.length, stages, `${id} 阶段数`);
    assert.equal(track.stages.flatMap((stage) => stage.units).length, units, `${id} 单元数`);
  });
  assert.equal(starters.schemaVersion, 1);
  assert.equal(starters.lessons.length, expectedTopics.length);
  assert.equal(new Set(starters.lessons.map((lesson) => lesson.module)).size, expectedTopics.length);
  for (const [index, starter] of starters.lessons.entries()) {
    const track = curriculum.tracks.find((item) => item.module === starter.module);
    const firstUnit = flattenTrack(track)[0];
    assert.deepEqual(validateStandaloneLesson(starter, `starters[${index}]`, topics, {
      module: starter.module,
      unit: firstUnit,
      cycle: 1
    }), []);
    assert.equal(starter.curriculum.unitId, firstUnit.id);
    assert.ok(lessonVisibleCharacters(starter) >= 350);
    assert.ok(lessonVisibleCharacters(starter) <= 750);
  }
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(Date.parse("2026-08-08T00:00:00Z") + (index * 86_400_000)).toISOString().slice(0, 10);
    assert.deepEqual(scheduleForDate(date, topics), expectedSchedule[index]);
  }
  assert.deepEqual(validateEntry(entry, topics, entry.date, curriculum, []), []);

  const wrongUnit = structuredClone(entry);
  wrongUnit.lessons[0].curriculum.unitId = "consumer_psychology_choice_default";
  assert.ok(validateEntry(wrongUnit, topics, wrongUnit.date, curriculum, [])
    .some((message) => message.includes("curriculum.unitId")));

  const wrongModule = structuredClone(entry);
  wrongModule.lessons[0].module = "ai";
  assert.ok(validateEntry(wrongModule, topics, wrongModule.date, curriculum, [])
    .some((message) => message.includes("当天学习计划")));

  const wrongQuestion = structuredClone(entry);
  wrongQuestion.lessons[0].coreQuestion = "这不是一个问题";
  assert.ok(validateEntry(wrongQuestion, topics, wrongQuestion.date, curriculum, [])
    .some((message) => message.includes("必须以问号结尾")));

  const missingPoint = structuredClone(entry);
  missingPoint.lessons[0].keyPoints.pop();
  assert.ok(validateEntry(missingPoint, topics, missingPoint.date, curriculum, [])
    .some((message) => message.includes("恰好 3 个重点")));

  const legacyBody = structuredClone(entry);
  legacyBody.lessons[0].body = ["旧版长正文不应重新进入 v4 内容"];
  assert.ok(validateEntry(legacyBody, topics, legacyBody.date, curriculum, [])
    .some((message) => message.includes("当前版本不允许的字段：body")));

  const wrongScope = structuredClone(entry);
  wrongScope.lessons[0].curriculum.scope = "可以随意展开相邻单元";
  assert.ok(validateEntry(wrongScope, topics, wrongScope.date, curriculum, [])
    .some((message) => message.includes("curriculum.scope")));

  const nextPlan = curriculumPlanForDate("2026-08-15", topics, curriculum, [entry]);
  const consumer = nextPlan.find((item) => item.module === "consumer_psychology");
  assert.equal(consumer.unit.sequence, 2);
  assert.equal(consumer.unit.id, "consumer_psychology_journey_jobs");

  const firstWeekEntries = expectedSchedule.map((modules, index) => ({
    date: new Date(Date.parse("2026-08-08T00:00:00Z") + (index * 86_400_000)).toISOString().slice(0, 10),
    lessons: modules.map((module) => ({ module }))
  }));
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(Date.parse("2026-08-15T00:00:00Z") + (index * 86_400_000)).toISOString().slice(0, 10);
    const plan = curriculumPlanForDate(date, topics, curriculum, firstWeekEntries);
    assert.deepEqual(plan.map((item) => item.module), expectedSchedule[index]);
    assert.ok(plan.every((item) => item.unit.sequence === 2));
  }
  const advertisingPlan = curriculumPlanForDate("2026-08-09", topics, curriculum, [entry])
    .find((item) => item.module === "advertising_frontier");
  assert.equal(advertisingPlan.unit.sequence, 1, "独立雷达与常驻起步课都不能增加日期课程进度");

  const unrelatedRadar = structuredClone(entry);
  unrelatedRadar.radar[0].module = "personal_growth";
  assert.deepEqual(validateEntry(unrelatedRadar, topics, unrelatedRadar.date, curriculum, []), []);

  const forcedTopLevelTheme = structuredClone(entry);
  forcedTopLevelTheme.theme = "牵强的共同主题";
  assert.ok(validateEntry(forcedTopLevelTheme, topics, forcedTopLevelTheme.date, curriculum, [])
    .some((message) => message.includes("当前版本不允许的字段：theme")));
});

test("全部课程至少 24 课且每个主题立即有实质学习框架", async () => {
  const curriculum = await sourceJson("config/curriculum.json");
  const total = curriculum.tracks.reduce((sum, track) => {
    assert.ok(track.goal.length >= 12);
    assert.ok(track.principles.length >= 3);
    assert.ok(track.stages.length >= 6);
    for (const stage of track.stages) {
      assert.ok(stage.outcome.length >= 8);
      assert.equal(stage.units.length, 4);
    }
    const count = track.stages.flatMap((stage) => stage.units).length;
    assert.ok(count >= 24);
    return sum + count;
  }, 0);
  assert.equal(total, 344);
});

test("常驻起步课不冒充日期发布进度", async () => {
  const [progress, advertising, consumer] = await Promise.all([
    text("content/progress.json").then(JSON.parse),
    text("curriculum/advertising_frontier/index.html"),
    text("curriculum/consumer_psychology/index.html")
  ]);
  const entries = await readDailyEntries();
  const archivedLessons = entries.flatMap((entry) => entry.lessons);
  assert.equal(progress.tracks.reduce((total, track) => total + track.completedUnits, 0), archivedLessons.length);
  for (const track of progress.tracks) {
    assert.equal(track.completedUnits, archivedLessons.filter((lesson) => lesson.module === track.module).length);
  }
  const advertisingCount = archivedLessons.filter((lesson) => lesson.module === "advertising_frontier").length;
  assert.ok(advertising.includes(`日期归档已发布 ${advertisingCount} / 24 个单元`));
  assert.match(advertising, /起步课可读/);
  if (!advertisingCount) assert.match(advertising, /这是常驻主题课，不占用日期归档进度/);
  const consumerCount = archivedLessons.filter((lesson) => lesson.module === "consumer_psychology").length;
  assert.ok(consumer.includes(`日期归档已发布 ${consumerCount} / 32 个单元`));
  assert.match(consumer, /已优先采用 2026-08-08 的正式日更版本/);
});

test("所有生成页面的本地链接在项目子路径结构中都能解析", async () => {
  const htmlFiles = (await filesUnder(distPath)).filter((file) => file.endsWith(".html"));
  const identities = await sourceJson("config/identities.json");
  const entries = await readDailyEntries();
  const rolePages = identities.identities.reduce((sum,identity) => sum + 1 + new Set([...identity.primaryModules, ...identity.foundationModules]).size + entries.filter(entry => entry.lessons.some(lesson => lesson.learningIdentity === identity.id)).length,0);
  assert.equal(htmlFiles.length, 4 + (await sourceJson("config/curriculum.json")).tracks.length + entries.length + rolePages);
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const clean = href.split(/[?#]/)[0];
      let target = path.resolve(path.dirname(file), clean);
      if (clean.endsWith("/") || !path.extname(target)) target = path.join(target, "index.html");
      assert.ok(target.startsWith(distPath), `${path.relative(rootPath, file)} 链接越出发布目录：${href}`);
      await access(target);
    }
  }
});

test("归档、RSS、404、分享图与安全转义完整", async () => {
  const [archive, latest, feed, missing, issue] = await Promise.all([
    text("content/archive.json").then(JSON.parse),
    text("content/latest.json").then(JSON.parse),
    text("feed.xml"),
    text("404.html"),
    text("2026-08-08/index.html")
  ]);
  assert.equal(archive[0].date, latest.date);
  assert.match(feed, /<rss version="2\.0">/);
  assert.match(missing, /这一页还没有学习笔记/);
  assert.doesNotMatch(issue, /href="javascript:/i);
  assert.match(issue, /rel="noopener noreferrer"/);
  await access(new URL("assets/og.png", distUrl));
  await access(new URL(".nojekyll", distUrl));
});

test("时效性来源可与真实检索记录做规范化核对", () => {
  const response = {
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "http://EXAMPLE.com/news/?utm_source=search#section" }] }
      },
      {
        type: "message",
        content: [{ annotations: [{ type: "url_citation", url: "https://docs.example.org/update/?b=2&a=1" }] }]
      }
    ]
  };
  const urls = collectGroundedSourceUrls(response);
  assert.ok(urls.has("https://example.com/news"));
  assert.ok(urls.has("https://docs.example.org/update?a=1&b=2"));
  assert.equal(normalizeSourceUrl("https://example.com/news?fbclid=tracking"), "https://example.com/news");
});

test("课程计划无需 API，按上海日期幂等且不写归档", async () => {
  const { execFileSync } = await import("node:child_process");
  const before = (await readdir(path.join(rootPath, "content/daily"))).sort();
  const entries = await readDailyEntries();
  const env = { ...process.env, OPENAI_API_KEY: "" };
  const archived = JSON.parse(execFileSync(process.execPath, ["scripts/plan-daily.mjs", "--date", entries[0].date], { cwd: rootPath, env, encoding: "utf8" }));
  assert.equal(archived.status, "already_archived");
  const nextDate = new Date(Date.parse(`${entries[0].date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const planned = JSON.parse(execFileSync(process.execPath, ["scripts/plan-daily.mjs", "--date", nextDate], { cwd: rootPath, env, encoding: "utf8" }));
  const [topics, curriculum] = await Promise.all([sourceJson("config/topics.json"), sourceJson("config/curriculum.json")]);
  const expected = curriculumPlanForDate(nextDate, topics, curriculum, entries);
  assert.equal(planned.status, "ready");
  assert.deepEqual(planned.lessons.map((lesson) => lesson.module), expected.map((lesson) => lesson.module));
  assert.deepEqual(planned.lessons.map((lesson) => lesson.curriculum.unitId), expected.map((lesson) => lesson.unit.id));
  assert.equal(planned.estimatedMinutes, (planned.lessons.length === 1 ? 26 : 32) + 4);
  assert.deepEqual((await readdir(path.join(rootPath, "content/daily"))).sort(), before);
});
