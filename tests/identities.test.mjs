import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  curriculumPlanForDate, flattenTrack, readCurriculum, readDailyEntries,
  readStarterLessons, readTopics, scheduleForDate, validateEntry, validateStandaloneLesson
} from "../scripts/lib.mjs";
import {
  identityContext, identityForLesson, identityPlanForDate, identityProgress,
  readIdentities, validateIdentities
} from "../scripts/identities.mjs";
import { DAILY_SCHEMA, dailySchemaForDate } from "../scripts/content-schema.mjs";

const [config, topics, curriculum, archives, starters] = await Promise.all([
  readIdentities(), readTopics(), readCurriculum(), readDailyEntries(), readStarterLessons()
]);
const root = new URL("../", import.meta.url);
const clone = (value) => structuredClone(value);
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Content stays valid while metadata follows the exact planned node. These
// synthetic entries are never saved and are not claimed as new publications.
function plannedEntry(date, prior = archives) {
  const entry = clone(archives[0]);
  entry.date = date;
  const plan = identityPlanForDate(date, topics, curriculum, prior, config);
  const minutes = plan.length === 1 ? 26 : 16;
  entry.estimatedMinutes = minutes * plan.length + 4;
  entry.radar[0].estimatedMinutes = 4;
  entry.lessons = plan.map((expected) => {
    const lesson = clone(starters.lessons.find((item) => item.module === expected.module));
    lesson.learningIdentity = expected.learningIdentity;
    lesson.estimatedMinutes = minutes;
    lesson.curriculum = {
      stageId: expected.unit.stageId, stageTitle: expected.unit.stageTitle,
      unitId: expected.unit.id, unitTitle: expected.unit.title,
      objective: expected.unit.objective, scope: expected.unit.scope,
      sequence: expected.unit.sequence, totalUnits: expected.unit.totalUnits, cycle: expected.cycle
    };
    return lesson;
  });
  return entry;
}

test("身份配置完整覆盖原有 13 主题、344 单元，入口与应用场景独立", () => {
  assert.deepEqual(validateIdentities(config, topics, curriculum), []);
  assert.equal(config.effectiveDate, "2026-10-04");
  assert.deepEqual(config.identities.map(({ id, path, title }) => ({ id, path, title })), [
    { id: "personal", path: "personal", title: "个人发展" },
    { id: "work", path: "career", title: "职场增长" }
  ]);
  assert.equal(curriculum.tracks.length, 13);
  assert.equal(curriculum.tracks.flatMap(flattenTrack).length, 344);
  assert.equal(config.moduleAssignments.length, 13);
  assert.equal(config.identities[0].primaryModules.length + config.identities[0].foundationModules.length, 11);
  assert.equal(config.identities[1].primaryModules.length + config.identities[1].foundationModules.length, 12);
  const p = identityContext("personal", "finance_macro", config);
  const w = identityContext("work", "finance_macro", config);
  assert.equal(p.moduleKind, "primary");
  assert.equal(w.moduleKind, "foundation");
  for (const key of ["caseContext", "exercise", "deliverable"]) assert.notEqual(p[key], w[key]);
  assert.match(JSON.stringify(config.identities[0]), /Amazon/);
  assert.match(JSON.stringify(config.identities[0]), /礼品包装/);
  assert.match(JSON.stringify(config.identities[0]), /投资工具/);
  assert.match(JSON.stringify(config.identities[1]), /CRO/);
  assert.match(JSON.stringify(config.identities[1]), /CRM/);
  assert.match(JSON.stringify(config.identities[1]), /增量/);
  assert.throws(() => identityContext("personal", "advertising_frontier", config), /未包含/);
  assert.throws(() => identityContext("invented", "finance_macro", config), /未包含/);
});

