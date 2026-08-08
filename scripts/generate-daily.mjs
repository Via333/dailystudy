import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DAILY_SCHEMA } from "./content-schema.mjs";
import {
  DAILY_DIR,
  assertValidEntry,
  collectGroundedSourceUrls,
  curriculumPlanForDate,
  normalizeSourceUrl,
  parseArguments,
  readCurriculum,
  readDailyEntries,
  readTopics,
  shanghaiDate
} from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const targetDate = args.date ?? shanghaiDate();
const outputPath = path.join(DAILY_DIR, `${targetDate}.json`);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
let targetExists = false;

try {
  await access(outputPath);
  targetExists = true;
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

const [topics, curriculum, entries] = await Promise.all([
  readTopics(),
  readCurriculum(),
  readDailyEntries()
]);
if (!targetExists && entries.some((entry) => entry.date > targetDate)) {
  throw new Error("不能直接在现有归档之前插入新日期，否则会打乱课程顺序。请从该日期起重建后续归档。");
}

const plan = curriculumPlanForDate(targetDate, topics, curriculum, entries);
const moduleMap = new Map(topics.modules.map((module) => [module.id, module]));
const recentLessons = entries
  .flatMap((entry) => (entry.lessons ?? []).map((lesson) => `${entry.date}｜${lesson.module}｜${lesson.coreQuestion ?? lesson.curriculum?.unitTitle ?? "课程"}`))
  .slice(0, 12);
const lessonMinutes = plan.length === 1 ? 16 : 12;
const radarMinutes = 4;
const practiceMinutes = plan.length === 1 ? 10 : 5;
const totalMinutes = (lessonMinutes * plan.length) + radarMinutes + practiceMinutes;

const planText = plan.map((item, index) => {
  const module = moduleMap.get(item.module);
  return `${index + 1}. ${module.title}（${item.module}）
   - 课程目标：${item.track.goal}
   - 当前阶段：${item.unit.stageTitle}
   - 阶段成果：${item.unit.stageOutcome}
   - 固定单元：${item.unit.title}（${item.unit.id}）
   - 固定目标：${item.unit.objective}
   - 内容边界：${item.unit.scope}
   - 位置：第 ${item.unit.sequence}/${item.unit.totalUnits} 课，第 ${item.cycle} 轮
   - 编辑原则：${item.track.principles.join("；")}`;
}).join("\n");

const prompt = `你是“每日学习”的课程主编。请为 ${targetDate}（Asia/Shanghai）完成一期中文深度学习内容。

这不是随机选题，也不是六条资讯摘要。程序已经从 13 条课程路径中确定了今天必须推进的课程节点；你只能讲下面这些固定单元，不能更换、合并或跳课：

${planText}

写作与结构要求：
- 生成 ${plan.length} 节深度课程，每节 estimatedMinutes 固定为 ${lessonMinutes}；行业雷达恰好 1 条，estimatedMinutes 固定为 ${radarMinutes}；练习固定为 ${practiceMinutes} 分钟；全期 estimatedMinutes 固定为 ${totalMinutes}。
- 每节课程必须严格依次使用这 6 个结构块：coreQuestion（核心问题）→ framework（框架）→ keyPoints（恰好 3 个重点）→ caseStudy（一个案例）→ exercise（一个小练习）→ conclusion（一句话结论）。不得增加长篇正文或重复摘要。
- coreQuestion 只问一个问题并以问号结尾；framework 用 2–3 步解释一个可复用框架并写清边界；3 个 keyPoints 必须有短标题，彼此不重复。
- caseStudy 只使用一个具体案例，并明确用本课框架分析；exercise 要求读者产出一个可检查的结果；conclusion 只能有一句话。
- 每节课程上述 6 个结构块的可见文字合计必须为 350–750 个中文字符。curriculum 元数据和 sources 不计入。不要在多个字段反复表达同一句结论。
- 行业新变化只放在 radar，绝不能替代核心课程。radar 必须基于截至 ${targetDate} 已公开、确实值得知道的变化，并说明它与哪些课程主题有关。
- radar 只写 whatChanged、whyItMatters、courseConnection 三段短信息，连同标题合计不超过 280 个中文字符；至少关联今天一门课程，避免无关资讯抢占注意力。
- 必须实际使用 web search 核验 radar，优先公司公告、官方产品文档、监管机构或原始研究。sources.url 逐字复制真实检索结果，不能猜网址；页面会把每个网址与检索记录核对。
- 核心课的 sources 可以为空；若引用研究、数据或具体事实，也必须来自本次真实检索记录。
- 区分事实、来源方自报与编辑判断。不确定的数字删掉，不编造。
- introduction 只写一段；页面标题、导语和 closing 都要简短。最后的全日 practice 用于连接今天的课程，不得复制每节 exercise。
- 语气清晰、克制、具体，优先短句、标签和可执行判断，避免术语堆砌和空泛鸡汤。不要提到你是 AI。

最近课程标题（避免重复表达，但不能改变课程节点）：
${recentLessons.length ? recentLessons.map((line) => `- ${line}`).join("\n") : "- 暂无"}

只输出符合 JSON Schema 的内容。日期必须为 ${targetDate}，schemaVersion 必须为 3。`;

const responseSchema = structuredClone(DAILY_SCHEMA);
responseSchema.properties.lessons.minItems = plan.length;
responseSchema.properties.lessons.maxItems = plan.length;
responseSchema.properties.lessons.items.properties.module.enum = plan.map((item) => item.module);
responseSchema.properties.lessons.items.properties.curriculum.properties.stageId.enum = plan.map((item) => item.unit.stageId);
responseSchema.properties.lessons.items.properties.curriculum.properties.unitId.enum = plan.map((item) => item.unit.id);
responseSchema.properties.radar.minItems = 1;
responseSchema.properties.radar.maxItems = 1;
responseSchema.properties.radar.items.properties.relatedModules.items.enum = topics.modules.map((module) => module.id);

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
        content: [{
          type: "input_text",
          text: "你是一位严谨的中文商业课程编辑。课程节点由程序决定；你负责把指定概念讲透，并让所有时效事实可回到一手来源核验。"
        }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }]
      }
    ],
    max_output_tokens: 9_000,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "daily_learning_curriculum_entry",
        description: "按固定知识树顺序推进的一期每日学习内容",
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
if (result.status !== "completed") throw new Error(`内容生成未完成：${result.status ?? "unknown"}`);

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

