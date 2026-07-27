/**
 * Nudge — 演示 / 推送联调数据路由
 */
const { Router } = require('express');
const store = require('../store');
const { asyncHandler } = require('../middleware/error');

const router = Router();

router.post('/demo/load-push-test', asyncHandler(async (req, res) => {
  const data = await store.loadData();
  const testEvents = store.readPushTestData().events || [];
  for (const ev of testEvents) {
    const existing = data.events.find(e => e.id === ev.id);
    if (!existing) data.events.push(ev);
  }
  data.events.sort((a, b) => a.id - b.id);
  await store.saveData(data);
  const todayActive = testEvents.filter(function(e) { var s = e.schedule || {}; return s.mode === "daily" || (s.month === new Date().getMonth() + 1 && s.day === new Date().getDate()); });
  res.json({ ok: true, events: testEvents.length, todayCount: todayActive.length });
}));

router.post('/demo/load-seed', asyncHandler(async (req, res) => {
  const data = await store.loadData();
  const seed = store.readSeedData().events || [];
  for (const ev of seed) {
    if (!data.events.find(e => e.id === ev.id)) data.events.push(ev);
  }
  data.events.sort((a, b) => a.id - b.id);
  await store.saveData(data);
  res.json({ ok: true, count: seed.length });
}));

router.post('/demo/clear', asyncHandler(async (req, res) => {
  await store.saveData({ events: [], history: [] });
  res.json({ ok: true, events: 0 });
}));

module.exports = router;