# 内容数据

`daily/` 中的每个 `YYYY-MM-DD.json` 都是一份不可变的每日归档。首页、日期页、课程进度、历史列表、RSS 与公开 JSON 都由这些归档在构建时派生。

## schemaVersion 2

| 字段 | 用途 |
| --- | --- |
| `date` | 唯一日期，必须与文件名一致 |
| `estimatedMinutes` | 全期预计 30–45 分钟，必须等于课程、雷达和练习的分钟数总和 |
| `lessons` | 当天 1–2 节深度课程，由七日安排确定主题 |
| `lessons[].curriculum` | 固定的阶段、单元、顺序、总课数与学习轮次 |
| `learningObjectives` | 学完本单元后应能完成的具体任务 |
| `body` | 围绕当前单元建立概念、解释机制并给出例子 |
| `application` | 把当前单元应用到真实商业或生活问题 |
| `boundary` | 适用边界、反例或常见误用 |
| `radar` | 独立的近期行业变化，不改变课程顺序 |
| `sources` | 可点击来源；自动生成时必须匹配真实 Web Search 记录 |
| `practice` | 连接当天课程的行动练习 |

课程路径的唯一事实源是 `config/curriculum.json`。生成器会先读取历史归档，为每个主题选择尚未学习的下一单元，再把身份字段固定写入每日 JSON。模型不能自由选择或跳过课程节点。

完整字段约束位于 `scripts/content-schema.mjs`，跨日期课程顺序与课程目录完整性由 `scripts/lib.mjs` 和 `scripts/validate-content.mjs` 检查。

人工修改后运行：

```bash
npm run validate
```

默认生成器不会覆盖已有日期。只有明确执行 `npm run generate -- --date YYYY-MM-DD --force` 才会修订旧档。为避免后续课程错位，系统拒绝直接在当前最新归档之前插入新日期。