// Identity and pacing come from the curriculum engine, never from model choice.
entry.date = targetDate;
entry.schemaVersion = 3;
entry.estimatedMinutes = totalMinutes;
if (!Array.isArray(entry.lessons) || entry.lessons.length !== plan.length) {
  throw new Error(`模型返回的课程数量与固定计划不一致：应为 ${plan.length}`);
}
entry.lessons.forEach((lesson, index) => {
  const expected = plan[index];
  if (lesson.module !== expected.module || lesson.curriculum?.unitId !== expected.unit.id) {
    throw new Error(`模型偏离固定课程节点：第 ${index + 1} 节应为 ${expected.module} / ${expected.unit.id}`);
  }
});
if (!Array.isArray(entry.radar) || entry.radar.length !== 1) {
  throw new Error("模型必须返回恰好一条独立行业雷达");
}
entry.lessons.forEach((lesson, index) => {
  const expected = plan[index];
  lesson.module = expected.module;
  lesson.estimatedMinutes = lessonMinutes;
  lesson.curriculum = {
    stageId: expected.unit.stageId,
    stageTitle: expected.unit.stageTitle,
    unitId: expected.unit.id,
    unitTitle: expected.unit.title,
    objective: expected.unit.objective,
    scope: expected.unit.scope,
    sequence: expected.unit.sequence,
    totalUnits: expected.unit.totalUnits,
    cycle: expected.cycle
  };
});
entry.radar[0].estimatedMinutes = radarMinutes;
entry.practice.estimatedMinutes = practiceMinutes;

assertValidEntry(entry, topics, targetDate, curriculum, entries);

const groundedUrls = collectGroundedSourceUrls(result);
const citedUrls = [...entry.lessons, ...entry.radar]
  .flatMap((item) => item.sources.map((source) => source.url));
if (citedUrls.length && groundedUrls.size === 0) {
  throw new Error("本次生成没有返回可核验的 web search 来源，拒绝写入归档");
}
const ungrounded = citedUrls.filter((url) => !groundedUrls.has(normalizeSourceUrl(url)));
if (ungrounded.length) {
  throw new Error(`以下来源不在本次真实检索记录中，拒绝写入：\n${[...new Set(ungrounded)].map((url) => `- ${url}`).join("\n")}`);
}

const serialized = `${JSON.stringify(entry, null, 2)}\n`;
if (args.dryRun) process.stdout.write(serialized);
else {
  await mkdir(DAILY_DIR, { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  console.log(`✓ 已按课程顺序生成 ${path.relative(process.cwd(), outputPath)}（${model}）`);
}
