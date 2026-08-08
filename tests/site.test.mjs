import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectGroundedSourceUrls,
  curriculumPlanForDate,
  normalizeSourceUrl,
  scheduleForDate,
  validateCurriculum,
  validateEntry
} from "../scripts/lib.mjs";

const rootUrl = new URL("../", import.meta.url);
const distUrl = new URL("../dist/", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const distPath = fileURLToPath(distUrl);

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

test("首页展示深度课程、课程位置与独立行业雷达", async () => {
  const html = await text("index.html");
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /每日学习｜从触发情境开始，理解消费者为何行动/);
  assert.match(html, /2<\/b> 节系统课程/);
  assert.match(html, /今天在知识树中的位置/);
  assert.match(html, /消费者心理/);
  assert.match(html, /消费者决策旅程/);
  assert.match(html, /需求识别与触发情境/);
  assert.match(html, /品牌 \/ 产品 \/ 用户研究/);
  assert.match(html, /行业变化，单独观察/);
  assert.doesNotMatch(html, /30% 最新变化|6 个正文模块|codex-preview|Starter Project/i);
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
  assert.match(css, /\.practice-card[\s\S]*background: var\(--highlight\)/);
  assert.match(app, /daily-learning-theme-v2/);
  assert.match(app, /setTheme\(savedTheme \|\| "light"\)/);
  assert.match(app, /theme === "dark" \? "#0f172a" : "#f5f6f8"/);
  assert.doesNotMatch(app, /prefers-color-scheme/);
});

test("学习地图为全部 13 个主题生成独立知识树页面", async () => {
  const [topics, curriculum, overview] = await Promise.all([
    sourceJson("config/topics.json"),
    sourceJson("config/curriculum.json"),
    text("curriculum/index.html")
  ]);
  assert.equal(curriculum.tracks.length, 13);
  assert.match(overview, /13 棵知识树/);
  assert.match(overview, /344/);
  for (const module of topics.modules) {
    assert.match(overview, new RegExp(module.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const page = await text(`curriculum/${module.id}/index.html`);
    assert.match(page, /完整分阶段知识树/);
    assert.match(page, /下一课/);
    assert.match(page, /LEARNING PRINCIPLES/);
  }
});

test("消费者心理包含完整 8 阶段、32 课，并已有第一节正文", async () => {
  const [curriculum, page, issue] = await Promise.all([
    sourceJson("config/curriculum.json"),
    text("curriculum/consumer_psychology/index.html"),
    text("2026-08-08/index.html")
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
  assert.match(page, /已学 1 \/ 32 个单元/);
  assert.match(issue, /消费者不是“有需求”就会行动/);
  assert.match(issue, /学完你会/);
  assert.match(issue, /适用边界/);
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
  assert.match(issue, /2026-08-08｜从触发情境开始，理解消费者为何行动｜每日学习/);
  assert.match(issue, /href="\.\.\/assets\/styles\.css"/);
  assert.equal(latest.schemaVersion, 2);
  assert.equal(latest.lessons.length, 2);
  assert.equal(progress.tracks.length, 13);
  assert.equal(publicCurriculum.tracks.length, 13);
});

test("课程目录、每周覆盖和每日推进顺序均由程序强制", async () => {
  const [topics, curriculum, entry] = await Promise.all([
    sourceJson("config/topics.json"),
    sourceJson("config/curriculum.json"),
    sourceJson("content/daily/2026-08-08.json")
  ]);
  assert.deepEqual(validateCurriculum(curriculum, topics), []);
  const allScheduled = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse("2026-08-08T00:00:00Z") + (index * 86_400_000)).toISOString().slice(0, 10);
    return scheduleForDate(date, topics);
  }).flat();
  assert.deepEqual([...allScheduled].sort(), topics.modules.map((module) => module.id).sort());
  assert.deepEqual(validateEntry(entry, topics, entry.date, curriculum, []), []);

  const wrongUnit = structuredClone(entry);
  wrongUnit.lessons[0].curriculum.unitId = "consumer_psychology_choice_default";
  assert.ok(validateEntry(wrongUnit, topics, wrongUnit.date, curriculum, [])
    .some((message) => message.includes("curriculum.unitId")));

  const wrongModule = structuredClone(entry);
  wrongModule.lessons[0].module = "ai";
  assert.ok(validateEntry(wrongModule, topics, wrongModule.date, curriculum, [])
    .some((message) => message.includes("当天学习计划")));

  const wrongObjective = structuredClone(entry);
  wrongObjective.lessons[0].learningObjectives[0] = "随意改写的目标";
  assert.ok(validateEntry(wrongObjective, topics, wrongObjective.date, curriculum, [])
    .some((message) => message.includes("固定目标一致")));

  const wrongScope = structuredClone(entry);
  wrongScope.lessons[0].curriculum.scope = "可以随意展开相邻单元";
  assert.ok(validateEntry(wrongScope, topics, wrongScope.date, curriculum, [])
    .some((message) => message.includes("curriculum.scope")));

  const nextPlan = curriculumPlanForDate("2026-08-15", topics, curriculum, [entry]);
  const consumer = nextPlan.find((item) => item.module === "consumer_psychology");
  assert.equal(consumer.unit.sequence, 2);
  assert.equal(consumer.unit.id, "consumer_psychology_journey_jobs");
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

test("所有生成页面的本地链接在项目子路径结构中都能解析", async () => {
  const htmlFiles = (await filesUnder(distPath)).filter((file) => file.endsWith(".html"));
  assert.equal(htmlFiles.length, 18);
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
