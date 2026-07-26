const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildAckValue, verifyAckSig, buildAckedCard } = require('../engine');
const { handleCardAction } = require('../feishu-event-http');
const store = require('../store');

describe('feishu card ack callback', () => {
  it('buildAckValue signs with verifyAckSig', () => {
    const v = buildAckValue(12, '2026-07-27', 'secret');
    assert.equal(v.action, 'ack');
    assert.equal(v.id, '12');
    assert.equal(v.date, '2026-07-27');
    assert.equal(verifyAckSig(12, '2026-07-27', v.sig, 'secret'), true);
    assert.equal(verifyAckSig(12, '2026-07-27', 'bad', 'secret'), false);
  });

  it('buildAckedCard has success copy', () => {
    const card = buildAckedCard('2026-07-27', ['手机测试'], 'Nudge', 'http://example.com');
    const raw = JSON.stringify(card);
    assert.match(raw, /已确认/);
    assert.match(raw, /手机测试/);
    assert.match(raw, /打开清单/);
  });

  it('handleCardAction rejects bad sig', async () => {
    const r = await handleCardAction({
      action: { value: { action: 'ack', id: '1', date: '2026-07-27', sig: 'nope' } }
    });
    assert.equal(r.toast.type, 'error');
  });

  let createdId;
  before(async () => {
    process.env.TOKEN_SECRET = 'card-ack-test-secret';
    const data = await store.loadData();
    const id = Math.max(0, ...(data.events || []).map((e) => e.id || 0)) + 1;
    createdId = id;
    data.events = [
      ...(data.events || []),
      {
        id,
        name: '卡片确认测',
        enabled: true,
        space: 'task',
        type: 'custom',
        schedule: { mode: 'once', time: '09:00' },
        messages: { default: '测' },
        acks: {}
      }
    ];
    await store.saveData(data);
  });

  after(async () => {
    const data = await store.loadData();
    data.events = (data.events || []).filter((e) => e.id !== createdId);
    await store.saveData(data);
  });

  it('handleCardAction acks and returns updated card', async () => {
    const value = buildAckValue(createdId, '2026-07-27', process.env.TOKEN_SECRET);
    const r = await handleCardAction({ action: { value } });
    assert.equal(r.toast.type, 'success');
    assert.equal(r.card.type, 'raw');
    assert.match(JSON.stringify(r.card.data), /已在飞书确认/);
    const data = await store.loadData();
    const ev = data.events.find((e) => e.id === createdId);
    assert.ok(ev.acks?.['2026-07-27']);
  });
});
