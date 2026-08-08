import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DAILY_SCHEMA } from "./content-schema.mjs";
import {
  DAILY_DIR,
  assertValidEntry,
  collectGroundedSourceUrls,
  normalizeSourceUrl,
  parseArguments,
  readDailyEntries,
  readTopics,
  rotationForDate,
  shanghaiDate
} from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const targetDate = args.date ?? shanghaiDate();
const outputPath = path.join(DAILY_DIR, `${targetDate}.json`);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

try {
  await access(outputPath);
  if (!args.force) {
    console.log(`✓ ${targetDate} 已有归档，保持历史内容不变`);
    process.exit(0);
  }
} catch {
  // The date has not been generated yet.
}

if (!apiKey) {
  throw new Error("缺少 OPENAI_API_KEY。请在 GitHub Actions secrets 或本地环境中配置后再生成。");
}

const topics = await readTopics();
const recentEntries = (await readDailyEntries()).slice(0, 7);
const rotation = rotationForDate(targetDate, topics);
const moduleMap = new Map(topics.modules.map((module) => [module.id, module]));
const selectedModules = rotation.map((id) => moduleMap.get(id)).filter(Boolean);

const prompt = `你是“每日学习”的主编。请为 ${targetDate}（Asia/Shanghai）制作一期中文学习内容。

读者画像：从事广告、营销或商业工作，希望逐步建立完整的商业认知体系。不是追逐碎片资讯，而是训练可以迁移的判断框架。

本期固定模块（module 必须使用括号内 ID，且每个恰好一次）：
${selectedModules.map((module, index) => `${index + 1}. ${module.title}（${module.id}）：${module.description}`).join("\n")}

编辑标准：
- 全期 30–45 分钟，按上面的固定模块生成 6 个正文模块；正文与最后练习的分钟数合计应接近全期 estimatedMinutes。
- 6 个正文中恰好 2 个标记为 latest、4 个标记为 evergreen，freshRatio 填 0.33。latest 必须基于最近 7 天内、截至 ${targetDate} 已经公开的信息；若没有足够重要的新变化，可以使用最近 30 天信息但要在正文中明确日期。
- latest 模块必须实际使用 web search，优先引用公司公告、产品文档、监管机构、原始研究等一手来源；sources 中放直接、可点击的原始页面网址。不要引用搜索结果页、聚合转载或无法核验的数字。
- sources.url 必须逐字复制本次 web search 返回的原始网址，不要自行补写、改写或猜测网址；生成器会把它与真实检索记录逐一核对。
- evergreen 模块要给可迁移的框架、边界条件和实际例子；不要写空泛鸡汤。
- 品牌 / 产品 / 用户研究、管理与组织认知、财务 / 投资 / 宏观经济、认知科学与决策能力是正式核心模块，不得降格成一句小贴士。
- 区分事实、来源方自报数据和编辑判断。涉及效果数字时说明口径；不确定时删掉数字，不要编造。
- 每节使用 2–4 段正文、2–4 个关键点、一个今天可执行的 takeaway 和一个 reflection。
- 行文清晰、克制、具体。不要使用“赋能、颠覆、史诗级”等空洞词。不要提到你是 AI。
- 最后设计一个能连接至少两个本期模块的 5–10 分钟练习。

最近几期标题（避免重复）：
${recentEntries.length ? recentEntries.map((entry) => `- ${entry.date}：${entry.title}`).join("\n") : "- 暂无"}

只输出符合给定 JSON Schema 的内容。日期必须是 ${targetDate}，schemaVersion 必须是 1。`;

const responseSchema = structuredClone(DAILY_SCHEMA);
responseSchema.properties.sections.items.properties.module.enum = rotation;

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model,
    store: false,
    reasoning: { effort: "low" },
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          country: "CN",
          timezone: "Asia/Shanghai"
        }
      }
    ],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "你是一位严谨的中文商业学习主编。所有时效性事实必须先检索并保留可点击的一手来源。"
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }]
      }
    ],
    max_output_tokens: 14_000,
    text: {
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: "daily_learning_entry",
        description: "一期结构化、可验证的每日学习内容",
        strict: true,
        schema: responseSchema
      }
    }
  }),
  signal: AbortSignal.timeout(300_000)
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`OpenAI API 返回 ${response.status}：${detail.slice(0, 1_000)}`);
}

const result = await response.json();
if (result.status !== "completed") {
  throw new Error(`内容生成未完成：${result.status ?? "unknown"}`);
}

const outputText = result.output
  ?.filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .find((content) => content.type === "output_text")?.text;

if (!outputText) throw new Error("API 响应中没有可用的结构化正文");

let entry;
try {
  entry = JSON.parse(outputText);
} catch (error) {
  throw new Error(`无法解析 API 返回的 JSON：${error.message}`);
}

entry.date = targetDate;
entry.schemaVersion = 1;
assertValidEntry(entry, topics, targetDate);

const groundedUrls = collectGroundedSourceUrls(result);
if (groundedUrls.size === 0) {
  throw new Error("本次生成没有返回可核验的 web search 来源，拒绝写入归档");
}
const ungrounded = entry.sections
  .filter((section) => section.freshness === "latest")
  .flatMap((section) => section.sources.map((source) => source.url))
  .filter((url) => !groundedUrls.has(normalizeSourceUrl(url)));
if (ungrounded.length) {
  throw new Error(`以下时效性来源不在本次真实检索记录中，拒绝写入：\n${[...new Set(ungrounded)].map((url) => `- ${url}`).join("\n")}`);
}

const serialized = `${JSON.stringify(entry, null, 2)}\n`;
if (args.dryRun) {
  process.stdout.write(serialized);
} else {
  await mkdir(DAILY_DIR, { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  console.log(`✓ 已生成 ${path.relative(process.cwd(), outputPath)}（${model}）`);
}
