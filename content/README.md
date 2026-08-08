# 内容数据

`daily/` 中的每个 `YYYY-MM-DD.json` 都是一份不可变的每日归档，也是网站内容的唯一事实源。首页、日期页面、历史列表、RSS 与公开 JSON 索引都在构建时自动派生，不需要手工同步。

## 核心字段

| 字段 | 用途 |
| --- | --- |
| `date` | 唯一日期，必须与文件名一致 |
| `estimatedMinutes` | 全期预计 30–45 分钟 |
| `freshRatio` | 最新变化占比，允许 0.2–0.4 |
| `sections` | 当天恰好 6 个正式主题模块，并与日期轮换表一致 |
| `freshness` | `latest` 或 `evergreen` |
| `sources` | 最新变化必须附可点击的一手来源 |
| `practice` | 连接至少两个模块的行动练习 |

完整约束在 [`scripts/content-schema.mjs`](../scripts/content-schema.mjs)，人工添加后运行 `npm run validate` 即可检查。

默认生成器不会覆盖已经存在的日期。只有明确执行 `npm run generate -- --date YYYY-MM-DD --force` 才会修订旧档，便于从 Git 历史追踪更正。
