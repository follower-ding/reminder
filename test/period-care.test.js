const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPeriodCare,
  formatCarePushMessage,
  formatCareFeishuBlock,
  buildCycleTimeline
} = require('../lib/period-care');
const { checkEvent, buildFeishuCard } = require('../engine');

describe('period care packs', () => {
  it('returns day 1–5 packs with disclaimer', () => {
    for (let d = 1; d <= 5; d++) {
      const care = getPeriodCare(d, { periodLength: 5, phase: 'period' });
      assert.equal(care.day, d);
      assert.equal(care.phase, 'period');
      assert.ok(care.sweet);
      assert.ok(care.notes.length);
      assert.ok(care.disclaimer.includes('非医疗'));
    }
  });

  it('formats push and feishu blocks', () => {
    const care = getPeriodCare(2, { periodLength: 5 });
    const push = formatCarePushMessage(care, '宝宝');
    assert.match(push, /第 2 天/);
    assert.match(push, /宝宝/);
    const block = formatCareFeishuBlock(care);
    assert.match(block, /第二天/);
    assert.match(block, /少碰/);
  });

  it('builds cycle timeline with active menses', () => {
    const tl = buildCycleTimeline({
      cycle_length: 28,
      period_length: 5,
      day_in_cycle: 2,
      in_period: true,
      in_ovulation: false
    });
    assert.equal(tl.active, 'menses');
    assert.equal(tl.phases.length, 4);
    assert.ok(tl.position > 0 && tl.position < 1);
  });

  it('checkEvent attaches care during period', () => {
    const r = checkEvent({
      type: 'period',
      name: '经期',
      enabled: true,
      schedule: {
        mode: 'cycle',
        last_start: '2026-07-26',
        cycle_length: 28,
        period_length: 5,
        time: '09:00',
        cycle_history: ['2026-06-28', '2026-07-26']
      },
      messages: {}
    }, { year: 2026, month: 7, day: 27, hour: 9, minute: 0 });
    assert.ok(r);
    assert.equal(r.care.day, 2);
    assert.match(r.message, /第 2 天|第二天|好好被照顾/);
  });

  it('feishu card uses 经期关怀 section with care block', () => {
    const care = getPeriodCare(1, { periodLength: 5 });
    const card = buildFeishuCard('2026-07-28', [{
      type: 'period',
      name: '经期',
      message: formatCarePushMessage(care, '经期'),
      care
    }], '日常提醒');
    const text = JSON.stringify(card);
    assert.match(text, /经期关怀/);
    assert.match(text, /第一天/);
  });
});
