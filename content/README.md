# 内容数据

`daily/` 中的每个 `YYYY-MM-DD.json` 都是一份不可变的每日归档。首页、日期页、课程进度、历史列表、RSS 与公开 JSON 都由这些归档在构建时派生。

## schemaVersion 4

| 字段 | 用途 |
| --- | --- |
| `date` | 唯一日期，必须与文件名一致 |
| `title` / `subtitle` / `introduction` | 只列出当天有哪些独立课程及其进度，不提炼或制造共同主题 |
| `estimatedMinutes` | 两课预计 30–40 分钟，单课预计 20–30 分钟；必须等于课程与雷达的分钟数总和 |
| `lessons` | 当天 1–2 节深度课程，由七日安排确定主题 |
| `lessons[].curriculum` | 固定的阶段、单元、顺序、总课数与学习轮次 |
| `coreQuestion` | 本课只回答的一个核心问题，必须以问号结尾 |
| `framework` | 一个可复用框架：定义、2–3 个步骤及适用边界 |
| `keyPoints` | 恰好 3 个有短标题、互不重复的重点 |
| `caseStudy` | 一个短案例：情境、拆解与可以迁移的结论 |
| `exercise` | 本课立即应用的小练习及明确输出物 |
| `conclusion` | 本课唯一的一句话结论 |
| `radar` | 独立的近期变化，标明所属 `module`，回答“发生了什么、为什么重要、接下来观察什么”；不要求关联当天课程 |
| `sources` | 可点击来源；自动生成时必须匹配真实 Web Search 记录 |

每节课六个结构块的可见文字必须为 350–750 个字符；行业雷达最多 280 个字符。课程之间彼此独立，不必相互引用或服务于同一个“今日主题”。顶层 `theme`、`practice`、`closing`，以及旧版 `body`、`learningObjectives`、`application`、`takeaway` 与 `reflection` 等重复字段在 v4 中会被拒绝；每节课使用自己的 `exercise` 完成练习。

课程路径的唯一事实源是 `config/curriculum.json`。生成器会先读取每日历史归档，为每个主题选择下一单元，再把身份字段固定写入每日 JSON。模型不能自由选择或跳过课程节点。`content/starter-lessons.json`（如存在）用于提供各主题的可读起步内容，不计入按日期推进的课程进度。

完整字段约束位于 `scripts/content-schema.mjs`，跨日期课程顺序与课程目录完整性由 `scripts/lib.mjs` 和 `scripts/validate-content.mjs` 检查。

人工修改后运行：

```bash
npm run validate
```

默认生成器不会覆盖已有日期。只有明确执行 `npm run generate -- --date YYYY-MM-DD --force` 才会修订旧档。为避免后续课程错位，系统拒绝直接在当前最新归档之前插入新日期。