test("非法身份、重复遗漏和伪造课程映射均被拒绝", () => {
  const mutations = [
    (c) => { c.schemaVersion = 2; },
    (c) => { c.effectiveDate = "2026-02-30"; },
    (c) => { c.effectiveDate = "2020-01-01"; },
    (c) => { c.identities.pop(); },
    (c) => { c.identities[1].id = "personal"; },
    (c) => { c.identities[0].path = "career"; },
    (c) => { c.identities[0].primaryModules.push("made_up_course"); },
    (c) => { c.identities[0].foundationModules.push("finance_macro"); },
    (c) => { c.identities[0].primaryModules = null; },
    (c) => { c.identities[0].focusAreas[0].modules.push("management_organization"); },
    (c) => { c.identities[0].focusAreas[0].practice = ""; },
    (c) => { delete c.identities[0].contexts.finance_macro; },
    (c) => { c.identities[0].contexts.finance_macro.exercise = ""; },
    (c) => { c.identities[0].contexts.made_up_course = c.identities[0].contexts.finance_macro; },
    (c) => { c.moduleAssignments.pop(); },
    (c) => { c.moduleAssignments.push(clone(c.moduleAssignments[0])); },
    (c) => { c.moduleAssignments[0].module = "made_up_course"; },
    (c) => { c.moduleAssignments[0].mode = "automatic"; },
    (c) => { c.moduleAssignments[0].identities = ["unknown"]; },
    (c) => { c.moduleAssignments[0].firstIdentity = "personal"; },
    (c) => { c.moduleAssignments[0].identities = ["personal", "work"]; },
    (c) => { c.moduleAssignments[1].identities = ["personal", "personal"]; },
    (c) => { c.moduleAssignments[1].identities = ["personal"]; },
    (c) => { c.moduleAssignments[1] = null; }
  ];
  for (const [index, mutate] of mutations.entries()) {
    const bad = clone(config);
    mutate(bad);
    assert.ok(validateIdentities(bad, topics, curriculum).length, `mutation ${index} accepted`);
  }
  assert.ok(validateIdentities(null, topics, curriculum).length);
});

test("生效日身份由日期决定，共享主题轮换且每两周保持 12/14 的总量", () => {
  assert.equal(identityForLesson("2026-10-03", "consumer_psychology", topics, config), null);
  const counts = { personal: 0, work: 0 };
  const occurrences = new Map();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addDays(config.effectiveDate, offset);
    const plan = identityPlanForDate(date, topics, curriculum, archives, config);
    assert.deepEqual(plan.map((item) => item.module), scheduleForDate(date, topics));
    assert.ok(plan.length >= 1 && plan.length <= 2);
    for (const item of plan) {
      counts[item.learningIdentity] += 1;
      const list = occurrences.get(item.module) ?? [];
      list.push(item.learningIdentity);
      occurrences.set(item.module, list);
      assert.equal(item.identityContext.id, item.learningIdentity);
      assert.ok(item.identityContext.exercise);
    }
  }
  assert.deepEqual(counts, { personal: 12, work: 14 });
  for (const assignment of config.moduleAssignments) {
    const ids = occurrences.get(assignment.module);
    assert.equal(ids.length, 2);
    if (assignment.mode === "rotate") assert.notEqual(ids[0], ids[1]);
    else assert.deepEqual(ids, [assignment.firstIdentity, assignment.firstIdentity]);
  }
  assert.equal(identityForLesson("2026-10-04", "advertising_frontier", topics, config), "work");
  assert.equal(identityForLesson("2026-10-04", "data_analysis", topics, config), "personal");
  assert.equal(identityForLesson("2026-10-11", "data_analysis", topics, config), "work");
  assert.throws(() => identityForLesson("2026-10-04", "unknown", topics, config), /缺少/);
  assert.throws(() => identityForLesson("2026-10-04", "finance_macro", topics, config), /不在/);
  assert.throws(() => identityForLesson("2026-02-30", "finance_macro", topics, config), /有效/);
  const badFixed = clone(config);
  badFixed.moduleAssignments[0].firstIdentity = "personal";
  assert.throws(() => identityForLesson("2026-10-04", "advertising_frontier", topics, badFixed), /配置无效/);
});

test("共享课程顺序不按身份重置，漏更不会重排身份，也不修改输入", () => {
  const before = JSON.stringify({ curriculum, archives, config });
  const first = plannedEntry("2026-10-04");
  const prior = [...archives, first];
  const shared = curriculumPlanForDate("2026-10-11", topics, curriculum, prior);
  const rolePlan = identityPlanForDate("2026-10-11", topics, curriculum, prior, config);
  for (const [index, item] of rolePlan.entries()) {
    assert.equal(item.unit.id, shared[index].unit.id);
    assert.equal(item.cycle, shared[index].cycle);
    assert.equal(item.unit.sequence, 2);
  }
  const withoutPublication = identityPlanForDate("2026-10-11", topics, curriculum, archives, config);
  assert.deepEqual(rolePlan.map((item) => item.learningIdentity), withoutPublication.map((item) => item.learningIdentity));
  assert.equal(withoutPublication[0].unit.sequence, 1);
  assert.deepEqual(rolePlan, identityPlanForDate("2026-10-11", topics, curriculum, [...prior].reverse(), config));
  assert.equal(JSON.stringify({ curriculum, archives, config }), before);
});

