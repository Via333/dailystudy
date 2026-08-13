# 每日学习

一个由 GitHub Pages 托管、GitHub Actions 每日更新的结构化中文学习网站。

它不是每天随机推送几条知识点，而是维护 **13 条互不依附的课程路径、13 节可立即阅读的完整起步课，以及 344 个有顺序的课程单元**。每天更新其中 1–2 门课程，各讲各自的核心知识，不需要围绕同一个主题强行关联；行业变化则单独进入“前沿雷达”，不会挤掉长期课程。

线上网站：<https://via333.github.io/dailystudy/>

## 学习体系

全部主题都有独立目标、学习原则、阶段、单元、进度页和一节完整起步课。打开任意主题，不必等待它轮到当天更新，就能直接学习“核心问题 → 框架 → 3 个重点 → 案例 → 小练习 → 一句话结论”：

- 广告与平台前沿
- 营销案例
- 审美与创意
- 消费者心理
- 品牌 / 产品 / 用户研究
- AI
- 数据分析
- 管理与组织认知
- 财务 / 投资 / 宏观经济
- 认知科学与决策能力
- 沟通与表达
- 个人成长
- 媒介与电商行业

消费者心理包含 8 个连续阶段：消费者决策旅程、注意与感知、学习与记忆、动机/情绪/身份、态度形成与说服、判断与选择架构、社会影响与文化、行为设计/验证/伦理。每个阶段 4 课，共 32 课。

每周安排让 13 个主题各推进一次：

| 周期日 | 深度课程 |
| --- | --- |
| 1 | 消费者心理；品牌 / 产品 / 用户研究 |
| 2 | 广告与平台前沿；数据分析 |
| 3 | 管理与组织认知；沟通与表达 |
| 4 | 财务 / 投资 / 宏观经济；认知科学与决策能力 |
| 5 | 营销案例；审美与创意 |
| 6 | AI；媒介与电商行业 |
| 7 | 个人成长 |

表格只决定每天推进哪 1–2 门课，不代表同一天的课程必须互相解释，也不会把未轮到的主题从网站中隐藏。13 节常驻起步课不计入日期归档进度；日更仍从各知识树的第一单元开始，保证归档顺序清晰。

## 网站功能

- 首页先展示全部 13 条主线与 4 个能力域；每张卡片都有真实的起步问题、结论和完整课程入口，再高亮当天推进的 1–2 条课程
- 每节课固定为“核心问题 → 框架 → 3 个重点 → 案例 → 小练习 → 一句话结论”，不再堆叠长段落
- 同一天的课程保持独立，不设置共享主题、共享练习或牵强的跨课程结论
- 行业雷达是可选的独立观察，放在课程之后并默认折叠；它标注自己的所属领域，但不要求与当天课程关联
- `/curriculum/` 按 4 个能力域展示 13 条完整学习路径
- `/curriculum/{module}/` 先展示可完整阅读的起步课，再展示该主题的全部阶段、单元和日更发布状态；当前阶段默认展开
- `/archive/` 按日期浏览、搜索往期内容
- `/YYYY-MM-DD/` 每一期拥有可直接访问的静态地址
- 每天 08:00（Asia/Shanghai）自动选择下一课程、生成、校验、归档和发布

GitHub Actions 会在北京时间 08:00 触发任务；内容生成与页面发布需要几分钟，平台高峰时也可能稍有延迟。
- 自动生成 RSS、sitemap、404、社交预览图与公开 JSON 数据
- 纯静态 HTML/CSS/JavaScript，无数据库、无运行时服务器、无前端依赖
- 支持手机、深色模式、键盘操作、无 JavaScript 阅读和打印

## 内容怎样保持连续

```text
读取 13 条课程知识树
  → 根据日期选择当天的 1–2 个主题
  → 读取往期归档，找到每个主题的下一单元
  → 锁定阶段、单元、课程序号和学习目标
  → 分别按六块固定结构生成 1–2 门独立课程与独立前沿雷达
  → 校验顺序、覆盖、字数、重点、时长与来源
  → 写入 content/daily/YYYY-MM-DD.json
  → 构建全部静态页面并发布
```

模型不能自行选择当天知识点，也不能为同一天的不同课程虚构共同主题。`curriculum` 元数据由程序在生成后再次写入，并由全局校验按日期逐课检查；重复、跳课、漏主题、把新闻当核心课，或起步课没有完整覆盖 13 个主题，都会使发布失败。每日归档采用 schema v4：顶层只负责日期与本期索引，每节 `lesson` 和每条 `radar` 都携带自己的独立内容与所属主题。

## 一次性部署设置

本仓库已经连接 `Via333/dailystudy`。新环境只需确认：

1. 仓库 **Settings → Pages → Build and deployment → Source** 为 **GitHub Actions**。
2. 仓库 **Settings → Secrets and variables → Actions → Secrets** 中存在 `OPENAI_API_KEY`。
3. 在 **Actions → 每日生成并发布 → Run workflow** 手动运行一次。

没有密钥时，定时生成任务会明确失败，避免“显示成功但仍在发布旧内容”。添加密钥后，在 **Actions → 每日生成并发布 → Run workflow** 手动运行一次即可立即验证。

生成器使用 OpenAI Responses API 的 Web Search 与 Structured Outputs；默认模型为 `gpt-5.6-luna`，可通过 Actions variable `OPENAI_MODEL` 修改。密钥只进入 GitHub Actions 的生成任务，不会进入网页或归档。

相关官方文档：[Web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

> 生成 API 与联网搜索会产生费用。建议在 OpenAI 项目中设置预算和用量提醒；涉及重要判断时仍应打开页面列出的一手来源复核。

## 本地使用

需要 Node.js 22 或更高版本，不需要额外前端框架。

```bash
npm ci
npm test
npm run dev
```

本地预览地址为 <http://127.0.0.1:4173>。

生成当天内容：

```bash
export OPENAI_API_KEY="你的密钥"
npm run generate
```

补生成尚未存在、且晚于当前最新归档的日期：

```bash
npm run generate -- --date 2026-08-09
```

已有日期默认保持不变。只有明确修订时使用 `--force`；为保护课程顺序，不能直接在现有归档之前插入一篇新内容。

## 项目结构

```text
config/topics.json            4 个能力域、13 个主题与每周课程安排
config/curriculum.json        13 条知识树、阶段和 344 个单元
content/starter-lessons.json  13 门独立课程的常驻完整起步课
content/daily/                每日深度课程与雷达归档
scripts/generate-daily.mjs    选择下一课、联网生成并写入归档
scripts/validate-content.mjs  检查课程完整性与逐日推进顺序
scripts/build-site.mjs        构建首页、课程地图、日期页与索引
site/                         样式、轻量交互和分享图
tests/                        发布物与课程规则测试
.github/workflows/publish.yml 定时生成与 GitHub Pages 发布
dist/                         本地派生的静态发布物，不提交
```

每日数据字段见 [`content/README.md`](content/README.md)。课程路径在 [`config/curriculum.json`](config/curriculum.json)，主题安排在 [`config/topics.json`](config/topics.json)。

## 发布与安全

- 只有定时或手动生成任务获得 `contents: write`，用于提交新日期文件。
- 构建和部署使用独立任务与最小权限；Pages 只上传 `dist/`。
- Pull Request 代码不会在带写权限或 API 密钥的生成任务中执行。
- 时效来源必须命中本次真实搜索记录，否则不写入归档。
- `GITHUB_TOKEN` 创建的提交不会触发第二个 workflow，因此生成、提交、构建和部署在同一次运行中完成。

## License

[MIT](LICENSE)
