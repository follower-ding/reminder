# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.

---

**Project:** (pending ui-ux-pro-max)
**Note:** Run ui-ux-pro-max --design-system --persist to populate colors/typography/components.
---

**Active Variant:** Premium Minimal · Muted Sage + Warm Amber  
**Synced:** 2026-07-27

## Design Intent（设计意图 — 项目专属）

**Project:** 日常提醒
**Enhanced:** 2026-07-27
**One-liner:** Apple-like anniversary dashboard：轻量光感、鼠尾草绿 + 暖琥珀、高字阶、干净卡片

**Mood keywords:** elegant, premium minimal, soft, intentional

**Do NOT look like:**
- 紫渐变Hero
- emoji堆砌导航
- 三列复制feature
- Inter默认字体
- 万能表单一次露出全部字段

**Agent rule:** 写 UI 前必读本节；视觉决策与本节冲突时，以本节为准。

---

## Premium Rules（高级感规则）

### Color discipline
- Primary ×1 + Accent ×1；渐变仅 Hero 背景或单个 CTA，禁止全页 rainbow
- 正文浅色模式 `#0F172A`；muted 不低于 `#475569`
- 所有色值来自 `tokens.css`，禁止组件内硬编码 hex

### Typography discipline
- Display 仅 h1–h2；正文用 body font；数据/代码用 mono
- h1: `clamp(2rem, 5vw, 3.5rem)` + `letter-spacing: -0.03em`
- Eyebrow: 12px uppercase, `letter-spacing: 0.08em`

### Spacing discipline
- Landing section 垂直间距 80–128px（token: `--space-3xl` / `--space-4xl`）
- 容器宽度全站统一 `max-w-6xl` 或 `max-w-7xl`

### Surface discipline
- 页面底 → 区块底 → 卡片面 → 交互浮层，最多 4 层

---

## Motion Budget（动效预算）

| Token | Value | Usage |
|-------|-------|-------|
| `--motion-micro` | 150–200ms | hover, focus |
| `--motion-standard` | 300ms | cards, menus |
| `--motion-entrance` | 600–800ms | scroll reveal，每页 ≤3 处 |
| `--motion-ambient` | 8–20s | 背景流动，全页 ≤1 区 |
| `--ease-out-expo` | cubic-bezier(0.16, 1, 0.3, 1) | 入场 |
| `--ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | 按压反馈 |

**Rule:** 动效区域 ≤ 视口 20%；必须支持 `prefers-reduced-motion: reduce`。

---

## Anti-AI-Slop（强制）

> 完整图鉴：`~/.cursor/skills/project-design-system/anti-ai-slop.md`

**本项目额外禁止：**
- 紫渐变Hero
- emoji堆砌导航
- 三列复制feature
- Inter默认字体
- 万能表单一次露出全部字段

**交付前运行：**
```bash
python ~/.cursor/skills/project-design-system/scripts/validate-ui.py --dir src
```

---

## Design System Compliance（Agent 交付模板）

```markdown
## Design System Compliance
- MASTER: design-system/MASTER.md
- Style: [from MASTER Style Guidelines]
- Page override: none | pages/xxx.md
- Tokens: tokens.css
- Anti-AI: passed
- Motion budget: ~__%
```
