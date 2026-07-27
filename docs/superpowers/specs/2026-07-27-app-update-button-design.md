# Nudge App 客户端更新（设置按钮 + 启动检测）设计

**日期:** 2026-07-27  
**状态:** 已确认 · 已实现（见 `docs/superpowers/plans/2026-07-27-app-client-update.md`）  
**背景:** Capacitor APK 壳加载远程 `http://49.235.172.214:9999`；日常 `git push` 部署网页后，手机 App 仍可能显示旧 UI，因 Service Worker 缓存优先。

---

## 问题陈述

1. 用户以为「部署了就要重新打 APK」。实际上改网页内容**不需要**重装；只有改原生壳（`capacitor.config.json` 服务器地址、图标、插件等）才需要 `mobile:sync` + 重打 APK。
2. 当前 `public/sw.js` 使用 **cache-first**（`CACHE_NAME = 'reminder-v3'`），部署新版后仍可能先返回旧 `index.html` / `app.js`。
3. 缺少「清缓存并刷新」入口，以及「发现新版本」提示。

---

## 目标

- 设置页可一键检查/应用更新（清 SW + Cache Storage + 硬刷新）。
- 登录后自动对比服务端版本；有更新时提示，可一键更新或稍后。
- 修正 SW 策略，降低「部署了但看不到新版」的概率。
- **不**为本次功能强制重打 APK（网页部署即可生效；已装旧壳仍可加载新网页）。

## 非目标

- Capacitor Live Update / 应用商店 OTA / 强制升级阻断。
- 改原生壳或服务器 URL。
- 大范围 UI 改版。

---

## 方案（已选）

**版本检测 + 手动刷新**，配合 SW 网络优先。

版本真源：`GET /api/health` → `version`（当前形如 `4.1.21`）。  
本地记录：`localStorage.nudge_app_version`。

---

## 行为规格

### A. Service Worker（`public/sw.js`）

| 资源 | 策略 |
|------|------|
| `/api/*` | 仅网络，不写入 Cache |
| HTML / JS / CSS / 静态资源 | **网络优先**；网络失败再回退 Cache |
| 安装 | 可预缓存关键静态路径；`CACHE_NAME` 含版本后缀，如 `nudge-4.1.22` |
| 激活 | 删除不在白名单的旧 cache |

发版时 bump `CACHE_NAME` 中的版本段，与 health `version` 对齐（或由构建脚本统一；本迭代允许手动同步）。

### B. 公共函数：`forceAppUpdate()`（`public/app.js`）

1. 若存在 `navigator.serviceWorker`：获取 registrations → `unregister()`。
2. 若存在 `caches`：`caches.keys()` → 全部 `delete`。
3. 将 `localStorage.nudge_app_version` 设为即将加载的目标版本（若已知）。
4. `location.reload()`，或跳转到 `/?_t=<timestamp>` 以绕过中间缓存。

设置页按钮与启动提示条共用此函数。

### C. 设置页

在设置 hero 副标题（已有 `v{version}`）下方或旁侧增加卡片/按钮区：

- 文案：当前版本 `vX.Y.Z`；说明「日常部署无需重装 App」。
- 主按钮：**立即更新**（调用 `forceAppUpdate`）。
- 可选次按钮：**检查更新**（先请求 `/api/health`，与本地版本比较；相同则 toast「已是最新」；不同则 toast 后走更新或直接更新）。

本迭代建议：**一个主按钮「检查并更新」**——请求 health → 与本地比 → 相同 toast「已是最新」；不同则执行 `forceAppUpdate`。

### D. 启动自动检测

触发时机：登录成功并进入主界面后（与现有 token 校验成功路径一致），异步执行一次。

1. `api("/health")` 取 `version`。
2. 读 `localStorage.nudge_app_version`：
   - 若本地为空：写入当前服务端版本，**不提示**（首次安装/升级本功能后的基线）。
   - 若本地 ≠ 服务端：显示顶部提示条（非 modal）：「发现新版本 v{server}」+ **更新** + **稍后**。
3. **更新**：`forceAppUpdate(serverVersion)`。
4. **稍后**：关闭提示；写入会话标记（如 `sessionStorage.nudge_skip_update`），本次会话不再弹；下次冷启动再检测。
5. 比较规则：字符串全等即可（版本格式已为 `x.y.z`）；不做 semver 复杂解析，避免误伤。

### E. 版本号同步约定（发版 checklist）

发版部署时至少同步：

- `package.json` → `version`
- `server.js` `/api/health` → `version`
- `public/index.html` 中 `styles.css?v=` / `app.js?v=`
- `public/sw.js` → `CACHE_NAME`

本迭代实现更新能力时，将上述 bump 到同一新小版本（如 `4.1.22`）。

---

## UI 要点

- 提示条：轻量、可关闭；沿用现有 toast / hint-banner 风格，不引入新设计系统页面。
- 设置页按钮：`btn-primary` / `btn-secondary`，与现有「联调」区一致。
- 无障碍：按钮有明确文案；图标按钮需 `aria-label`（本功能以文字按钮为主）。

---

## 验收标准

1. 部署新 `version` 后，已打开的 App：**设置 → 检查并更新** 后页面加载新资源（版本号与 health 一致）。
2. 本地版本落后时，登录进入主界面出现「发现新版本」提示；点「更新」后刷新为新版。
3. 点「稍后」后，同会话内不再重复提示。
4. `/api/*` 响应不被 SW 缓存；断网时静态页仍可尝试回退缓存（尽力而为）。
5. 文档：`docs/ANDROID.md` 补充一小节明「网页更新 vs 重打 APK」。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 旧 SW 仍 cache-first | `forceAppUpdate` 强制 unregister；新 SW 网络优先 |
| health 未 bump 导致检不出更新 | 发版 checklist；设置页仍可强制清缓存刷新 |
| Capacitor WebView HTTP 缓存 | 刷新 URL 加 `_t` query；必要时文档说明清数据 |

---

## 实现范围（文件）

| 文件 | 变更 |
|------|------|
| `public/sw.js` | 网络优先 + 新 CACHE_NAME |
| `public/app.js` | `forceAppUpdate`、设置按钮、启动检测与提示条 |
| `public/index.html` / `styles.css` | 必要时提示条样式；资源 `?v=` bump |
| `server.js` / `package.json` | version bump |
| `docs/ANDROID.md` | 更新说明 |

不改 `android/` 原生工程（除非后续改 server.url）。
