import path from "node:path";
import { DAILY_DIR, readDailyEntries, readTopics, validateEntry } from "./lib.mjs";

const topics = await readTopics();
const entries = await readDailyEntries();

const moduleIds = new Set(topics.modules.map((module) => module.id));
const coreIds = new Set(topics.modules.filter((module) => module.core).map((module) => module.id));
const configuredInRotation = new Set();
const configFailures = [];

if (moduleIds.size !== topics.modules.length) configFailures.push("主题 ID 不能重复");
for (const [index, rotation] of topics.rotation.entries()) {
  const label = `rotation[${index}]`;
  if (!Array.isArray(rotation) || rotation.length !== 6) {
    configFailures.push(`${label} 必须包含恰好 6 个模块`);
    continue;
  }
  if (new Set(rotation).size !== rotation.length) configFailures.push(`${label} 不能重复模块`);
  const unknown = rotation.filter((id) => !moduleIds.has(id));
  if (unknown.length) configFailures.push(`${label} 包含未知模块：${unknown.join(", ")}`);
  if (rotation.filter((id) => coreIds.has(id)).length < 2) configFailures.push(`${label} 至少需要两个核心模块`);
  rotation.forEach((id) => configuredInRotation.add(id));
}
const uncovered = [...moduleIds].filter((id) => !configuredInRotation.has(id));
if (uncovered.length) configFailures.push(`以下主题没有进入轮换：${uncovered.join(", ")}`);
if (configFailures.length) {
  throw new Error(`主题配置校验失败：\n${configFailures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (entries.length === 0) {
  throw new Error(`${path.relative(process.cwd(), DAILY_DIR)} 中至少需要一篇每日学习内容`);
}

const seen = new Set();
const failures = [];
for (const entry of entries) {
  if (seen.has(entry.date)) failures.push(`${entry.date}: 日期重复`);
  seen.add(entry.date);
  const errors = validateEntry(entry, topics, entry.__fileDate);
  failures.push(...errors.map((error) => `${entry.date}: ${error}`));
}

if (failures.length) {
  throw new Error(`内容校验失败：\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

console.log(`✓ 已校验 ${entries.length} 期每日学习内容`);
