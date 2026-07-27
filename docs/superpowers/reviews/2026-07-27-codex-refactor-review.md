# Codex 改动审查报告 — Nudge / reminder 项目

**审查日期:** 2026-07-27  
**审查范围:** 本地 `master` 相对 `origin/master` 超前的 **5 个 commit** + 工作区未提交改动  
**审查方式:** `git log` / `git diff` / `npm test`（59 项）/ 静态代码对照 spec  
**结论（初审）:** 重构方向正确，但属于 **「文件拆出、接线未完成」** 的半迁移；存在 **P0 安全回归**，**不可合并 main / 不可上线**。

**复审更新（2026-07-27 续）:** Codex 已修 auth + demo 测试回归；Cursor 已补 push 路由 / 表单农历出生年 / demo 原行为 / lunar 单测。`npm test` **62/62 通过**。项目未用 Vercel 部署，`vercel.json` 问题可忽略。

---

## 1. 改动摘要

| Commit | 说明 |
|--------|------|
| `1cc6607` | 抽出 `middleware/auth.js`、`middleware/error.js` |
| `8e6714f` | 抽出 `lib/push.js`、`routes/push.js`、`routes/demo.js` |
| `40a68ad` | 删除 server.js 内联重复路由，移除 `@vercel/functions` |
| `8d67cfe` | 清理 TOKEN_TTL_MS 重复、`.gitignore` 加 `tmp_*.js` |
| `533dc6a` | 前端卡片：倒计时 / 农历 badge / 年龄展示 |

**新增文件:** `lib/push.js`, `middleware/auth.js`, `middleware/error.js`, `routes/push.js`, `routes/demo.js`  
**仍 monolith:** `server.js` ~1038 行，承载绝大部分 API  
**工作区额外:** `lib/lunar.js`（staged）、`engine.js` / `public/app.js` 农历相关 diff（未 commit）

---

## 2. 测试结果（硬性证据）

```bash
npm test
# 59 tests — 54 pass / 5 fail
```

| 失败用例 | 文件 | 现象 | 根因 |
|----------|------|------|------|
| invalid token returns 401 | `test/auth-and-events.test.js:79` | `200 !== 401` | **`app.use(authMiddleware)` 未挂载** |
| clear demo leaves zero events | `test/cache-and-demo.test.js:75` | `body.events === undefined` | demo 路由响应格式被改 |
| load-push-test creates today-active events | `test/cache-and-demo.test.js:87` | `500 !== 200` | `testEvents is not iterable` |
| push/run without channels counts today | `test/cache-and-demo.test.js:100` | `today >= 1` 失败 | 上游 demo 加载失败，无测试数据 |
| feishu test accepts webhook from body | `test/seed-array-persist.test.js:106` | 期望 `/飞书未配置/`，实际 `飞书未启用` | push 路由重写时丢失 body 合并逻辑 |

**重构前基线（`6ef3583`）:** 同类测试通过；`server.js` 含 `app.use(authMiddleware)`。

---

## 3. 问题清单（按严重级别）

### P0 — 安全 / 不可用

#### 3.1 认证中间件「拆出但未挂回」

- **现象:** `middleware/auth.js` 已创建并 `require`，但 `server.js` 中 **没有** `app.use(authMiddleware)`。
- **影响:** 任意请求可访问 `/api/events`、`/api/config` 等；无效 token 仍返回 200。
- **证据:**

```javascript
// server.js — 只有注释，没有 app.use
// 认证中间件（HMAC 签名 Token，跨进程/冷启动有效）

// middleware/auth.js — 已实现 authMiddleware
```

- **修复:** 在 `app.use(express.static(...))` 之后、所有 `/api/*` 路由之前恢复：

```javascript
app.use(authMiddleware);
```

---

#### 3.2 工作区曾出现「文件截断 / 语法损坏」（编辑过程风险）

审查过程中观察到 Codex 继续编辑时：

