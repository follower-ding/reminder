# ☀️ 日常提醒系统

轻量级、可自托管的提醒服务平台，支持生日、纪念日、经期、吃药、缴费、健康习惯等 9 种提醒类型，集成飞书机器人和 Server酱 微信推送。

## 特性

- **9 种提醒类型**: 生日、纪念日、经期、吃药、缴费、健康、节日、体检、自定义
- **灵活调度**: 每天、每周、每月、每年、周期（经期）
- **多渠道推送**: 飞书机器人卡片、Server酱 微信通知
- **移动端适配**: PWA 支持添加到主屏幕、离线缓存
- **一键部署**: 支持 Zeabur / Railway / Render / VPS
- **智能推荐**: 自动分析经期、生日、缴费等场景给出建议

## 快速开始

### 本地运行

```bash
npm install
node server.js
# 访问 http://localhost:3333
# 默认登录: admin / admin123
```

### 配置推送

登录 Web 界面后，在「设置」页面配置：

1. **飞书**: 填写 Webhook URL（群机器人 → 添加机器人 → 复制 Webhook）
2. **Server酱**: 填写 SendKey（https://sct.ftqq.com 注册获取）

### 定时推送

```bash
# 手动执行检查
node reminder.js

# 配置 crontab（每天 9:00, 14:00, 21:00）
0 9,14,21 * * * cd /opt/reminder && node reminder.js >> /var/log/reminder.log 2>&1

# 或使用 PM2
pm2 start reminder.js --name reminder-check --cron "0 9,14,21 * * *"
```

## 部署

| 平台 | 说明 |
|------|------|
| **Zeabur** | 导入 GitHub 仓库，启动命令 `node server.js` |
| **Railway** | 连接仓库，自动检测 |
| **Render** | New Web Service → Start Command `node server.js` |
| **VPS** | `pm2 start server.js --name reminder` |

## 项目结构

```
reminder/
├── server.js              # Web 服务器 + 全部 API
├── reminder.js            # 定时推送脚本
├── data.json              # 事件数据 + 历史记录
├── config.json            # 推送配置
├── package.json           # 项目配置
├── public/
│   ├── index.html         # 管理界面
│   ├── app.js             # 前端逻辑
│   ├── manifest.json      # PWA 清单
│   └── sw.js              # Service Worker
└── .github/workflows/
    └── deploy.yml         # CI/CD
```

## API 文档

认证方式: `Authorization: Bearer <token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录获取 Token |
| GET | `/api/events` | 获取所有事件 |
| POST | `/api/events` | 创建事件 |
| PUT | `/api/events/:id` | 更新事件 |
| DELETE | `/api/events/:id` | 删除事件 |
| GET | `/api/check` | 今日提醒检查 |
| GET | `/api/dashboard` | 首页数据 |
| GET | `/api/stats` | 统计分析 |
| GET | `/api/recommend` | 智能推荐 |
| GET | `/api/history` | 操作历史 |
| PUT | `/api/config` | 更新配置 |
| POST | `/api/feishu/test` | 测试飞书推送 |
| POST | `/api/serverchan/test` | 测试 Server酱 |

## 安全

- `config.json` 和 `data.json` 已加入 `.gitignore`，不会提交到仓库
- 默认用户 admin，请及时修改密码
- 建议定期备份 `data.json`

## License

MIT

---

> **版本:** v3.0 | **源码:** https://github.com/follower-ding/reminder
