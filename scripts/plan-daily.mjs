import { curriculumPlanForDate, parseArguments, readCurriculum, readDailyEntries, readTopics, shanghaiDate } from "./lib.mjs";

// Read-only editorial handoff: no API calls, credentials, or file mutations.
const args = parseArguments(process.argv.slice(2));
if (args.force || args.dryRun) throw new Error("课程计划只支持 --date，不生成或覆盖内容。");
const date = args.date ?? shanghaiDate();
const [topics, curriculum, entries] = await Promise.all([readTopics(), readCurriculum(), readDailyEntries()]);
if (entries.some((entry) => entry.date === date)) {
  console.log(JSON.stringify({ date, status: "already_archived", message: "已有归档，保留原稿，不重复生成或发布。" }, null, 2));
} else {
  if (entries.some((entry) => entry.date > date)) throw new Error("不能插入早于现有归档的新日期。");
  const plan = curriculumPlanForDate(date, topics, curriculum, entries);
  const lessonMinutes = plan.length === 1 ? 24 : 16;
  console.log(JSON.stringify({
    date, status: "ready", estimatedMinutes: lessonMinutes * plan.length + 4,
    lessons: plan.map(({ module, track, unit, cycle }) => ({
      module, title: topics.modules.find((item) => item.id === module).title,
      estimatedMinutes: lessonMinutes, goal: track.goal, principles: track.principles,
      curriculum: { stageId: unit.stageId, stageTitle: unit.stageTitle, unitId: unit.id, unitTitle: unit.title,
        objective: unit.objective, scope: unit.scope, sequence: unit.sequence, totalUnits: unit.totalUnits, cycle }
    })),
    radar: { count: 1, estimatedMinutes: 4, requirement: "独立行业观察，需检索并核验一手来源；不得虚构新消息或日期。" }
  }, null, 2));
}
