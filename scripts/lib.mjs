import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DAILY_DIR = path.join(ROOT, "content", "daily");

// A single default config also lets direct validator callers enforce role labels.
// No historical archive is modified or assigned a retrospective identity.
export const DEFAULT_IDENTITIES = JSON.parse(readFileSync(path.join(ROOT, "config", "identities.json"), "utf8"));

export async function readIdentities() {
  return readJson(path.join(ROOT, "config", "identities.json"));
}

export function identityForLesson(date, module, topics, config = DEFAULT_IDENTITIES) {
  if (!isDateString(date) || !isDateString(config?.effectiveDate)) throw new Error("身份计划日期必须是有效的 YYYY-MM-DD");
  if (date < config.effectiveDate) return null;
  const assignment = config.moduleAssignments.find((item) => item.module === module);
  if (!assignment) throw new Error(`身份配置缺少主题：${module}`);
  if (!scheduleForDate(date, topics).includes(module)) throw new Error(`主题 ${module} 不在 ${date} 的固定课程计划中`);
  if (assignment.mode === "fixed") {
    if (!Array.isArray(assignment.identities) || assignment.identities.length !== 1 ||
        assignment.identities[0] !== assignment.firstIdentity || !["personal", "work"].includes(assignment.firstIdentity)) {
      throw new Error(`主题 ${module} 的固定身份配置无效`);
    }
    return assignment.firstIdentity;
  }
  if (assignment.mode !== "rotate" || !Array.isArray(assignment.identities) || assignment.identities.length !== 2 || new Set(assignment.identities).size !== 2 || assignment.identities.some((id) => !["personal", "work"].includes(id)) || !assignment.identities.includes(assignment.firstIdentity)) {
    throw new Error(`主题 ${module} 的身份轮换配置无效`);
  }
  // Count calendar occurrences, not published lessons: skipping a publication or
  // requesting the same date again cannot silently change that date's identity.
  const period = topics.dailySchedule.length;
  const effectiveScheduleIndex = ((dayOffset(config.effectiveDate, topics.curriculumStartDate) % period) + period) % period;
  const moduleScheduleIndex = topics.dailySchedule.findIndex((items) => items.includes(module));
  if (moduleScheduleIndex < 0) throw new Error(`主题 ${module} 不在固定课程安排中`);
  const firstOffset = (moduleScheduleIndex - effectiveScheduleIndex + period) % period;
  const occurrence = Math.floor((dayOffset(date, config.effectiveDate) - firstOffset) / period);
  const start = assignment.identities.indexOf(assignment.firstIdentity);
  return assignment.identities[(start + occurrence) % assignment.identities.length];
}


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

