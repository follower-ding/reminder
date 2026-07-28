# Nudge

**轻推一下，刚好想起** — 私人提醒助手：习惯 / 日子 / 待办 + 热点订阅，到点推飞书卡片，可在飞书确认与问答。

> 当前版本 **v4.2.1** · 仓库：https://github.com/follower-ding/reminder

## 特性

- **三空间清单**：习惯（重复）· 日子（生日 / 经期 / 纪念日）· 待办（临时）
- **可信调度**：分钟窗口 + `push_ledger` 防重；创建/保存不自动推送
- **飞书**：应用机器人长连接、事项/热点分通道、「已收到」回调、结构化问答（生日/日程/清单/概况、换热点/换学习/重推，支持自然语言）
- **陪伴向**：农历生日、经期关怀、哄哄她、习惯 streak、时间胶囊
- **订阅**：可配置 RSS / 编程主题；短卡 + 飞书文档全文
- **客户端**：PWA；可选安卓 Capacitor 壳（见 [docs/ANDROID.md](docs/ANDROID.md)）

## 快速开始

```bash
npm install
node server.js
# http://localhost:3333
# 默认登录: admin / admin123
# 本地默认写项目目录 data.json / config.json
```

生产（VPS）建议：

1. 配置环境变量：`TOKEN_SECRET`、`FEISHU_APP_ID` / `FEISHU_APP_SECRET`、`APP_URL`、可选 `DEEPSEEK_API_KEY` / `DATABASE_URL`
2. `pm2 start server.js --name nudge`
3. 飞书长连接：`pm2 start "npm run feishu:ws" --name reminder-feishu-ws`
4. **不要**再单独 cron `node reminder.js`（旧脚本无 ledger，易重复推送；调度已由 `server.js` 每 60s 扫描）

可选：`GET /api/cron/check` 作外部兜底；Hobby Vercel 仍须 Postgres（`DATABASE_URL`）。

## 页面

| Tab | 用途 |
|-----|------|
| 今日 | 待确认 / 已完成、关怀与即将到来 |
| 清单 | 习惯 · 日子 · 待办 + 详情 |
| 订阅 | Digest 源与时刻 |
| 设置 | 飞书绑定、联调、检查更新 |

## 文档

| 文档 | 说明 |
|------|------|
| [nudge-PRD.md](nudge-PRD.md) | 产品进度 |
| [RELEASE.md](RELEASE.md) | 发版记录 |
| [docs/superpowers/plans/2026-07-29-nudge-v4.2-roadmap.md](docs/superpowers/plans/2026-07-29-nudge-v4.2-roadmap.md) | v4.2 开发计划 |
| [docs/ANDROID.md](docs/ANDROID.md) | 安卓壳 |

## 测试

```bash
npm test
```

## License

MIT
