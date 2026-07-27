/**
 * Nudge — 演示 / 推送联调数据路由（行为对齐重构前 server.js）
 */
const { Router } = require('express');
const store = require('../store');
const engine = require('../engine');
const { asyncHandler } = require('../middleware/error');

const router = Router();

function dateStr(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextId(arr) {
  return (arr || []).reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
}

function nowParts() {
  const d = new Date();
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes()
  };
}

router.post('/demo/load-push-test', asyncHandler(async (req, res) => {
  const n = nowParts();
  const demo = store.readPushTestData(n);
  const prev = await store.loadData();
  const saved = await store.saveData({
    events: demo.events,
    history: [
      ...(prev.history || []),
      { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'load-push-test', date: dateStr(), ts: Date.now() }
    ]
  });
  const today = (saved.events || [])
    .map((ev) => engine.checkEvent(ev, n))
    .filter((r) => r && r.active && r.days === 0);
  res.json({ ok: true, events: saved.events.length, todayCount: today.length, today });
}));

router.post('/demo/load-seed', asyncHandler(async (req, res) => {
  const seed = store.readSeedData();
  const prev = await store.loadData();
  const saved = await store.saveData({
    events: seed.events,
    history: [
      ...(prev.history || []),
      { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'load-seed', date: dateStr(), ts: Date.now() }
    ]
  });
  res.json({ ok: true, events: saved.events.length });
}));

router.post('/demo/clear', asyncHandler(async (req, res) => {
  const prev = await store.loadData();
  await store.saveData({
    events: [],
    history: [
      ...(prev.history || []),
      { id: nextId(prev.history || []), eventId: 0, action: 'demo', detail: 'clear-all', date: dateStr(), ts: Date.now() }
    ]
  });
  res.json({ ok: true, events: 0 });
}));

module.exports = router;
