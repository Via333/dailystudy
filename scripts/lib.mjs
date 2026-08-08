import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DAILY_DIR = path.join(ROOT, "content", "daily");

export function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayOffset(date, startDate) {
  if (!isDateString(date) || !isDateString(startDate)) {
    throw new Error("课程起始日期与内容日期必须是有效的 YYYY-MM-DD");
  }
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}

export function scheduleForDate(date, topics) {
  const offset = dayOffset(date, topics.curriculumStartDate);
  const index = ((offset % topics.dailySchedule.length) + topics.dailySchedule.length) % topics.dailySchedule.length;
  return topics.dailySchedule[index];
}

// Kept as a small compatibility alias for callers that used the first version.
export const rotationForDate = scheduleForDate;

export function flattenTrack(track) {
  const units = [];
  for (const stage of track?.stages ?? []) {
    const stageUnits = stage?.units ?? [];
    for (const unit of stageUnits) {
      const excluded = stageUnits.filter((item) => item.id !== unit.id).map((item) => `「${item.title}」`);
      units.push({
        ...unit,
        stageId: stage.id,
        stageTitle: stage.title,
        stageOutcome: stage.outcome,
        objective: unit.objective ?? `掌握「${unit.title}」的核心概念、判断方法与适用边界，并能用于一个具体案例。`,
        scope: unit.scope ?? `本课只展开「${unit.title}」；${excluded.join("、")}仅可作为背景提及，不得展开其框架、方法或练习。`
      });
    }
  }
  return units.map((unit, index) => ({
    ...unit,
    sequence: index + 1,
    totalUnits: units.length
  }));
}

export function curriculumPlanForDate(date, topics, curriculum, entries = []) {
  const trackMap = new Map(curriculum.tracks.map((track) => [track.module, track]));
  return scheduleForDate(date, topics).map((module) => {
    const track = trackMap.get(module);
    if (!track) throw new Error(`课程目录缺少主题：${module}`);
    const units = flattenTrack(track);
    if (!units.length) throw new Error(`课程主题没有单元：${module}`);
    const previousCount = entries
      .filter((entry) => entry.date < date)
      .flatMap((entry) => entry.lessons ?? [])
      .filter((lesson) => lesson.module === module)
      .length;
    const unit = units[previousCount % units.length];
    return {
      module,
      track,
      unit,
      cycle: Math.floor(previousCount / units.length) + 1
    };
  });
}