| 文件 | 问题 | 后果 |
|------|------|------|
| `public/app.js` | 一度从 ~1048 行 **截断至 ~142 行** | `login`、`renderEvents`、`eventFormHTML` 等全部丢失，**整站 UI 不可用** |
| `engine.js` | 曾在 `module.exports` 后追加代码，出现 `'''lunar'''` 非法字符串 | `require('./engine.js')` SyntaxError，**后端无法启动** |

当前工作区已部分恢复，但说明：**大文件局部 patch 时未做完整性校验**（行数、关键符号、`node -c` / `npm test`）。

**要求:** 每次改动后必须跑 `npm test`；改 `app.js` / `engine.js` 后确认文件行数与 `function eventFormHTML` 等关键符号仍存在。

---

### P1 — 功能回归

#### 3.3 `routes/demo.js` 误用 store 返回值类型

`store.readPushTestData()` 与 `store.readSeedData()` 返回 **`{ events: [...], history?: [...] }`**，不是数组。

**错误代码（当前）:**

```javascript
const testEvents = store.readPushTestData();
for (const ev of testEvents) { ... }  // TypeError: not iterable
```

**应恢复为（原 server.js 逻辑）:**

```javascript
const demo = readPushTestData(now());
await saveData({
  events: demo.events,
  history: [...(prev.history || []), { action: 'demo', detail: 'load-push-test', ... }]
});
res.json({ ok: true, events: saved.events.length, todayCount: today.length, today });
```

同理 `load-seed` / `clear` 需恢复 **history 审计记录** 与 **响应字段**（`events`、`todayCount`），否则现有测试与前端联调脚本会断。

---

#### 3.4 `routes/push.js` 重写时丢失业务约束

| 能力 | 重构前 `server.js` | 重构后 `routes/push.js` | spec 要求 |
|------|---------------------|---------------------------|-----------|
| 读取 body 的 `enabled` / `webhook_url` / `chat_id` | ✅ `mergeFeishuConfig` | ❌ 忽略 body | — |
| `persist` 写回配置 | ✅ | ❌ | — |
| 测试卡标题 | ✅ `【连通性测试】非事项提醒` | ❌ `🔔 提醒系统测试` | v4 spec §0 |
| 使用 `buildFeishuCard` | ✅ | ❌ 手写简易 card | — |
| 未配置时错误文案 | `飞书未配置` | `飞书未启用` | 测试依赖原文案 |

**修复:** 不要「简化重写」；从 `git show 6ef3583:server.js` 原样迁移三个 handler，并继续依赖 `lib/push.js` + `engine.buildFeishuCard`。

---

#### 3.5 路由挂载顺序不规范

```javascript
app.get('*', ...);           // SPA 兜底
// ...
app.use("/api", pushRoutes); // 写在 SPA 兜底之后
app.use("/api", demoRoutes);
```

Express 按注册顺序匹配。当前能工作是因为 `*` 仅处理 GET，但 **不符合惯例**，后续加 middleware 易踩坑。

**修复:** 将 `pushRoutes` / `demoRoutes` 移到 **所有 API 路由定义区末尾、SPA 兜底之前**；`errorHandler` 放在最后。

---

#### 3.6 `vercel.json` 未同步新目录

`includeFiles` 仍只列旧文件，**未包含** `lib/**`、`middleware/**`、`routes/**`。

本地 `require` 链可能能跑，Vercel Serverless 打包存在 **生产 MODULE_NOT_FOUND** 风险。

**修复:** 更新 `vercel.json` → `api/index.js` 的 `includeFiles`，或改为通配 `{lib/**,middleware/**,routes/**,...}`。

---

### P2 — 未完成 / 与 commit message 不符

#### 3.7 前端「农历 / 出生年」仅展示、无表单

Commit `533dc6a` message: *「form has lunar/solar toggle + birth year」*

实际 HEAD：

- ✅ `scheduleMeta()` / `eventCard()` 读取 `calendar`、`birth_year`
- ❌ `eventFormHTML()` **无** 农历/阳历切换、出生年输入
- ❌ 表单 submit 未提交 `calendar` / `birth_year`

