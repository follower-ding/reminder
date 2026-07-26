# 日常提醒 v4 — 系统设计规格

**日期:** 2026-07-27  
**状态:** 品牌 **Nudge** · **v4.0 已落地（可信调度 + 页面重做）** · 待推送合并  
**AI:** DeepSeek（Key 仅 `DEEPSEEK_API_KEY` 环境变量 / Vercel，禁止写入前端与 Git）  
**前序:** 方案 B (v3.2) 体验不足 → 重构为「事项中心 + 可信调度 + AI 富卡片 + 可配置热点 + 飞书问答」  
**品牌:** **Nudge**（英文产品感；飞书显示名「Nudge」；中文副标题可用「轻推一下，刚好想起」）

---

## 0. 项目命名

**已选定：Nudge**

| 用途 | 文案 |
|------|------|
| 产品名 / Web 标题 | Nudge |
| 副标题 | 轻推一下，刚好想起 |
| 飞书机器人 / 卡片抬头 | Nudge |
| package name | `nudge`（或保持仓库 `reminder`，展示层用 Nudge） |
| 测试卡前缀 | 【连通性测试】 |

其余候选（轻伴 / 日安 / 照护时刻）废弃。

---

## 1. 产品一句话

**Nudge**：私人提醒助手 — 管理生日 / 经期 / 自定义事项与可配置热点订阅 → **到点才推**内容丰富的飞书卡片 → DeepSeek 生成文案 → 可在飞书主动提问。

---

## 2. 目标用户与场景

| Persona | 场景 |
|---------|------|
| 个人用户（iu） | 经期关怀、生日、吃药/学习等到点提醒 |
| 同场景延伸 | 订阅 AI 新闻 / GitHub 等每日 Digest；飞书里问「今天该做什么」 |

---

## 3. 非目标（本阶段不做）

- 医疗诊断级经期预测  
- 多租户 / 多用户 SaaS  
- 原生 App  
- 自动改库的「语音改提醒」（对话首期只读 + 生成建议）

---

## 4. 核心原则

1. **创建/保存事项绝不推送**（除非用户点「立即推送」）  
2. **测试推送**标题必须含 `【连通性测试】`，与业务卡隔离  
3. **调度精确到分钟** + **push_ledger 防重**  
4. **AI 只生成内容**，不决定「该不该推」  
5. **热点 = 可配置订阅源**，不是写死 GitHub  

---

## 5. 页面系统重设计（优雅 × 好体验）

### 5.1 设计意图

- **情绪**：安静、可信、轻陪伴（非仪表盘、非紫渐变 SaaS）  
- **字体**：Display 用有个性的衬线或圆润标题字体；正文可读中文（避免 Inter）  
- **色彩**：单一主色 + 一个暖强调色（延续青绿/琥珀或随品牌微调）；经期用克制玫瑰，不血腥  
- **动效**：入场 ≤3、微交互 150–200ms；`prefers-reduced-motion`  
- **原则**：首屏一件事；表单分步/按类型显隐；卡片即事项，少 emoji 堆砌导航（SVG）

### 5.2 信息架构

| 路由/Tab | 职责 | 交互要点 |
|----------|------|----------|
| **今日** | 今日待推 / 已推时间线 | 大日期 + 卡片流；空状态一句温柔文案 |
| **事项** | 列表 → **全屏详情** | 列表只显示名/下次/类型色条；点进详情见内容、AI 区、推送记录 |
| **订阅** | 热点源 | 源卡片开关 + 时刻；自定义 RSS 行内添加 |
| **助手** | 对话 | 气泡流；说明「由 DeepSeek 生成」 |
| **设置** | 渠道与联调 | DeepSeek **只显示「已通过环境变量配置」**，禁止贴 Key；测试按钮二次确认 |

### 5.3 关键流（必须顺滑）