export async function readStarterLessons() {
  return readJson(path.join(ROOT, "content", "starter-lessons.json"));
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

function characterCount(value) {
  return typeof value === "string" ? [...value.trim()].length : 0;
}

function validateBoundedText(value, label, minimum, maximum, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} 必须是文本`);
    return;
  }
  const length = characterCount(value);
  if (length < minimum || length > maximum) {
    errors.push(`${label} 必须为 ${minimum}–${maximum} 个字符，当前为 ${length}`);
  }
}

function validateAllowedKeys(value, label, allowedKeys, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) errors.push(`${label} 包含当前版本不允许的字段：${unexpected.join(", ")}`);
}

export function lessonVisibleCharacters(lesson) {
  const texts = [
    lesson?.coreQuestion,
    lesson?.framework?.name,
    lesson?.framework?.definition,
    ...(lesson?.framework?.steps ?? []).flatMap((step) => [step?.title, step?.text]),
    lesson?.framework?.boundary,
    ...(lesson?.keyPoints ?? []).flatMap((point) => [point?.title, point?.text]),
    lesson?.caseStudy?.title,
    lesson?.caseStudy?.context,
    lesson?.caseStudy?.analysis,
    lesson?.caseStudy?.lesson,
    lesson?.exercise?.prompt,
    ...(lesson?.exercise?.steps ?? []),
    lesson?.exercise?.deliverable,
    lesson?.conclusion
  ];
  return texts.reduce((total, text) => total + characterCount(text), 0);
}

function radarVisibleCharacters(item) {
  return [item?.title, item?.whatChanged, item?.whyItMatters, item?.watchNext]
    .reduce((total, text) => total + characterCount(text), 0);
}

function normalizedForDuplicateCheck(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[\s，。；：！？、,.!?:;“”‘’"'（）()《》]/gu, "")
    : "";
}

function validateLabeledPoint(point, label, errors) {
  if (!point || typeof point !== "object" || Array.isArray(point)) {
    errors.push(`${label} 必须是对象`);
    return;
  }
  validateAllowedKeys(point, label, ["title", "text"], errors);
  validateBoundedText(point.title, `${label}.title`, 2, 12, errors);
  validateBoundedText(point.text, `${label}.text`, 16, 50, errors);
}

function validateSource(source, label, errors) {
  validateAllowedKeys(source, label, ["title", "url", "publisher", "publishedAt"], errors);
  if (!validText(source?.title) || !validText(source?.publisher) || !isHttpUrl(source?.url)) {
    errors.push(`${label} 缺少标题、发布方或有效网址`);
  }
  if (typeof source?.publishedAt !== "string") errors.push(`${label}.publishedAt 必须是文本`);
}

export function validateStandaloneLesson(lesson, label, topics, expectedUnit) {
  const errors = [];
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
    return [`${label} 必须是对象`];
  }

  validateAllowedKeys(lesson, label, [
    "id", "module", "learningIdentity", "curriculum", "estimatedMinutes", "coreQuestion", "framework",
    "keyPoints", "caseStudy", "exercise", "conclusion", "sources"
  ], errors);
  if (!/^[a-z0-9-]+$/.test(lesson.id ?? "")) errors.push(`${label}.id 格式无效`);
  const knownModules = new Set((topics?.modules ?? []).map((module) => module.id));
  if (!knownModules.has(lesson.module)) errors.push(`${label}.module 未在主题配置中`);

  if (lesson.learningIdentity !== undefined && !["personal", "work"].includes(lesson.learningIdentity)) {
    errors.push(`${label}.learningIdentity 必须为 personal 或 work`);
  }
  if (expectedUnit?.learningIdentity && lesson.learningIdentity !== expectedUnit.learningIdentity) {
    errors.push(`${label}.learningIdentity 必须为当天身份计划 ${expectedUnit.learningIdentity}`);
  }

  const expectedModule = expectedUnit?.module;
  const unit = expectedUnit?.unit ?? expectedUnit;
  if (expectedModule && lesson.module !== expectedModule) {
    errors.push(`${label}.module 必须为 ${expectedModule}`);
  }

  const meta = lesson.curriculum;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    errors.push(`${label}.curriculum 必须是对象`);
  } else {
    validateAllowedKeys(meta, `${label}.curriculum`, [
      "stageId", "stageTitle", "unitId", "unitTitle", "objective", "scope",
      "sequence", "totalUnits", "cycle"
    ], errors);
    validateBoundedText(meta.stageId, `${label}.curriculum.stageId`, 2, 72, errors);
    validateBoundedText(meta.stageTitle, `${label}.curriculum.stageTitle`, 2, 60, errors);
    validateBoundedText(meta.unitId, `${label}.curriculum.unitId`, 4, 120, errors);
    validateBoundedText(meta.unitTitle, `${label}.curriculum.unitTitle`, 4, 80, errors);
    validateBoundedText(meta.objective, `${label}.curriculum.objective`, 16, 200, errors);
    validateBoundedText(meta.scope, `${label}.curriculum.scope`, 24, 360, errors);
    if (!Number.isInteger(meta.sequence) || meta.sequence < 1 || meta.sequence > 80) {
      errors.push(`${label}.curriculum.sequence 必须为 1–80 的整数`);
    }
    if (!Number.isInteger(meta.totalUnits) || meta.totalUnits < 1 || meta.totalUnits > 80) {
      errors.push(`${label}.curriculum.totalUnits 必须为 1–80 的整数`);
    }
    if (Number.isInteger(meta.sequence) && Number.isInteger(meta.totalUnits) && meta.sequence > meta.totalUnits) {
      errors.push(`${label}.curriculum.sequence 不能大于 totalUnits`);
    }
    if (!Number.isInteger(meta.cycle) || meta.cycle < 1 || meta.cycle > 20) {
      errors.push(`${label}.curriculum.cycle 必须为 1–20 的整数`);
    }

    if (unit) {
      const expectedMeta = {
        stageId: unit.stageId,
        stageTitle: unit.stageTitle,
        unitId: unit.id,
        unitTitle: unit.title,
        objective: unit.objective,
        scope: unit.scope,
        sequence: unit.sequence,
        totalUnits: unit.totalUnits,
        cycle: expectedUnit?.cycle
      };
      for (const [key, value] of Object.entries(expectedMeta)) {
        if (value !== undefined && meta[key] !== value) {
          errors.push(`${label}.curriculum.${key} 必须为 ${value}`);
        }
      }
    }
  }

  if (!Number.isInteger(lesson.estimatedMinutes) || lesson.estimatedMinutes < 14 || lesson.estimatedMinutes > 26) {
    errors.push(`${label}.estimatedMinutes 必须为 14–26 的整数`);
  }
  validateBoundedText(lesson.coreQuestion, `${label}.coreQuestion`, 12, 48, errors);
  if (typeof lesson.coreQuestion === "string" && !/[？?]$/u.test(lesson.coreQuestion.trim())) {
    errors.push(`${label}.coreQuestion 必须以问号结尾`);
  }

  const framework = lesson.framework;
  if (!framework || typeof framework !== "object" || Array.isArray(framework)) {
    errors.push(`${label}.framework 必须是对象`);
  } else {
    validateAllowedKeys(framework, `${label}.framework`, ["name", "definition", "steps", "boundary"], errors);
    validateBoundedText(framework.name, `${label}.framework.name`, 2, 18, errors);
    validateBoundedText(framework.definition, `${label}.framework.definition`, 20, 70, errors);
    validateBoundedText(framework.boundary, `${label}.framework.boundary`, 16, 56, errors);
    if (!Array.isArray(framework.steps) || framework.steps.length < 2 || framework.steps.length > 3) {
      errors.push(`${label}.framework.steps 必须包含 2–3 步`);
    } else {
      framework.steps.forEach((step, stepIndex) => validateLabeledPoint(step, `${label}.framework.steps[${stepIndex}]`, errors));
    }
  }

  if (!Array.isArray(lesson.keyPoints) || lesson.keyPoints.length !== 3) {
    errors.push(`${label}.keyPoints 必须包含恰好 3 个重点`);
  } else {
    lesson.keyPoints.forEach((point, pointIndex) => validateLabeledPoint(point, `${label}.keyPoints[${pointIndex}]`, errors));
    const pointTitles = lesson.keyPoints.map((point) => normalizedForDuplicateCheck(point?.title)).filter(Boolean);
    if (new Set(pointTitles).size !== pointTitles.length) errors.push(`${label}.keyPoints 的标题不能重复`);
  }

  const caseStudy = lesson.caseStudy;
  if (!caseStudy || typeof caseStudy !== "object" || Array.isArray(caseStudy)) {
    errors.push(`${label}.caseStudy 必须是对象`);
  } else {
    validateAllowedKeys(caseStudy, `${label}.caseStudy`, ["title", "context", "analysis", "lesson"], errors);
    validateBoundedText(caseStudy.title, `${label}.caseStudy.title`, 4, 28, errors);
    validateBoundedText(caseStudy.context, `${label}.caseStudy.context`, 20, 70, errors);
    validateBoundedText(caseStudy.analysis, `${label}.caseStudy.analysis`, 30, 100, errors);
    validateBoundedText(caseStudy.lesson, `${label}.caseStudy.lesson`, 12, 48, errors);
  }

  const exercise = lesson.exercise;
  if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) {
    errors.push(`${label}.exercise 必须是对象`);
  } else {
    validateAllowedKeys(exercise, `${label}.exercise`, ["prompt", "steps", "deliverable"], errors);
    validateBoundedText(exercise.prompt, `${label}.exercise.prompt`, 16, 60, errors);
    validateBoundedText(exercise.deliverable, `${label}.exercise.deliverable`, 8, 36, errors);
    if (!Array.isArray(exercise.steps) || exercise.steps.length < 2 || exercise.steps.length > 3) {
      errors.push(`${label}.exercise.steps 必须包含 2–3 步`);
    } else {
      exercise.steps.forEach((step, stepIndex) => validateBoundedText(step, `${label}.exercise.steps[${stepIndex}]`, 8, 40, errors));
    }
  }

  validateBoundedText(lesson.conclusion, `${label}.conclusion`, 10, 48, errors);
  if (typeof lesson.conclusion === "string" && (lesson.conclusion.match(/[。！？!?]/gu) ?? []).length > 1) {
    errors.push(`${label}.conclusion 只能包含一句话`);
  }

  const repeatedCandidates = [
    framework?.definition,
    ...(lesson.keyPoints ?? []).map((point) => point?.text),
    caseStudy?.lesson,
    lesson.conclusion
  ].map(normalizedForDuplicateCheck).filter((text) => text.length >= 8);
  if (new Set(repeatedCandidates).size !== repeatedCandidates.length) {
    errors.push(`${label} 的框架、重点、案例结论与一句话结论不能逐字重复`);
  }

  const visibleCharacters = lessonVisibleCharacters(lesson);
  if (visibleCharacters < 350 || visibleCharacters > 750) {
    errors.push(`${label} 的可见文字必须为 350–750 个字符，当前为 ${visibleCharacters}`);
  }

  if (!Array.isArray(lesson.sources)) {
    errors.push(`${label}.sources 必须是数组`);
  } else {
    if (lesson.sources.length > 5) errors.push(`${label}.sources 最多包含 5 个来源`);
    lesson.sources.forEach((source, sourceIndex) => validateSource(source, `${label}.sources[${sourceIndex}]`, errors));
  }
  return errors;
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

export function validateEntry(entry, topics, expectedDate, curriculum, priorEntries = [], identityConfig = DEFAULT_IDENTITIES) {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["内容必须是一个 JSON 对象"];
  validateAllowedKeys(entry, "entry", [
    "schemaVersion", "date", "title", "subtitle", "estimatedMinutes",
    "introduction", "lessons", "radar"
  ], errors);
  if (entry.schemaVersion !== 4) errors.push("schemaVersion 必须为 4");
  if (!isDateString(entry.date)) errors.push("date 必须是有效的 YYYY-MM-DD");
  if (expectedDate && entry.date !== expectedDate) errors.push(`文件日期 ${expectedDate} 与内容日期 ${entry.date} 不一致`);
  validateBoundedText(entry.title, "title", 4, 40, errors);
  validateBoundedText(entry.subtitle, "subtitle", 8, 100, errors);
  if (!Number.isInteger(entry.estimatedMinutes) || entry.estimatedMinutes < 20 || entry.estimatedMinutes > 40) {
    errors.push("estimatedMinutes 必须为 20–40 的整数");
  }
  if (!Array.isArray(entry.introduction) || entry.introduction.length !== 1) {
    errors.push("introduction 必须包含恰好一段导语");
  } else {
    validateBoundedText(entry.introduction[0], "introduction[0]", 20, 160, errors);
  }

  const knownModules = new Set(topics.modules.map((module) => module.id));
  let plan = [];
  if (curriculum && isDateString(entry.date)) {
    try {
      plan = curriculumPlanForDate(entry.date, topics, curriculum, priorEntries).map((item) => ({
        ...item,
        learningIdentity: identityForLesson(entry.date, item.module, topics, identityConfig)
      }));
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
      errors.push(...validateStandaloneLesson(lesson, label, topics, plan[index]));
      if (lesson && typeof lesson === "object" && !Array.isArray(lesson)) {
        if (ids.has(lesson.id)) errors.push(`${label}.id 重复：${lesson.id}`);
        ids.add(lesson.id);
      }
    });
  }

  if (!Array.isArray(entry.radar) || entry.radar.length !== 1) {
    errors.push("radar 必须包含恰好 1 条独立前沿更新");
  } else {
    entry.radar.forEach((item, index) => {
      const label = `radar[${index}]`;
      validateAllowedKeys(item, label, [
        "id", "module", "title", "estimatedMinutes", "whatChanged", "whyItMatters",
        "watchNext", "sources"
      ], errors);
      if (!/^[a-z0-9-]+$/.test(item?.id ?? "")) errors.push(`${label}.id 格式无效`);
      if (!knownModules.has(item?.module)) errors.push(`${label}.module 未在主题配置中`);
      validateBoundedText(item?.title, `${label}.title`, 8, 48, errors);
      validateBoundedText(item?.whatChanged, `${label}.whatChanged`, 30, 140, errors);
      validateBoundedText(item?.whyItMatters, `${label}.whyItMatters`, 20, 80, errors);
      validateBoundedText(item?.watchNext, `${label}.watchNext`, 16, 70, errors);
      if (!Number.isInteger(item?.estimatedMinutes) || item.estimatedMinutes < 3 || item.estimatedMinutes > 5) {
        errors.push(`${label}.estimatedMinutes 必须为 3–5 的整数`);
      }
      const radarCharacters = radarVisibleCharacters(item);
      if (radarCharacters > 280) errors.push(`${label} 的可见文字不能超过 280 个字符，当前为 ${radarCharacters}`);
      if (!Array.isArray(item?.sources) || item.sources.length < 1) errors.push(`${label}.sources 至少需要一个可核验来源`);
      else {
        if (item.sources.length > 5) errors.push(`${label}.sources 最多包含 5 个来源`);
        item.sources.forEach((source, sourceIndex) => validateSource(source, `${label}.sources[${sourceIndex}]`, errors));
      }
    });
  }

  if (Array.isArray(entry.lessons) && Array.isArray(entry.radar)) {
    const expectedRange = entry.lessons.length === 1 ? [20, 30] : [30, 40];
    if (Number.isInteger(entry.estimatedMinutes) && (entry.estimatedMinutes < expectedRange[0] || entry.estimatedMinutes > expectedRange[1])) {
      errors.push(`包含 ${entry.lessons.length} 节课程时，estimatedMinutes 必须为 ${expectedRange[0]}–${expectedRange[1]} 分钟`);
    }
    if (isDateString(entry.date) && entry.date >= identityConfig.effectiveDate) {
      const plannedLessonMinutes = entry.lessons.length === 1 ? 26 : 16;
      const plannedTotal = entry.lessons.length === 1 ? 30 : 36;
      if (entry.estimatedMinutes !== plannedTotal) errors.push(`身份课程全期 estimatedMinutes 必须为 ${plannedTotal}`);
      entry.lessons.forEach((lesson, index) => {
        if (lesson?.estimatedMinutes !== plannedLessonMinutes) errors.push(`lessons[${index}].estimatedMinutes 必须为 ${plannedLessonMinutes}`);
      });
      if (entry.radar[0]?.estimatedMinutes !== 4) errors.push("radar[0].estimatedMinutes 必须为 4");
    }
    const calculatedMinutes = [...entry.lessons, ...entry.radar]
      .reduce((total, item) => total + (Number.isInteger(item?.estimatedMinutes) ? item.estimatedMinutes : 0), 0);
    if (calculatedMinutes !== entry.estimatedMinutes) {
      errors.push(`estimatedMinutes ${entry.estimatedMinutes} 必须等于课程与雷达合计 ${calculatedMinutes}`);
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

export function assertValidEntry(entry, topics, expectedDate, curriculum, priorEntries = [], identityConfig = DEFAULT_IDENTITIES) {
  const errors = validateEntry(entry, topics, expectedDate, curriculum, priorEntries, identityConfig);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
}