工作区正在加 `lunarToSolar`（`app.js` 内联 + `lib/lunar.js` + `engine.js`），但 **未 commit、无测试**。

#### 3.8 年龄计算前后不一致

- 卡片标题: `new Date().getFullYear() - birth_year`（按自然年）
- `scheduleMeta`: `t.getFullYear() - birth_year`（按下次生日年）

生日未过 vs 已过时会差 1 岁，需统一规则。

#### 3.9 文档与代码不一致

- `README.md` 仍写「9 种提醒类型 / 日常提醒系统」
- `docs/superpowers/specs/2026-07-27-reminder-v4-design.md` 写 v4 已落地，但 refactor 测试未绿
- `docs/superpowers/plans/2026-07-27-nudge-v4.0.md` 任务 T1–T4 均未勾选

---

## 4. 根因分析（给 Codex 的改进点）

| 根因 | 说明 |
|------|------|
| **Extract without wire-up** | 把函数/路由移到新文件，但未恢复 `app.use(authMiddleware)` 等关键挂载点 |
| **Rewrite instead of move** | `routes/push.js`、`routes/demo.js` 用「简化版」重写，而非从 git 历史迁移，导致行为与测试/spec 漂移 |
| **未读 store 契约** | 未查看 `readPushTestData()` 返回 `{ events }` 就 `for...of` |
| **未跑测试门禁** | 5 个 commit 连续提交，`npm test` 始终 5 fail |
| **Commit message 超前实现** | 声称表单已完成，实际只改了展示层 |
| **大文件 patch 无验证** | 曾导致 `app.js` 截断、`engine.js` 语法错误 |

---

## 5. 修复清单（建议 Codex 按序执行）

```text
[ ] 1. git 基线：在 fix 分支上工作，不要 push 当前 5 commits 到 main
[ ] 2. server.js：app.use(authMiddleware) 挂回 express.json 之后
[ ] 3. routes/demo.js：按 6ef3583 恢复 demo 三路由的数据结构与响应
[ ] 4. routes/push.js：按 6ef3583 恢复 feishu/serverchan test + send-card
[ ] 5. server.js：调整 push/demo 路由挂载顺序；errorHandler 放最后
[ ] 6. vercel.json：includeFiles 加入 lib/middleware/routes
[ ] 7. npm test → 必须 59/59 全绿后再 commit
[ ] 8. （可选独立 PR）农历：lib/lunar.js + engine + 表单字段 + 单测
[ ] 9. 更新 commit message / plan checkbox，去掉未实现声明
```

**验收命令:**

```bash
npm test                    # 59 pass
node -e "require('./server')"  # 无 throw
node -e "require('./engine')"
# 手动：curl -H "Authorization: Bearer dead.beef" http://localhost:3333/api/events → 401
```

---

## 6. 什么做对了（避免全盘否定）

- 抽出 `lib/push.js`、`middleware/auth.js` 的方向正确，利于 Vercel 多实例
- 启动时 `TOKEN_SECRET` 默认值 warn 有价值
- 前端卡片倒计时 / 农历 badge 信息架构合理
- `asyncHandler` + 全局 `errorHandler` 骨架可用（但 server 内大量路由仍 try/catch，尚未统一）

---

## 7. 审查结论

| 维度 | 判定 |
|------|------|
| 能否合并 main | ❌ 否 |
| 能否部署生产 | ❌ 否（auth 缺失 + Vercel includeFiles） |
| 测试 | ❌ 54/59 |
| 重构完成度 | ~60%（文件有了，行为未对齐） |

**一句话:** Codex 完成了「目录结构模块化」，未完成「行为等价迁移 + 测试门禁」；并引入 **API 无认证** 的严重回归。请按第 5 节清单修复，**以 `npm test` 全绿为唯一合并条件**。

---

*报告生成: Cursor Agent 审查 · 项目路径 `outputs/reminder` · 对照 spec `docs/superpowers/specs/2026-07-27-reminder-v4-design.md`*
