# Scheme B 产品说明（v3.2）

## 范围

- **事件类型**：生日 / 经期 / 自定义（旧类型自动迁移）
- **推送时刻**：每个事件可设 `schedule.time`（HH:mm），Cron 按小时匹配
- **经期**：打卡写入 `cycle_history`，按历史间隔预测
- **推荐**：生活建议 + GitHub / 新闻 / 学习 Digest
- **推送卡片**：飞书分组精美卡片 + Server酱 Markdown

## 配置要点

| 项 | 说明 |
|----|------|
| `default_push_time` | 未单独设时刻时的默认点 |
| `digests.push_time` | 热点 Digest 推送时刻（默认 20:00） |
| Cron | `GET /api/cron/check` 建议每小时；`vercel.json` 已配 `0 * * * *`（Hobby 可能仅支持日级，可用 cron-job.org） |

## Design System Compliance

- MASTER: `design-system/MASTER.md`
- Style: Soft UI Evolution · Teal `#0D9488` + CTA `#F97316`
- Tokens: `src/assets/styles/tokens.css` + `public/styles.css`
- Anti-AI: 无紫渐变 Hero；导航 SVG；按类型显隐字段
