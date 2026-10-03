import { DEFAULT_IDENTITIES, curriculumPlanForDate, identityForLesson, isDateString } from "./lib.mjs";

export { DEFAULT_IDENTITIES, identityForLesson, readIdentities } from "./lib.mjs";

const IDS = ["personal", "work"];
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const roleModules = (role) => [...(role.primaryModules ?? []), ...(role.foundationModules ?? [])];

/** Validate the overlay without adding, replacing, or renumbering any unit. */
export function validateIdentities(config, topics, curriculum) {
  const errors = [];
  if (!isObject(config)) return ["身份配置必须是 JSON 对象"];
  if (config.schemaVersion !== 1) errors.push("身份配置 schemaVersion 必须为 1");
  if (!isDateString(config.effectiveDate)) errors.push("身份配置 effectiveDate 必须是有效日期");
  if (isDateString(config.effectiveDate) && config.effectiveDate < topics.curriculumStartDate) errors.push("身份生效日期不能早于课程起始日期");
  if (!Array.isArray(config.identities) || config.identities.length !== 2) return [...errors, "身份配置必须恰好包含 personal 和 work 两种身份"];
  const moduleIds = new Set((topics.modules ?? []).map((item) => item.id));
  const trackIds = new Set((curriculum?.tracks ?? []).map((item) => item.module));
  const seenIds = new Set();
  const rolesById = new Map();
  for (const [index, role] of config.identities.entries()) {
    const label = `identities[${index}]`;
    if (!isObject(role)) { errors.push(`${label} 必须是对象`); continue; }
    if (!IDS.includes(role.id) || seenIds.has(role.id)) errors.push(`${label}.id 必须是唯一的 personal 或 work`);
    seenIds.add(role.id);
    rolesById.set(role.id, role);
    const expectedPath = role.id === "personal" ? "personal" : "career";
    if (role.path !== expectedPath) errors.push(`${label}.path 必须为 ${expectedPath}`);
    for (const key of ["title", "description", "goal"]) if (!hasText(role[key])) errors.push(`${label}.${key} 必须是有效文本`);
    let membershipValid = true;
    for (const key of ["primaryModules", "foundationModules"]) {
      if (!Array.isArray(role[key]) || !role[key].length) { errors.push(`${label}.${key} 必须包含主题`); membershipValid = false; }
    }
    const members = membershipValid ? roleModules(role) : [];
    if (new Set(members).size !== members.length) errors.push(`${label} 的主线与基础主题不能重复或重叠`);
    for (const module of members) if (!moduleIds.has(module) || !trackIds.has(module)) errors.push(`${label} 包含未知或无课程的主题：${module}`);
    for (const key of ["caseGuidance", "practiceGuidance"]) {
      if (!Array.isArray(role[key]) || !role[key].length || role[key].some((value) => !hasText(value))) errors.push(`${label}.${key} 必须包含有效指引`);
    }
    if (!Array.isArray(role.focusAreas) || !role.focusAreas.length) errors.push(`${label}.focusAreas 必须包含学习方向`);
    else {
      const seenFocus = new Set();
      const coveredModules = new Set();
      for (const [focusIndex, focus] of role.focusAreas.entries()) {
        const focusLabel = `${label}.focusAreas[${focusIndex}]`;
        if (!isObject(focus)) { errors.push(`${focusLabel} 必须是对象`); continue; }
        for (const key of ["id", "title", "description", "practice"]) if (!hasText(focus[key])) errors.push(`${focusLabel}.${key} 必须是有效文本`);
        if (seenFocus.has(focus.id)) errors.push(`${focusLabel}.id 重复`);
        seenFocus.add(focus.id);
        if (!Array.isArray(focus.modules) || !focus.modules.length) errors.push(`${focusLabel}.modules 必须包含主题`);
        else {
          if (new Set(focus.modules).size !== focus.modules.length) errors.push(`${focusLabel}.modules 不能重复`);
          for (const module of focus.modules) {
            if (!members.includes(module)) errors.push(`${focusLabel} 包含未分配给该身份的主题：${module}`);
            coveredModules.add(module);
          }
        }
      }
      for (const module of members) if (!coveredModules.has(module)) errors.push(`${label} 的主题 ${module} 缺少学习方向`);
    }
    if (!isObject(role.contexts)) errors.push(`${label}.contexts 必须是主题指引对象`);
    else {
      for (const module of Object.keys(role.contexts)) if (!members.includes(module)) errors.push(`${label}.contexts 包含未分配主题：${module}`);
      for (const module of members) {
        for (const key of ["caseContext", "exercise", "deliverable"]) {
          if (!hasText(role.contexts[module]?.[key])) errors.push(`${label}.contexts.${module}.${key} 必须是有效文本`);
        }
      }
    }
  }
  for (const id of IDS) if (!seenIds.has(id)) errors.push(`身份配置缺少 ${id}`);
  if (!Array.isArray(config.moduleAssignments)) return [...errors, "身份配置 moduleAssignments 必须是数组"];
  const seenModules = new Set();
  for (const [index, assignment] of config.moduleAssignments.entries()) {
    const label = `moduleAssignments[${index}]`;
    if (!isObject(assignment)) { errors.push(`${label} 必须是对象`); continue; }
    if (!moduleIds.has(assignment.module) || !trackIds.has(assignment.module)) errors.push(`${label}.module 未在课程目录中：${assignment.module}`);
    if (seenModules.has(assignment.module)) errors.push(`${label}.module 重复：${assignment.module}`);
    seenModules.add(assignment.module);
    if (!["fixed", "rotate"].includes(assignment.mode)) errors.push(`${label}.mode 必须为 fixed 或 rotate`);
    const ids = assignment.identities;
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => !IDS.includes(id)) || new Set(ids).size !== ids.length) {
      errors.push(`${label}.identities 必须是不重复的有效身份`);
      continue;
    }
    if (ids.length !== (assignment.mode === "fixed" ? 1 : 2)) errors.push(`${label} 的身份数量与 mode 不一致`);
    if (!ids.includes(assignment.firstIdentity)) errors.push(`${label}.firstIdentity 必须属于 identities`);
    for (const id of IDS) {
      const role = rolesById.get(id);
      const members = role && Array.isArray(role.primaryModules) && Array.isArray(role.foundationModules) ? roleModules(role) : [];
      if (ids.includes(id) !== members.includes(assignment.module)) errors.push(`${label} 与 ${id} 身份主题映射不一致`);
    }
  }
  for (const module of moduleIds) if (!seenModules.has(module)) errors.push(`身份配置缺少主题映射：${module}`);
  return errors;
}

