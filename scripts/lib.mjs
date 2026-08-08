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

export function rotationForDate(date, topics) {
  if (!isDateString(date) || !isDateString(topics.rotationStartDate)) {
    throw new Error("轮换起始日期与内容日期必须是有效的 YYYY-MM-DD");
  }
  const day = 86_400_000;
  const offset = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${topics.rotationStartDate}T00:00:00Z`)) / day);
  return topics.rotation[((offset % topics.rotation.length) + topics.rotation.length) % topics.rotation.length];
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

export function validateEntry(entry, topics, expectedDate) {
  const errors = [];
  const strings = ["title", "subtitle", "theme", "closing"];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return ["内容必须是一个 JSON 对象"];
  }
  if (entry.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (!isDateString(entry.date)) errors.push("date 必须是有效的 YYYY-MM-DD");
  if (expectedDate && entry.date !== expectedDate) {
    errors.push(`文件日期 ${expectedDate} 与内容日期 ${entry.date} 不一致`);
  }
  for (const key of strings) {
    if (typeof entry[key] !== "string" || entry[key].trim().length < 2) {
      errors.push(`${key} 必须是非空文本`);
    }
  }
  if (!Number.isInteger(entry.estimatedMinutes) || entry.estimatedMinutes < 30 || entry.estimatedMinutes > 45) {
    errors.push("estimatedMinutes 必须为 30–45 的整数");
  }
  if (typeof entry.freshRatio !== "number" || entry.freshRatio < 0.2 || entry.freshRatio > 0.4) {
    errors.push("freshRatio 必须介于 0.2 和 0.4");
  }
  if (!Array.isArray(entry.introduction) || entry.introduction.length < 1) {
    errors.push("introduction 至少需要一段");
  }
  if (!Array.isArray(entry.sections) || entry.sections.length !== 6) {
    errors.push("sections 必须包含恰好 6 个模块");
  } else {
    const knownModules = new Set(topics.modules.map((module) => module.id));
    const ids = new Set();
    const includedModules = new Set();
    let latestCount = 0;
    entry.sections.forEach((section, index) => {
      const label = `sections[${index}]`;
      if (!section || typeof section !== "object") {
        errors.push(`${label} 必须是对象`);
        return;
      }
      if (!/^[a-z0-9-]+$/.test(section.id ?? "")) errors.push(`${label}.id 格式无效`);
      for (const key of ["eyebrow", "title", "summary", "takeaway", "reflection"]) {
        if (typeof section[key] !== "string" || section[key].trim().length < 2) {
          errors.push(`${label}.${key} 必须是非空文本`);
        }
      }
      if (ids.has(section.id)) errors.push(`${label}.id 重复：${section.id}`);
      ids.add(section.id);
      if (!knownModules.has(section.module)) errors.push(`${label}.module 未在主题配置中：${section.module}`);
      if (includedModules.has(section.module)) errors.push(`${label}.module 重复：${section.module}`);
      includedModules.add(section.module);
      if (!Number.isInteger(section.estimatedMinutes) || section.estimatedMinutes < 3 || section.estimatedMinutes > 10) {
        errors.push(`${label}.estimatedMinutes 必须为 3–10 的整数`);
      }
      if (!Array.isArray(section.body) || section.body.length < 2 || section.body.some((item) => typeof item !== "string" || item.trim().length < 10)) {
        errors.push(`${label}.body 至少需要两段有效正文`);
      }
      if (!Array.isArray(section.keyPoints) || section.keyPoints.length < 2 || section.keyPoints.some((item) => typeof item !== "string" || item.trim().length < 4)) {
        errors.push(`${label}.keyPoints 至少需要两条有效要点`);
      }
      if (!["latest", "evergreen"].includes(section.freshness)) errors.push(`${label}.freshness 无效`);
      if (section.freshness === "latest") latestCount += 1;
      if (!Array.isArray(section.sources)) errors.push(`${label}.sources 必须是数组`);
      else {
        if (section.freshness === "latest" && section.sources.length === 0) {
          errors.push(`${label} 是最新变化，至少需要一个可点击来源`);
        }
        section.sources.forEach((source, sourceIndex) => {
          if (!source?.title || !source?.publisher || !isHttpUrl(source?.url)) {
            errors.push(`${label}.sources[${sourceIndex}] 缺少标题、发布方或有效网址`);
          }
        });
      }
    });
    if (latestCount !== 2) {
      errors.push(`latest 模块必须恰好 2 个，当前为 ${latestCount} 个`);
    }
    const ratio = latestCount / entry.sections.length;
    if (ratio < 0.2 || ratio > 0.4) {
      errors.push(`最新模块占比为 ${ratio.toFixed(2)}，应保持在 20%–40%`);
    }
    if (Math.abs(ratio - entry.freshRatio) > 0.08) {
      errors.push(`freshRatio ${entry.freshRatio} 与实际最新模块占比 ${ratio.toFixed(2)} 不一致`);
    }
    const coreModules = new Set(topics.modules.filter((module) => module.core).map((module) => module.id));
    const includedCore = entry.sections.filter((section) => coreModules.has(section.module)).length;
    if (includedCore < 2) errors.push("每天至少需要覆盖两个正式核心模块");
    if (isDateString(entry.date)) {
      const expectedModules = rotationForDate(entry.date, topics);
      const missing = expectedModules.filter((id) => !includedModules.has(id));
      const unexpected = [...includedModules].filter((id) => !expectedModules.includes(id));
      if (missing.length || unexpected.length) {
        errors.push(`模块必须匹配当天轮换；缺少 ${missing.join(", ") || "无"}；多出 ${unexpected.join(", ") || "无"}`);
      }
    }
  }
  if (!entry.practice || typeof entry.practice.title !== "string" || typeof entry.practice.prompt !== "string" || !Array.isArray(entry.practice.steps) || entry.practice.steps.length < 2) {
    errors.push("practice 需要题目、提示和至少两个步骤");
  }
  if (!Number.isInteger(entry.practice?.estimatedMinutes) || entry.practice.estimatedMinutes < 3 || entry.practice.estimatedMinutes > 10) {
    errors.push("practice.estimatedMinutes 必须为 3–10 的整数");
  }
  if (Array.isArray(entry.sections) && entry.practice && Number.isInteger(entry.practice.estimatedMinutes)) {
    const calculatedMinutes = entry.sections.reduce((total, section) => total + (Number.isInteger(section.estimatedMinutes) ? section.estimatedMinutes : 0), 0) + entry.practice.estimatedMinutes;
    if (Math.abs(calculatedMinutes - entry.estimatedMinutes) > 5) {
      errors.push(`estimatedMinutes ${entry.estimatedMinutes} 与各模块合计 ${calculatedMinutes} 相差超过 5 分钟`);
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

export function assertValidEntry(entry, topics, expectedDate) {
  const errors = validateEntry(entry, topics, expectedDate);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
}