1. **新增**：底部 FAB → 选类型（生日/经期/自定义）→ 只出相关字段 → 保存回列表（**不推送**）  
2. **经期打卡**：详情页主按钮「今天开始了」→ 即时更新预测条  
3. **详情**：左滑/返回保留列表滚动位置  
4. **推送记录**：时间轴，成功/失败色点；失败可「重试推送」  
5. **订阅预览**：先看抓取原文，再「生成 AI 介绍」

### 5.4 飞书侧体验

- 业务卡：品牌名 + 事项名；多区块；打开详情深链  
- 测试卡：`【连通性测试】` 醒目标记  
- 机器人显示名 = 品牌名（如「轻伴」）

---

## 6. 数据模型

### 6.1 `items`（统一事项）

```json
{
  "id": 1,
  "kind": "birthday | period | custom | subscription",
  "name": "吃药提醒",
  "enabled": true,
  "schedule": {
    "mode": "daily | weekly | monthly | yearly | cycle | once",
    "date": "2026-07-27",
    "month": 7,
    "day": 27,
    "time": "03:25",
    "timezone": "Asia/Shanghai",
    "cycle_length": 28,
    "period_length": 5,
    "last_start": "2026-07-01",
    "cycle_history": ["2026-06-03", "2026-07-01"]
  },
  "content": {
    "summary": "该吃药了",
    "body_md": "可选详情",
    "ai_blocks": [
      { "title": "今日建议", "text": "...", "generated_at": "..." }
    ]
  },
  "subscription": {
    "source_ids": ["github_trending", "ai_news"],
    "max_items": 5
  },
  "next_run_at": "2026-07-27T03:25:00+08:00",
  "created_at": "...",
  "updated_at": "..."
}
```

旧 `events` 启动时迁移为 `items`（兼容读一层）。

### 6.2 `push_ledger`（防重 + 详情页历史）

```json
{
  "id": 1,
  "item_id": 12,
  "channel": "feishu | serverchan",
  "planned_at": "2026-07-27T03:25:00+08:00",
  "sent_at": "2026-07-27T03:25:12+08:00",
  "status": "success | failed | skipped",
  "dedupe_key": "item:12:2026-07-27:03:25:feishu",
  "card_preview": "标题/摘要",
  "error": null
}
```

同一 `dedupe_key` 成功后不再推。

### 6.3 `config` 与密钥

```json
{
  "deepseek": {
    "enabled": true,
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat"
  },
  "brand": { "name": "Nudge", "tagline": "轻推一下，刚好想起" },
  "digest_catalog": [],
  "feishu_bot": { "webhook_url": "", "enabled": false }
}
```

**DeepSeek Key（安全约定）：**

- 只读环境变量 `DEEPSEEK_API_KEY`（本地 `.env` / Vercel Project Env）  
- **禁止**写入 `config.json`、Postgres 业务配置、前端  
- 设置页仅展示：`DeepSeek：已配置 / 未配置`（探测 `process.env` 是否存在，不回传 Key）

---

## 7. 调度引擎（可信）

1. Cron：`*/5 * * * *` 或每分钟（Vercel 限制时用外部 cron-job.org）  
2. 计算 `due = now >= next_run_at` 且 enabled  
3. 查 ledger：无成功 `dedupe_key` 才推  
4. 推送成功后写 ledger，并推进 `next_run_at`  
5. **忽略「当前小时内任意匹配」的旧逻辑**；必须分钟窗口（例如计划时刻起 5 分钟内）

### 关于「3:25 立刻推送」的结论（写进规格）

- 用户截图卡片文案 = `/api/feishu/test` 测试卡，**不是**事项推送  
- 仍必须修：测试卡文案隔离、分钟级调度、ledger 防重，避免真实误推  

---

## 8. 飞书富卡片

### 8.1 业务卡结构

- 标题：事项名 + 日期  
- 区块：摘要 / 详情 / AI 建议（经期注意事项、安慰话术、今日可做）  
- 操作：打开事项详情、（可选）已读  

### 8.2 测试卡

- 标题固定：`【连通性测试】非事项提醒`  
- 正文说明：仅验证 Webhook，与任何日程无关  