/** Role-specific application guidance; this is not an additional course unit. */
export function identityContext(identityId, module, config = DEFAULT_IDENTITIES) {
  const role = config.identities.find((item) => item.id === identityId);
  if (!role || !roleModules(role).includes(module)) throw new Error(`身份 ${identityId} 未包含主题 ${module}`);
  return {
    id: role.id, path: role.path, title: role.title, description: role.description, goal: role.goal,
    module, moduleKind: role.primaryModules.includes(module) ? "primary" : "foundation",
    focusAreas: role.focusAreas.filter((focus) => focus.modules.includes(module)),
    caseGuidance: role.caseGuidance, practiceGuidance: role.practiceGuidance,
    ...(role.learnerProfile ? { learnerProfile: role.learnerProfile } : {}),
    ...role.contexts[module]
  };
}

/** Retain the shared unit sequence; add exactly one dated application identity. */
export function identityPlanForDate(date, topics, curriculum, entries = [], config = DEFAULT_IDENTITIES) {
  return curriculumPlanForDate(date, topics, curriculum, entries).map((item) => {
    const learningIdentity = identityForLesson(date, item.module, topics, config);
    return { ...item, learningIdentity, identityContext: learningIdentity ? identityContext(learningIdentity, item.module, config) : null };
  });
}

/** Actual labeled publications only; membership never implies completed progress. */
export function identityProgress(entries, config = DEFAULT_IDENTITIES, cutoff) {
  if (cutoff !== undefined && !isDateString(cutoff)) throw new Error("身份进度 cutoff 必须是有效日期");
  const relevant = entries.filter((entry) => isDateString(entry.date) && (!cutoff || entry.date <= cutoff));
  const legacyLessons = relevant.filter((entry) => entry.date < config.effectiveDate)
    .reduce((total, entry) => total + (entry.lessons ?? []).length, 0);
  return {
    effectiveDate: config.effectiveDate,
    legacyLessons,
    identities: config.identities.map((role) => {
      const members = roleModules(role);
      const publications = relevant.filter((entry) => entry.date >= config.effectiveDate).flatMap((entry) =>
        (entry.lessons ?? []).filter((lesson) => lesson.learningIdentity === role.id && members.includes(lesson.module))
          .map((lesson) => ({ date: entry.date, lesson })));
      return {
        id: role.id, title: role.title, path: role.path,
        publishedLessons: publications.length,
        latestDate: publications.map((item) => item.date).sort().at(-1) ?? null,
        modules: members.map((module) => ({ module, publishedLessons: publications.filter((item) => item.lesson.module === module).length }))
      };
    })
  };
}
