# 内容数据

`daily/` 中的每个 `YYYY-MM-DD.json` 都是一份默认保留的每日归档。只有用户明确要求修订时才改写，并在 `REVISIONS.md` 记录范围，Git 保留旧稿。首页、日期页、课程进度、历史列表、RSS 与公开 JSON 都由这些归档在构建时派生。

职场课程必须读取计划里的 `identityContext.learnerProfile`。读者已有多年媒介广告和运营经验；用营销理论、策略取舍、真实案例和新玩法解释底层机制，跳过行业入门。沿用六块结构，但核心问题应是决策问题，框架说明假设与机制，重点给出取舍和反例，案例区分事实与推断，练习留下带改判条件的负责人决策。固定知识树节点不等于必须从基础定义讲起。

## schemaVersion 4

| 字段 | 用途 |
| --- | --- |
| `date` | 唯一日期，必须与文件名一致 |
| `title` / `subtitle` / `introduction` | 只列出当天有哪些独立课程及其进度，不提炼或制造共同主题 |
| `estimatedMinutes` | 2026-10-04 起两课 36 分钟（16+16+4），单课 30 分钟（26+4）；旧档保持原分钟数；必须等于课程与雷达的分钟数总和 |
| `lessons` | 当天 1–2 节深度课程，由七日安排确定主题 |
| `lessons[].learningIdentity` | 2026-10-04 起必填 `personal` 或 `work`，必须与当天身份计划一致；旧档可缺省，禁止追认身份 |
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

课程路径的唯一事实源是 `config/curriculum.json`。生成器会先读取每日历史归档，为每个主题选择下一单元，再把课程节点字段固定写入每日 JSON。模型不能自由选择或跳过课程节点。`content/starter-lessons.json`（如存在）用于提供各主题的可读起步内容，不计入按日期推进的课程进度。

## 两条应用路径

`config/identities.json` 定义两个独立入口：个人发展 `/personal/` 与职场增长 `/career/`。身份 ID 分别是 `personal` 和 `work`。两条路径复用现有 13 条知识树、344 个规划单元，不复制或增造课程。

- 个人发展：个人理财、现金配置、投资工具与估值风险；海外小生意的机会、商业模式、需求验证、单位经济、获客和交付。Amazon 与礼品包装是可选应用情境。
- 职场增长：DTC 销售、促销、毛利、预测和复盘；媒介预算、创意、优化、归因、增量与代理商；CRO、CRM、邮件、留存及跨部门、向上、团队协作。
- 各身份明确 `primaryModules`、`foundationModules`、`focusAreas`，以及每个主题的 `contexts`（案例情境、练习、输出物）。这些是既有单元的应用方向，不是额外开设完整课程的承诺。

从 2026-10-04 起，个人成长固定为个人身份；广告、管理与组织固定为工作身份；其余 10 个主题按日历出现次数交替应用身份。固定七日安排仍每天共 1–2 节，不变成每个身份各 1–2 节。两周共 26 节，个人 12 节、工作 14 节。日期决定身份，漏更不会改变后续日期的角色；实际已发布历史决定共享单元的下一课。

每节新课须持久保存 `learningIdentity`，案例与唯一练习围绕该身份和本课单元目标撰写。角色练习替换通用练习，不叠加第二份作业。旧归档与起步课不改写、不补标签，阅读时可另外展示身份应用指引，并明示原课是共同基础。

`identityPlanForDate(date, topics, curriculum, entries, identities)` 在共享课程计划上补充 `learningIdentity` 和 `identityContext`；生效日前这两个值为 `null`。`identityContext(id, module, identities)` 可用于角色内课程页。

`identityProgress(entries, identities, cutoff)` 只统计生效日之后真实带标签的日期课，返回 `.identities` 数组，其中每条包含 `publishedLessons`、逐主题 `.modules` 计数与 `latestDate`。共享单元进度仍按全部日期课顺序推进；身份发布数不是读者完成数，也不会把旧课、未发布单元或共同起步课计算为身份成果。

完整字段约束位于 `scripts/content-schema.mjs`，跨日期课程顺序与课程目录完整性由 `scripts/lib.mjs` 和 `scripts/validate-content.mjs` 检查。

人工修改后运行：

```bash
npm run validate
```

使用 `npm run plan -- --date YYYY-MM-DD` 读取身份与课程固定计划，已经归档的日期会返回 `already_archived`。历史内容必须保持不变。为避免后续课程错位，系统拒绝直接在当前最新归档之前插入新日期。旧 API 生成器仅为可选工具，日常助手编辑与发布流程不依赖 API。
