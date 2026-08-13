import path from "node:path";
import {
  DAILY_DIR,
  flattenTrack,
  isDateString,
  readCurriculum,
  readDailyEntries,
  readStarterLessons,
  readTopics,
  validateCurriculum,
  validateEntry,
  validateStandaloneLesson
} from "./lib.mjs";

const [topics, curriculum, starterBundle, entriesDescending] = await Promise.all([
  readTopics(),
  readCurriculum(),
  readStarterLessons(),
  readDailyEntries()
]);

const moduleIds = new Set(topics.modules.map((module) => module.id));
const scheduledModules = [];
const configFailures = [];
if (moduleIds.size !== topics.modules.length) configFailures.push("主题 ID 不能重复");
if (topics.curriculumStartDate !== curriculum.startDate) configFailures.push("主题安排与课程目录的起始日期必须一致");
if (!Array.isArray(topics.learningDomains) || topics.learningDomains.length < 2) {
  configFailures.push("learningDomains 必须包含至少 2 个能力域");
} else {
  const domainIds = new Set();
  const groupedModules = [];
  for (const [index, domain] of topics.learningDomains.entries()) {
    const label = `learningDomains[${index}]`;
    if (!domain?.id || !domain?.title || !domain?.description) configFailures.push(`${label} 缺少 id、title 或 description`);
    if (domainIds.has(domain?.id)) configFailures.push(`${label}.id 重复：${domain?.id}`);
    domainIds.add(domain?.id);
    if (!Array.isArray(domain?.modules) || domain.modules.length < 1) configFailures.push(`${label}.modules 至少需要一个主题`);
    else groupedModules.push(...domain.modules);
  }
  const groupedCounts = new Map([...moduleIds].map((id) => [id, groupedModules.filter((item) => item === id).length]));
  const missingFromDomains = [...groupedCounts].filter(([, count]) => count === 0).map(([id]) => id);
  const repeatedInDomains = [...groupedCounts].filter(([, count]) => count > 1).map(([id]) => id);
  const unknownInDomains = groupedModules.filter((id) => !moduleIds.has(id));
  if (missingFromDomains.length) configFailures.push(`以下主题没有进入能力域：${missingFromDomains.join(", ")}`);
  if (repeatedInDomains.length) configFailures.push(`以下主题在能力域中重复：${repeatedInDomains.join(", ")}`);
  if (unknownInDomains.length) configFailures.push(`能力域包含未知主题：${[...new Set(unknownInDomains)].join(", ")}`);
}
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

const starterFailures = [];
const starterKeys = Object.keys(starterBundle ?? {});
const allowedStarterKeys = new Set(["schemaVersion", "publishedAt", "lessons"]);
const unexpectedStarterKeys = starterKeys.filter((key) => !allowedStarterKeys.has(key));
if (unexpectedStarterKeys.length) {
  starterFailures.push(`起步课数据包含不允许的字段：${unexpectedStarterKeys.join(", ")}`);
}
if (starterBundle?.schemaVersion !== 1) starterFailures.push("起步课 schemaVersion 必须为 1");
if (!isDateString(starterBundle?.publishedAt)) starterFailures.push("起步课 publishedAt 必须是有效的 YYYY-MM-DD");

const starterLessons = Array.isArray(starterBundle?.lessons) ? starterBundle.lessons : [];
if (!Array.isArray(starterBundle?.lessons)) {
  starterFailures.push("起步课 lessons 必须是数组");
} else if (starterLessons.length !== topics.modules.length || starterLessons.length !== 13) {
  starterFailures.push(`起步课必须恰好包含 13 节，并与 13 个主题一一对应；当前为 ${starterLessons.length} 节`);
}

const starterModuleCounts = new Map();
for (const lesson of starterLessons) {
  starterModuleCounts.set(lesson?.module, (starterModuleCounts.get(lesson?.module) ?? 0) + 1);
}
const missingStarterModules = topics.modules
  .map((module) => module.id)
  .filter((module) => !starterModuleCounts.has(module));
const repeatedStarterModules = [...starterModuleCounts]
  .filter(([, count]) => count > 1)
  .map(([module]) => module);
const unknownStarterModules = [...starterModuleCounts.keys()]
  .filter((module) => !moduleIds.has(module));
if (missingStarterModules.length) starterFailures.push(`以下主题缺少起步课：${missingStarterModules.join(", ")}`);
if (repeatedStarterModules.length) starterFailures.push(`以下主题存在重复起步课：${repeatedStarterModules.join(", ")}`);
if (unknownStarterModules.length) starterFailures.push(`起步课包含未知主题：${unknownStarterModules.join(", ")}`);

const trackMap = new Map(curriculum.tracks.map((track) => [track.module, track]));
starterLessons.forEach((lesson, index) => {
  const label = `lessons[${index}]`;
  const track = trackMap.get(lesson?.module);
  if (!track) return;
  const firstUnit = flattenTrack(track)[0];
  if (!firstUnit) {
    starterFailures.push(`${label} 对应课程没有第一单元`);
    return;
  }
  starterFailures.push(...validateStandaloneLesson(lesson, label, topics, {
    module: track.module,
    unit: firstUnit,
    cycle: 1
  }));
});

if (starterFailures.length) {
  throw new Error(`起步课校验失败：\n${starterFailures.map((failure) => `- ${failure}`).join("\n")}`);
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
console.log(`✓ 已校验 ${curriculum.tracks.length} 条课程路径、${totalUnits} 个单元、${starterLessons.length} 节独立起步课与 ${entries.length} 期每日学习内容`);
