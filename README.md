# 每日学习

一个为 GitHub Pages 设计的低维护中文学习网站：每天自动生成一期内容，把当天内容作为日期文件提交回 Git，随后构建首页、历史归档和独立日期页面并发布。

示例内容完整覆盖原有学习体系，并把以下四项保留为正式核心模块，而不是偶尔穿插的小知识：

- 品牌 / 产品 / 用户研究
- 管理与组织认知
- 财务 / 投资 / 宏观经济
- 认知科学与决策能力

同时轮换广告与平台前沿、营销案例、审美与创意、消费者心理、AI、数据分析、沟通表达、个人成长、媒介与电商行业。目标配比为约 **30% 最新变化 + 70% 长期知识**，每天约 **30–45 分钟**。

## 已实现

- 首页自动展示上海时区下最新一期有效内容
- `/archive/` 历史列表，可按标题或主题搜索
- `/YYYY-MM-DD/` 每一期的独立静态地址
- 每天 08:07（Asia/Shanghai）自动生成、校验、归档和发布
- 默认不覆盖已有日期；历史修订可以从 Git 记录追踪
- 时效性模块必须包含可点击来源，页面会清晰展示
- 自动生成 RSS、sitemap、404、社交预览图和公开 JSON 数据
- 纯静态 HTML/CSS/JavaScript，无数据库、无运行时服务器、无前端依赖
- 响应式、深色模式、键盘焦点、打印样式与减少动画支持

## 一次性部署

1. 在 GitHub 新建一个仓库，例如 `daily-learning`，把本项目推送到 `main` 分支。
2. 打开仓库 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
3. 打开 **Settings → Secrets and variables → Actions → Secrets**，新增 `OPENAI_API_KEY`。
4. 打开 **Actions → 每日生成并发布 → Run workflow**，先手动运行一次。

Pages 部署完成后，GitHub 会在 workflow 的 `deploy` 任务里显示网址。若暂时不设置密钥，示例内容仍会正常构建并发布，只会跳过当天的新稿生成。

如果当前目录还没有连接远程仓库，可在 GitHub 创建空仓库后执行：

```bash
git add .
git commit -m "Build daily learning site"
git remote add origin https://github.com/YOUR-NAME/daily-learning.git
git push -u origin main
```

GitHub 官方的 Pages 自定义 workflow 说明：[Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 自动更新怎样工作

```text
08:07 定时启动
  → 联网检索并生成结构化内容
  → 校验日期、主题、时长、30/70 配比与来源网址
  → 写入 content/daily/YYYY-MM-DD.json
  → 提交到 main，永久保留归档
  → 构建全部静态页面
  → 发布到 GitHub Pages
```

生成器使用 OpenAI Responses API 的 web search 与 Structured Outputs。模型默认是成本相对可控的 `gpt-5.6-luna`；可以在仓库 **Actions Variables** 中新增 `OPENAI_MODEL` 来替换。密钥只通过 GitHub encrypted secret 进入生成任务，不会进入网页、归档或构建产物。

相关官方文档：[Web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

> 生成 API 和联网搜索会产生实际费用。建议在 OpenAI 项目中设置月度预算与用量提醒。自动内容仍可能出错；重要判断应回到页面列出的原始来源核验。

## 本地使用

需要 Node.js 22 或更高版本，不需要安装额外前端框架。

```bash
npm ci
npm test
npm run dev
```

本地预览会显示在 `http://127.0.0.1:4173`。

手动生成当天内容：

```bash
export OPENAI_API_KEY="你的密钥"
npm run generate
```

补某一天的内容：

```bash
npm run generate -- --date 2026-08-09
```

已有日期默认保持不变。只有在明确修订时使用 `--force`。

## 项目结构

```text
content/daily/               每天一份 JSON，唯一内容源
config/topics.json           主题目录、核心模块和七日轮换
scripts/generate-daily.mjs   联网生成并写入日期归档
scripts/validate-content.mjs 内容质量门槛
scripts/build-site.mjs       派生全部静态页面与索引
site/                        页面样式、轻量交互和分享图
tests/                       发布物完整性测试
.github/workflows/publish.yml 定时生成与 Pages 发布
dist/                        本地构建产物，不提交
```

数据字段说明见 [`content/README.md`](content/README.md)。调整主题与轮换只需编辑 [`config/topics.json`](config/topics.json)。

## 发布与安全说明

- workflow 只在定时或手动运行时获得 `contents: write`，用于提交新日期文件。
- 构建与部署使用独立任务和最小权限；网页发布物仅上传 `dist/`。
- Pull Request 中的代码不会在带写权限或 API 密钥的生成任务里执行。
- `GITHUB_TOKEN` 创建的提交不会触发第二个 workflow，因此生成、提交、构建和部署在同一次运行中完成。
- 如果默认分支启用了禁止 Actions 直接提交的 ruleset，需要允许 GitHub Actions bypass，或改为自动 Pull Request 流程。

## License

[MIT](LICENSE)