test("未来双课与单课均可验证，标签缺失、错配和旧时长均拒绝", () => {
  for (const date of ["2026-10-04", "2026-10-09", "2026-10-11"]) {
    const entry = plannedEntry(date);
    assert.deepEqual(validateEntry(entry, topics, date, curriculum, archives, config), []);
    const missing = clone(entry);
    delete missing.lessons[0].learningIdentity;
    assert.match(validateEntry(missing, topics, date, curriculum, archives, config).join("\n"), /learningIdentity/);
    const wrong = clone(entry);
    wrong.lessons[0].learningIdentity = entry.lessons[0].learningIdentity === "work" ? "personal" : "work";
    assert.match(validateEntry(wrong, topics, date, curriculum, archives, config).join("\n"), /当天身份计划/);
    const unknown = clone(entry);
    unknown.lessons[0].learningIdentity = "both";
    assert.match(validateEntry(unknown, topics, date, curriculum, archives, config).join("\n"), /personal 或 work/);
  }
  const single = plannedEntry("2026-10-09");
  assert.equal(single.lessons.length, 1);
  assert.equal(single.estimatedMinutes, 30);
  single.lessons[0].estimatedMinutes = 24;
  single.estimatedMinutes = 28;
  assert.match(validateEntry(single, topics, single.date, curriculum, archives, config).join("\n"), /必须为 30|必须为 26/);
  const double = plannedEntry("2026-10-04");
  double.radar[0].estimatedMinutes = 5;
  double.estimatedMinutes = 37;
  assert.match(validateEntry(double, topics, double.date, curriculum, archives, config).join("\n"), /必须为 36|必须为 4/);
  const wrongUnit = plannedEntry("2026-10-11", [...archives, plannedEntry("2026-10-04")]);
  wrongUnit.lessons[1].curriculum.sequence = 1;
  assert.match(validateEntry(wrongUnit, topics, wrongUnit.date, curriculum, [...archives, plannedEntry("2026-10-04")], config).join("\n"), /sequence 必须为 2/);
});

test("身份进度只数真实标签，不以映射、起步课或旧档推断进度", () => {
  const initial = identityProgress(archives, config);
  assert.equal(initial.legacyLessons, archives.flatMap((entry) => entry.lessons).length);
  assert.deepEqual(initial.identities.map((role) => role.publishedLessons), [0, 0]);
  assert.ok(initial.identities.every((role) => role.latestDate === null));
  const first = plannedEntry("2026-10-04");
  const second = plannedEntry("2026-10-11", [...archives, first]);
  const untagged = plannedEntry("2026-10-18", [...archives, first, second]);
  for (const lesson of untagged.lessons) delete lesson.learningIdentity;
  const forgedLegacy = clone(archives[0]);
  for (const lesson of forgedLegacy.lessons) lesson.learningIdentity = "personal";
  const alien = { date: "2026-10-19", lessons: [
    { module: "unknown", learningIdentity: "personal" },
    { module: "finance_macro", learningIdentity: "unknown" },
    { module: "advertising_frontier", learningIdentity: "personal" }
  ] };
  const entries = [...archives.slice(1), forgedLegacy, first, second, untagged, alien];
  const progress = identityProgress(entries, config);
  assert.deepEqual(progress.identities.map((role) => role.publishedLessons), [1, 3]);
  assert.equal(progress.identities[0].latestDate, "2026-10-04");
  assert.equal(progress.identities[1].latestDate, "2026-10-11");
  for (const role of progress.identities) assert.equal(role.modules.reduce((sum, item) => sum + item.publishedLessons, 0), role.publishedLessons);
  assert.deepEqual(identityProgress(entries, config, "2026-10-04").identities.map((role) => role.publishedLessons), [1, 1]);
  assert.deepEqual(identityProgress(entries, config, "2026-10-03").identities.map((role) => role.publishedLessons), [0, 0]);
  assert.throws(() => identityProgress(entries, config, "bad-date"), /有效日期/);
});

