import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  collectGroundedSourceUrls,
  normalizeSourceUrl,
  validateEntry
} from "../scripts/lib.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

async function text(relative) {
  return readFile(new URL(relative, dist), "utf8");
}

test("首页展示最新一期与核心学习信息", async () => {
  const html = await text("index.html");
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /每日学习｜把目标说清，比把按钮按对更重要/);
  assert.match(html, /30% 最新变化/);
  assert.match(html, /70% 长期知识/);
  assert.match(html, /品牌 \/ 产品 \/ 用户研究/);
  assert.match(html, /管理与组织认知/);
  assert.match(html, /财务 \/ 投资 \/ 宏观经济/);
  assert.match(html, /认知科学与决策能力/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
});

test("历史列表和日期直达页面均为可独立访问的静态 HTML", async () => {
  const [archive, issue] = await Promise.all([
    text("archive/index.html"),
    text("2026-08-08/index.html")
  ]);
  assert.match(archive, /全部往期/);
  assert.match(archive, /\.\.\/2026-08-08\//);
  assert.match(archive, /data-archive-search/);
  assert.match(issue, /2026-08-08｜把目标说清，比把按钮按对更重要｜每日学习/);
  assert.match(issue, /href="\.\.\/assets\/styles\.css"/);
  assert.match(issue, /href="\.\.\/archive\/"/);
});

test("每份源数据都有对应页面与公开 JSON", async () => {
  const files = (await readdir(new URL("content/daily/", root)))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const date = file.replace(/\.json$/, "");
    await access(new URL(`${date}/index.html`, dist));
    const publicJson = JSON.parse(await text(`content/daily/${file}`));
    assert.equal(publicJson.date, date);
  }
});

test("归档索引、RSS、404 与社交预览资源完整", async () => {
  const [archive, latest, feed, missing] = await Promise.all([
    text("content/archive.json").then(JSON.parse),
    text("content/latest.json").then(JSON.parse),
    text("feed.xml"),
    text("404.html")
  ]);
  assert.equal(archive[0].date, latest.date);
  assert.match(feed, /<rss version="2\.0">/);
  assert.match(feed, /<title>每日学习<\/title>/);
  assert.match(missing, /这一页还没有学习笔记/);
  await access(new URL("assets/og.png", dist));
  await access(new URL(".nojekyll", dist));
});

test("生成内容作为纯文本转义，外部来源使用安全协议", async () => {
  const html = await text("2026-08-08/index.html");
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<script[^>]*>.*OpenAI API/s);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("内容校验强制当天轮换且不允许重复模块", async () => {
  const [topics, entry] = await Promise.all([
    readFile(new URL("config/topics.json", root), "utf8").then(JSON.parse),
    readFile(new URL("content/daily/2026-08-08.json", root), "utf8").then(JSON.parse)
  ]);
  assert.deepEqual(validateEntry(entry, topics, entry.date), []);

  const invalid = structuredClone(entry);
  invalid.sections[5].module = invalid.sections[0].module;
  const errors = validateEntry(invalid, topics, invalid.date);
  assert.ok(errors.some((message) => message.includes("module 重复")));
  assert.ok(errors.some((message) => message.includes("必须匹配当天轮换")));

  const wrongMix = structuredClone(entry);
  wrongMix.sections[0].freshness = "evergreen";
  wrongMix.freshRatio = 0.2;
  assert.ok(validateEntry(wrongMix, topics, wrongMix.date)
    .some((message) => message.includes("latest 模块必须恰好 2 个")));
});

test("时效性来源可与真实检索记录做规范化核对", () => {
  const response = {
    output: [
      {
        type: "web_search_call",
        action: {
          sources: [{ url: "http://EXAMPLE.com/news/?utm_source=search#section" }]
        }
      },
      {
        type: "message",
        content: [
          {
            annotations: [
              { type: "url_citation", url: "https://docs.example.org/update/?b=2&a=1" }
            ]
          }
        ]
      }
    ]
  };
  const urls = collectGroundedSourceUrls(response);
  assert.ok(urls.has("https://example.com/news"));
  assert.ok(urls.has("https://docs.example.org/update?a=1&b=2"));
  assert.equal(
    normalizeSourceUrl("https://example.com/news?fbclid=tracking"),
    "https://example.com/news"
  );
});