### 8.3 订阅 Digest 卡

- 每个源一小节标题  
- 每条：标题 + AI 一句话介绍 + 链接  
- 页脚：订阅管理入口  

---

## 9. DeepSeek 用法

| 场景 | Prompt 目标 | 缓存 |
|------|-------------|------|
| 经期日推 | 注意事项、安慰女朋友话术、可做的事（非医疗） | 按 `item_id + date + cycle_day` 缓存 |
| 生日 | 祝福 + 准备建议 | 按日期缓存 |
| 自定义 | 把用户一句话扩成温和提醒卡 | 可选 |
| 热点整合 | 把抓取条目写成有趣简介（中文） | 按 `source_id + date` 缓存 |
| 飞书/Web 问答 | 只读上下文（今日事项、经期摘要、最近热点） | 无长缓存 |

失败降级：用本地模板文案，卡片仍发出，标注「模板文案」。

---

## 10. 热点订阅（可配置，不限于 GitHub）

### 10.1 内置源目录（`digest_catalog`）

| source_id | 名称 | 抓取方式 |
|-----------|------|----------|
| `github_trending` | GitHub 热门 | GitHub Search/Trending |
| `ai_news` | AI 新闻趋势 | 预设 RSS 列表（可改） |
| `hn_frontpage` | Hacker News | hnrss |
| `custom_rss` | 自定义 RSS | 用户填 feed URL |
| `custom_keywords` | 关键词订阅 | 后续：搜索/聚合（v4.2+） |

用户在「订阅」页：

- 多选源  
- 设每日推送时刻  
- 为 `custom_rss` 添加多个 feed  
- 预览今日抓取结果  
- 点「用 DeepSeek 生成介绍」可手动刷新  

### 10.2 流水线

```
抓取各启用源 → 去重/截断 → DeepSeek 整合介绍 → 写入当日 digest 缓存
→ 到点推送一张 Digest 卡 → 写 push_ledger
```

---

## 11. 飞书主动问答（v4.3，接口先留）

- 入站：飞书事件订阅 / 长连接（实现时选可行方案）  
- 能力：今日提醒、经期建议、解释某条热点、让 AI 重写安慰话术  
- 首期只读，不直接改事项  

---

## 12. 里程碑

| 版本 | 内容 | 验收 |
|------|------|------|
| **v4.0** | 品牌更名 + 页面系统重做 + 事项详情 + 分钟调度 + push_ledger + 测试卡隔离 + 创建不推送 | 新 IA 可用；设 03:25 → 到点才推；详情有推送记录；设置页无 Key 输入框 |
| **v4.1** | DeepSeek 经期/生日/自定义富文案 + 飞书多区块卡 | 经期卡含注意事项与安慰话术 |
| **v4.2** | 可配置热点源（GitHub / AI 新闻 / 自定义 RSS）+ DeepSeek 整合 | 订阅页可开关源并收到 Digest |
| **v4.3** | 飞书 + Web 助手问答 | 提问「今天经期注意什么」有合理回答 |

---

## 13. 技术要点

- 栈保持：Express + static SPA + Postgres/Neon（已有）  
- 新增模块建议：`scheduler.js`、`ledger.js`、`ai/deepseek.js`、`digest/sources.js`  
- DeepSeek Key：环境变量 `DEEPSEEK_API_KEY` 优先，其次 config（勿提交 Git）  
- secrets-guard：推送前扫描  

---

## 14. 待确认

- [x] AI：DeepSeek  
- [x] Key：仅 Vercel / 本地 `DEEPSEEK_API_KEY`  
- [x] 热点：可配置多源  
- [x] 页面：优雅重设计  
- [x] 项目名：**Nudge**  
- [ ] 回复 **「开工」** → 执行 v4.0（品牌换皮 + 可信调度 + 事项详情 + ledger）

规格：`docs/superpowers/specs/2026-07-27-reminder-v4-design.md`