test("Schema 保持旧档可读，并为新日期严格要求 learningIdentity", () => {
  assert.deepEqual(DAILY_SCHEMA.properties.lessons.items.properties.learningIdentity.enum, ["personal", "work"]);
  assert.equal(DAILY_SCHEMA.properties.lessons.items.required.includes("learningIdentity"), false);
  const before = dailySchemaForDate("2026-10-03", config);
  assert.equal("learningIdentity" in before.properties.lessons.items.properties, false);
  const after = dailySchemaForDate("2026-10-04", config);
  assert.ok(after.properties.lessons.items.required.includes("learningIdentity"));
  assert.equal(DAILY_SCHEMA.properties.lessons.items.required.includes("learningIdentity"), false);
  assert.throws(() => dailySchemaForDate("invalid", config), /有效/);
  const starter = clone(starters.lessons[0]);
  starter.learningIdentity = "unknown";
  assert.match(validateStandaloneLesson(starter, "starter", topics).join("\n"), /learningIdentity/);
});

test("归档与知识树通过校验并保持已审定版本（含 10-03 明确修订）", async () => {
  const expected = {
    "config/curriculum.json": "382ed34131fb619c5eb99bd7eb53fc06d31eefed4865cbe980682b509c515141",
    "content/daily/2026-08-08.json": "a9a13d491dd2bf2ff77f20a6c8c70827afe7b8757908a6d83f8509d8a1ecd913",
    "content/daily/2026-10-02.json": "c08c421280fbec89853e847557211d19e626d383580a70b2d3a40e3ebe4a46d9",
    "content/daily/2026-10-03.json": "7c73d3f77300a0a5ad9d07a65190015eb1e26f4705889edab08d78d472a65c6b",
    "content/starter-lessons.json": "23c8b660fbe5d80f0702aaa1e24bf531b5501a9a4688421f2383398dd8442439"
  };
  for (const [file, hash] of Object.entries(expected)) {
    assert.equal(createHash("sha256").update(await readFile(new URL(file, root))).digest("hex"), hash, `${file} changed`);
  }
  const prior = [];
  for (const entry of [...archives].sort((a, b) => a.date.localeCompare(b.date))) {
    assert.deepEqual(validateEntry(entry, topics, entry.date, curriculum, prior, config), []);
    if (entry.date < config.effectiveDate) assert.ok(entry.lessons.every((lesson) => !Object.hasOwn(lesson, "learningIdentity")));
    prior.push(entry);
  }
});

test("只读计划输出角色场景和 30/36 分钟，已有日期保持归档", () => {
  const run = (date) => JSON.parse(execFileSync(process.execPath, ["scripts/plan-daily.mjs", "--date", date], { cwd: root, encoding: "utf8" }));
  const old = run("2026-10-03");
  assert.equal(old.status, "already_archived");
  const next = run("2026-10-04");
  assert.equal(next.estimatedMinutes, 36);
  assert.equal(next.identityPlan.effectiveDate, config.effectiveDate);
  assert.deepEqual(next.lessons.map((lesson) => lesson.learningIdentity), ["work", "personal"]);
  assert.ok(next.lessons.every((lesson) => lesson.identityContext.caseContext && lesson.identityContext.exercise));
  const workLesson = next.lessons.find((lesson) => lesson.learningIdentity === "work");
  const personalLesson = next.lessons.find((lesson) => lesson.learningIdentity === "personal");
  assert.equal(workLesson.identityContext.learnerProfile.level, "资深从业者");
  assert.ok(workLesson.identityContext.learnerProfile.priorities.some((priority) => priority.includes("营销理论")));
  assert.ok(workLesson.identityContext.learnerProfile.editorialRules.some((rule) => rule.includes("第一性原理")));
  assert.equal(personalLesson.identityContext.learnerProfile, undefined);
  const single = run("2026-10-09");
  assert.equal(single.estimatedMinutes, 30);
  assert.equal(single.lessons[0].estimatedMinutes, 26);
  assert.equal(single.radar.estimatedMinutes, 4);
});
