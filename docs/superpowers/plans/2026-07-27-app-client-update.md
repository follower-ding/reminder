# App Client Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stale Capacitor/PWA UI after deploy by network-first SW, settings「检查并更新」, and login-time version prompt — without re-packaging APK for web changes.

**Architecture:** Server `/api/health.version` is source of truth; client stores `localStorage.nudge_app_version`; `forceAppUpdate()` unregisters SW, clears Cache Storage, reloads with `?_t=`. Banner uses session skip flag.

**Tech Stack:** Vanilla JS (`public/app.js`), Service Worker (`public/sw.js`), Express health endpoint, Capacitor remote WebView.

**Spec:** `docs/superpowers/specs/2026-07-27-app-update-button-design.md`

## Global Constraints

- Bump all version surfaces to **4.1.22** together (`package.json`, `server.js` health, `index.html` asset `?v=`, `sw.js` CACHE_NAME).
- Do not modify `android/` native project.
- API responses must never be written to SW cache.
- Version compare is string equality on `x.y.z` (no semver library).

---

### Task 1: Service Worker network-first + register

**Files:**
- Modify: `public/sw.js`
- Modify: `public/app.js` (register at bottom)
- Modify: `public/index.html` (`?v=4.1.22`)

- [ ] **Step 1: Replace `public/sw.js` with network-first**

```js
const CACHE_NAME = 'nudge-4.1.22';
const PRECACHE = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
```

- [ ] **Step 2: Register SW at end of `public/app.js`**

After `boot();`:

```js
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

- [ ] **Step 3: Bump `public/index.html` asset queries to `4.1.22`**

---

### Task 2: forceAppUpdate + settings button + boot prompt

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css` (update-banner)
- Modify: `server.js` (`version: '4.1.22'`)
- Modify: `package.json` (`"version": "4.1.22"`)

- [ ] **Step 1: Add constants and helpers after `HINT_KEY`**

```js
const VERSION_KEY = "nudge_app_version";
const SKIP_UPDATE_KEY = "nudge_skip_update";

async function forceAppUpdate(targetVersion) {
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) { /* ignore */ }
  if (targetVersion) localStorage.setItem(VERSION_KEY, targetVersion);
  const u = new URL(location.href);
  u.searchParams.set("_t", String(Date.now()));
  location.replace(u.pathname + u.search + (u.hash || ""));
}

async function checkAndApplyUpdate() {
  const health = await api("/health");
  if (health.error || !health.version) {
    toast(health.error || "无法获取版本");
    return;
  }
  const server = String(health.version);
  const local = localStorage.getItem(VERSION_KEY) || "";
  if (local && local === server) {
    toast("已是最新 v" + server);
    return;
  }
  toast("正在更新到 v" + server + "…");
  await forceAppUpdate(server);
}

function showUpdateBanner(serverVersion) {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status");
  bar.innerHTML = `
    <span>发现新版本 v${esc(serverVersion)}</span>
    <span class="update-banner-actions">
      <button type="button" class="btn-primary btn-small" id="update-now">更新</button>
      <button type="button" class="btn-ghost btn-small" id="update-later">稍后</button>
    </span>`;
  const header = document.querySelector(".app-header");
  if (header && header.parentNode) header.insertAdjacentElement("afterend", bar);
  else document.getElementById("app").prepend(bar);
  document.getElementById("update-now").onclick = () => forceAppUpdate(serverVersion);
  document.getElementById("update-later").onclick = () => {
    sessionStorage.setItem(SKIP_UPDATE_KEY, "1");
    bar.remove();
  };
}

async function maybePromptUpdate() {
  if (sessionStorage.getItem(SKIP_UPDATE_KEY) === "1") return;
  try {
    const health = await api("/health");
    const server = health.version ? String(health.version) : "";
    if (!server) return;
    const local = localStorage.getItem(VERSION_KEY);
    if (!local) {
      localStorage.setItem(VERSION_KEY, server);
      return;
    }
    if (local !== server) showUpdateBanner(server);
  } catch (_) { /* ignore */ }
}
```

- [ ] **Step 2: Call `maybePromptUpdate()` from `showApp()`** (fire-and-forget)

```js
function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("user-label").textContent = currentUser?.label || labelFromToken(token) || "";
  renderView(currentView);
  maybePromptUpdate();
}
```

- [ ] **Step 3: In `renderSettings`, add update card after hero**

Insert after hero closing `</div></div>`:

```html
<div class="nudge-card" style="margin-bottom:1rem">
  <h3 style="margin-bottom:.5rem">客户端更新</h3>
  <p class="form-hint">日常推送部署无需重装 App。点下方可清缓存并拉取最新页面。</p>
  <div class="action-btns">
    <button class="btn-primary btn-small" id="btn-check-update" type="button">检查并更新</button>
  </div>
</div>
```

Wire: `document.getElementById("btn-check-update").onclick = () => checkAndApplyUpdate();`

Also add a **强制刷新** path: if user wants to clear even when same version — extend `checkAndApplyUpdate` with optional force via long-press OR second button. Spec says one button that toasts「已是最新」when same — keep that. Add secondary:

```html
<button class="btn-secondary btn-small" id="btn-force-refresh" type="button">强制刷新</button>
```

```js
document.getElementById("btn-force-refresh").onclick = async () => {
  const health = await api("/health");
  await forceAppUpdate(health.version || localStorage.getItem(VERSION_KEY) || "");
};
```

- [ ] **Step 4: Add CSS for `.update-banner`**

```css
.update-banner {
  display: flex; align-items: center; justify-content: space-between; gap: .75rem;
  margin: .65rem 1rem 0; padding: .7rem .9rem;
  background: rgba(15,118,110,.08); border: 1px solid rgba(15,118,110,.18);
  border-radius: 14px; color: var(--teal-deep, #134E4A); font-size: .86rem; font-weight: 600;
}
.update-banner-actions { display: flex; gap: .4rem; flex-shrink: 0; }
```

- [ ] **Step 5: Bump `server.js` health version and `package.json` to 4.1.22**

---

### Task 3: Docs + RELEASE

**Files:**
- Modify: `docs/ANDROID.md`
- Modify: `RELEASE.md`
- Keep: design spec already present

- [ ] **Step 1: Append to ANDROID.md**

```markdown
## 网页更新 vs 重打 APK

| 改动类型 | 要不要重打 APK |
|----------|----------------|
| 服务器上的网页 / API（push 部署） | **不用**。设置 →「检查并更新」，或按启动提示更新 |
| `capacitor.config.json` 的 server.url、图标、原生插件 | **要** `mobile:sync` + `mobile:apk` |

若更新后仍旧：设置里点「强制刷新」；仍不行再清 App 存储或重装。
```

- [ ] **Step 2: RELEASE.md top row for 4.1.22**

`| 4.1.22 | 2026-07-27 | App 检查更新：清 SW 缓存 + 启动版本提示；SW 改网络优先 |`

- [ ] **Step 3: Smoke** — open settings, click 检查并更新; simulate localStorage older version and confirm banner.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| SW network-first, API uncached | T1 |
| forceAppUpdate | T2 |
| Settings 检查并更新 | T2 |
| Boot prompt + 稍后 session skip | T2 |
| Version bump surfaces | T1+T2 |
| ANDROID.md note | T3 |
| No android/ native changes | Global |
