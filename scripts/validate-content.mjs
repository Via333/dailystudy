import path from "node:path";
import {
  DAILY_DIR,
  readCurriculum,
  readDailyEntries,
  readTopics,
  validateCurriculum,
  validateEntry
} from "./lib.mjs";

const [topics, curriculum, entriesDescending] = await Promise.all([
  readTopics(),
  readCurriculum(),
  readDailyEntries()
]);

const moduleIds = new Set(topics.modules.map((module) => module.id));
const scheduledModules = [];
const configFailures = [];
if (moduleIds.size !== topics.modules.length) configFailures.push("主题 ID 不能重复");
if (topics.curriculumStartDate !== curriculum.startDate) configFailures.push("主题安排与课程目录的起始日期必须一致");
if (!Array.isArray(topics.dailySchedule) || topics.dailySchedule.length !== 7) {
  configFailures.push("dailySchedule 必须包含 7 天");
} else {
  for (const [index, schedule] of topics.dailySchedule.entries()) {
    const label = `dailySchedule[${index}]`;
    if (!Array.isArray(schedule) || schedule.length < 1 || schedule.length > 2) {
      configFailures.push(`${label} 必须包含 1–2 个深度课程主题`);
      continue;
    }
    if (new Set(schedule).size !== schedule.length) configFailures.push(`${label} 不能重复主题`);
    const unknown = schedule.filter((id) => !moduleIds.has(id));
    if (unknown.length) configFailures.push(`${label} 包含未知主题：${unknown.join(", ")}`);
    scheduledModules.push(...schedule);
  }
}
const scheduleCounts = new Map([...moduleIds].map((id) => [id, scheduledModules.filter((item) => item === id).length]));
const missing = [...scheduleCounts].filter(([, count]) => count === 0).map(([id]) => id);
const repeated = [...scheduleCounts].filter(([, count]) => count > 1).map(([id]) => id);
if (missing.length) configFailures.push(`以下主题没有进入每周课程：${missing.join(", ")}`);
if (repeated.length) configFailures.push(`以下主题在每周课程中重复：${repeated.join(", ")}`);
if (scheduledModules.length !== topics.modules.length) configFailures.push("每周计划必须让 13 个主题各推进一次");
configFailures.push(...validateCurriculum(curriculum, topics));
if (configFailures.length) {
  throw new Error(`课程配置校验失败：\n${configFailures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (entriesDescending.length === 0) {
  throw new Error(`${path.relative(process.cwd(), DAILY_DIR)} 中至少需要一期每日学习内容`);
}

const entries = [...entriesDescending].sort((a, b) => a.date.localeCompare(b.date));
const seen = new Set();
const failures = [];
const priorEntries = [];
for (const entry of entries) {
  if (seen.has(entry.date)) failures.push(`${entry.date}: 日期重复`);
  seen.add(entry.date);
  const errors = validateEntry(entry, topics, entry.__fileDate, curriculum, priorEntries);
  failures.push(...errors.map((error) => `${entry.date}: ${error}`));
  priorEntries.push(entry);
}

if (failures.length) {
  throw new Error(`内容校验失败：\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

const totalUnits = curriculum.tracks.reduce(
  (total, track) => total + track.stages.reduce((stageTotal, stage) => stageTotal + stage.units.length, 0),
  0
);
console.log(`✓ 已校验 ${curriculum.tracks.length} 条课程路径、${totalUnits} 个单元与 ${entries.length} 期每日学习内容`);