export function parseArguments(argv) {
  const result = { date: undefined, force: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") result.force = true;
    else if (value === "--dry-run") result.dryRun = true;
    else if (value === "--date") result.date = argv[++index];
    else throw new Error(`未知参数：${value}`);
  }
  if (result.date && !isDateString(result.date)) {
    throw new Error(`日期必须是有效的 YYYY-MM-DD：${result.date}`);
  }
  return result;
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readTopics() {
  return readJson(path.join(ROOT, "config", "topics.json"));
}

export async function readCurriculum() {
  return readJson(path.join(ROOT, "config", "curriculum.json"));
}

export async function readDailyEntries() {
  const files = (await readdir(DAILY_DIR))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  return Promise.all(files.map(async (name) => {
    const entry = await readJson(path.join(DAILY_DIR, name));
    Object.defineProperty(entry, "__fileDate", {
      value: name.replace(/\.json$/, ""),
      enumerable: false
    });
    return entry;
  }));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validText(value, minimum = 2) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function validateSource(source, label, errors) {
  if (!validText(source?.title) || !validText(source?.publisher) || !isHttpUrl(source?.url)) {
    errors.push(`${label} 缺少标题、发布方或有效网址`);
  }
  if (typeof source?.publishedAt !== "string") errors.push(`${label}.publishedAt 必须是文本`);
}

export function validateCurriculum(curriculum, topics) {
  const errors = [];
  if (!curriculum || typeof curriculum !== "object" || Array.isArray(curriculum)) return ["课程目录必须是 JSON 对象"];
  if (curriculum.schemaVersion !== 1) errors.push("课程目录 schemaVersion 必须为 1");
  if (!isDateString(curriculum.startDate)) errors.push("课程目录 startDate 必须是有效日期");
  if (!Array.isArray(curriculum.tracks)) return [...errors, "课程目录 tracks 必须是数组"];

  const topicIds = new Set(topics.modules.map((module) => module.id));
  const seenTracks = new Set();
  const seenStages = new Set();
  const seenUnits = new Set();
  for (const [trackIndex, track] of curriculum.tracks.entries()) {
    const label = `tracks[${trackIndex}]`;
    if (!topicIds.has(track?.module)) errors.push(`${label}.module 未在主题配置中：${track?.module}`);
    if (seenTracks.has(track?.module)) errors.push(`${label}.module 重复：${track?.module}`);
    seenTracks.add(track?.module);
    if (!validText(track?.goal, 12)) errors.push(`${label}.goal 需要清晰的学习目标`);
    if (!Array.isArray(track?.principles) || track.principles.length < 3 || track.principles.some((item) => !validText(item, 4))) {
      errors.push(`${label}.principles 至少需要 3 条有效原则`);
    }
    if (typeof track?.newsEligible !== "boolean") errors.push(`${label}.newsEligible 必须是布尔值`);
    if (!Array.isArray(track?.stages) || track.stages.length < 5) {
      errors.push(`${label}.stages 至少需要 5 个阶段`);
      continue;
    }
    let unitCount = 0;
    for (const [stageIndex, stage] of track.stages.entries()) {
      const stageLabel = `${label}.stages[${stageIndex}]`;
      if (!/^[a-z0-9_-]+$/.test(stage?.id ?? "")) errors.push(`${stageLabel}.id 格式无效`);
      if (seenStages.has(`${track.module}:${stage?.id}`)) errors.push(`${stageLabel}.id 在主题内重复`);
      seenStages.add(`${track.module}:${stage?.id}`);
      if (!validText(stage?.title) || !validText(stage?.outcome, 8)) errors.push(`${stageLabel} 缺少标题或学习结果`);
      if (!Array.isArray(stage?.units) || stage.units.length < 4) {
        errors.push(`${stageLabel}.units 至少需要 4 个单元`);
        continue;
      }
      for (const [unitIndex, unit] of stage.units.entries()) {
        const unitLabel = `${stageLabel}.units[${unitIndex}]`;
        unitCount += 1;
        if (!/^[a-z0-9_-]+$/.test(unit?.id ?? "")) errors.push(`${unitLabel}.id 格式无效`);
        if (!String(unit?.id ?? "").startsWith(`${track.module}_`)) errors.push(`${unitLabel}.id 必须以 ${track.module}_ 开头`);
        if (seenUnits.has(unit?.id)) errors.push(`${unitLabel}.id 全局重复：${unit?.id}`);
        seenUnits.add(unit?.id);
        if (!validText(unit?.title, 4)) errors.push(`${unitLabel}.title 必须是有效标题`);
      }
    }
    if (unitCount < 24) errors.push(`${label} 至少需要 24 个课程单元，当前为 ${unitCount}`);
  }
  const missingTracks = [...topicIds].filter((id) => !seenTracks.has(id));
  const extraTracks = [...seenTracks].filter((id) => !topicIds.has(id));
  if (missingTracks.length) errors.push(`课程目录缺少主题：${missingTracks.join(", ")}`);
  if (extraTracks.length) errors.push(`课程目录包含未知主题：${extraTracks.join(", ")}`);
  if (curriculum.tracks.length !== topics.modules.length) errors.push("课程主题数量必须与主题配置完全一致");
  return errors;
}

export function validateEntry(entry, topics, expectedDate, curriculum, priorEntries = []) {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["内容必须是一个 JSON 对象"];
  if (entry.schemaVersion !== 2) errors.push("schemaVersion 必须为 2");
  if (!isDateString(entry.date)) errors.push("date 必须是有效的 YYYY-MM-DD");
  if (expectedDate && entry.date !== expectedDate) errors.push(`文件日期 ${expectedDate} 与内容日期 ${entry.date} 不一致`);
  for (const key of ["title", "subtitle", "theme", "closing"]) {
    if (!validText(entry[key])) errors.push(`${key} 必须是非空文本`);
  }
  if (!Number.isInteger(entry.estimatedMinutes) || entry.estimatedMinutes < 30 || entry.estimatedMinutes > 45) {
    errors.push("estimatedMinutes 必须为 30–45 的整数");
  }
  if (!Array.isArray(entry.introduction) || entry.introduction.length < 1 || entry.introduction.some((item) => !validText(item, 10))) {
    errors.push("introduction 至少需要一段有效正文");
  }

  const knownModules = new Set(topics.modules.map((module) => module.id));
  let plan = [];
  if (curriculum && isDateString(entry.date)) {
    try {
      plan = curriculumPlanForDate(entry.date, topics, curriculum, priorEntries);
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push("校验每日内容时必须提供课程目录");
  }

  if (!Array.isArray(entry.lessons) || entry.lessons.length < 1 || entry.lessons.length > 2) {
    errors.push("lessons 必须包含 1–2 节深度课程");
  } else {
    const lessonModules = entry.lessons.map((lesson) => lesson?.module);
    const expectedModules = plan.map((item) => item.module);
    if (lessonModules.join("|") !== expectedModules.join("|")) {
      errors.push(`课程必须按当天学习计划推进：应为 ${expectedModules.join(", ")}，当前为 ${lessonModules.join(", ")}`);
    }
    const ids = new Set();
    entry.lessons.forEach((lesson, index) => {
      const label = `lessons[${index}]`;
      if (!lesson || typeof lesson !== "object") {
        errors.push(`${label} 必须是对象`);
        return;
      }
      if (!/^[a-z0-9-]+$/.test(lesson.id ?? "")) errors.push(`${label}.id 格式无效`);
      if (ids.has(lesson.id)) errors.push(`${label}.id 重复：${lesson.id}`);
      ids.add(lesson.id);
      if (!knownModules.has(lesson.module)) errors.push(`${label}.module 未在主题配置中`);
      const expected = plan[index];
      const meta = lesson.curriculum;
      if (!meta || typeof meta !== "object") errors.push(`${label}.curriculum 必须是对象`);
      else if (expected) {
        const expectedMeta = {
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
        for (const [key, value] of Object.entries(expectedMeta)) {
          if (meta[key] !== value) errors.push(`${label}.curriculum.${key} 必须为 ${value}`);
        }
      }
      for (const key of ["eyebrow", "title", "summary", "application", "boundary", "takeaway", "reflection"]) {
        if (!validText(lesson[key], key === "eyebrow" ? 2 : 8)) errors.push(`${label}.${key} 必须是有效文本`);
      }
      if (!Number.isInteger(lesson.estimatedMinutes) || lesson.estimatedMinutes < 12 || lesson.estimatedMinutes > 18) {
        errors.push(`${label}.estimatedMinutes 必须为 12–18 的整数`);
      }
      if (!Array.isArray(lesson.learningObjectives) || lesson.learningObjectives.length < 2 || lesson.learningObjectives.some((item) => !validText(item, 6))) {
        errors.push(`${label}.learningObjectives 至少需要两项目标`);
      }
      if (expected && lesson.learningObjectives?.[0] !== expected.unit.objective) {
        errors.push(`${label}.learningObjectives[0] 必须与课程目录的固定目标一致`);
      }
      if (!Array.isArray(lesson.body) || lesson.body.length < 4 || lesson.body.some((item) => !validText(item, 20))) {
        errors.push(`${label}.body 至少需要四段有效正文`);
      }
      if (!Array.isArray(lesson.keyPoints) || lesson.keyPoints.length < 3 || lesson.keyPoints.some((item) => !validText(item, 6))) {
        errors.push(`${label}.keyPoints 至少需要三条有效要点`);
      }
      if (!Array.isArray(lesson.sources)) errors.push(`${label}.sources 必须是数组`);
      else lesson.sources.forEach((source, sourceIndex) => validateSource(source, `${label}.sources[${sourceIndex}]`, errors));
    });
  }

  if (!Array.isArray(entry.radar) || entry.radar.length !== 1) {
    errors.push("radar 必须包含恰好 1 条独立前沿更新");
  } else {
    entry.radar.forEach((item, index) => {
      const label = `radar[${index}]`;
      if (!/^[a-z0-9-]+$/.test(item?.id ?? "")) errors.push(`${label}.id 格式无效`);
      for (const key of ["title", "summary"]) if (!validText(item?.[key], 8)) errors.push(`${label}.${key} 必须是有效文本`);
      if (!Number.isInteger(item?.estimatedMinutes) || item.estimatedMinutes < 3 || item.estimatedMinutes > 8) {
        errors.push(`${label}.estimatedMinutes 必须为 3–8 的整数`);
      }
      if (!Array.isArray(item?.body) || item.body.length < 1 || item.body.some((paragraph) => !validText(paragraph, 20))) {
        errors.push(`${label}.body 至少需要一段有效正文`);
      }
      if (!Array.isArray(item?.relatedModules) || item.relatedModules.length < 1 || item.relatedModules.some((id) => !knownModules.has(id))) {
        errors.push(`${label}.relatedModules 至少需要一个已知主题`);
      }
      if (!Array.isArray(item?.sources) || item.sources.length < 1) errors.push(`${label}.sources 至少需要一个可核验来源`);
      else item.sources.forEach((source, sourceIndex) => validateSource(source, `${label}.sources[${sourceIndex}]`, errors));
    });
  }

  if (!entry.practice || !validText(entry.practice.title, 4) || !validText(entry.practice.prompt, 12) || !Array.isArray(entry.practice.steps) || entry.practice.steps.length < 2) {
    errors.push("practice 需要题目、提示和至少两个步骤");
  }
  if (!Number.isInteger(entry.practice?.estimatedMinutes) || entry.practice.estimatedMinutes < 5 || entry.practice.estimatedMinutes > 10) {
    errors.push("practice.estimatedMinutes 必须为 5–10 的整数");
  }
  if (Array.isArray(entry.lessons) && Array.isArray(entry.radar) && Number.isInteger(entry.practice?.estimatedMinutes)) {
    const calculatedMinutes = [...entry.lessons, ...entry.radar]
      .reduce((total, item) => total + (Number.isInteger(item?.estimatedMinutes) ? item.estimatedMinutes : 0), entry.practice.estimatedMinutes);
    if (calculatedMinutes !== entry.estimatedMinutes) {
      errors.push(`estimatedMinutes ${entry.estimatedMinutes} 必须等于课程、雷达与练习合计 ${calculatedMinutes}`);
    }
  }
  return errors;
}

export function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.href;
  } catch {
    return "";
  }
}

export function collectGroundedSourceUrls(response) {
  const urls = new Set();
  const add = (value) => {
    const normalized = normalizeSourceUrl(value);
    if (normalized) urls.add(normalized);
  };
  for (const item of response?.output ?? []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources ?? item.sources ?? []) add(source?.url);
    }
    if (item.type === "message") {
      for (const content of item.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === "url_citation") add(annotation.url ?? annotation.url_citation?.url);
        }
      }
    }
  }
  return urls;
}

export function assertValidEntry(entry, topics, expectedDate, curriculum, priorEntries = []) {
  const errors = validateEntry(entry, topics, expectedDate, curriculum, priorEntries);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
}
