const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  upsertCapsule,
  getPreviousCapsule,
  formatCapsuleHint,
  isCapsuleEligible
} = require('../lib/capsule');
const { checkEvent } = require('../engine');

describe('time capsule', () => {
  it('upserts by year', () => {
    const r = upsertCapsule({ capsules: [] }, { year: 2026, note: '想和你去海边' });
    assert.equal(r.ok, true);
    assert.equal(r.capsules[0].note, '想和你去海边');
    const r2 = upsertCapsule({ capsules: r.capsules }, { year: 2026, note: '改成爬山' });
    assert.equal(r2.capsules.length, 1);
    assert.equal(r2.capsules[0].note, '改成爬山');
  });

  it('finds previous year capsule', () => {
    const ev = {
      capsules: [
        { year: 2025, note: '去年的话' },
        { year: 2024, note: '更早' }
      ]
    };
    assert.equal(getPreviousCapsule(ev, 2026).note, '去年的话');
  });

  it('eligible for birthday/anniversary', () => {
    assert.equal(isCapsuleEligible({ type: 'birthday' }), true);
    assert.equal(isCapsuleEligible({ subtype: 'anniversary', type: 'custom' }), true);
    assert.equal(isCapsuleEligible({ type: 'period' }), false);
  });

  it('checkEvent attaches last-year capsule on the day', () => {
    const ev = {
      type: 'birthday',
      name: '宝宝',
      enabled: true,
      calendar: 'solar',
      schedule: { mode: 'yearly', month: 7, day: 28, time: '09:00' },
      messages: {},
      capsules: [{ year: 2025, note: '去年今天想吃蛋糕' }]
    };
    const hit = checkEvent(ev, { year: 2026, month: 7, day: 28, hour: 9, minute: 0 });
    assert.ok(hit);
    assert.equal(hit.days, 0);
    assert.equal(hit.capsule.note, '去年今天想吃蛋糕');
    assert.match(hit.message, /去年今天想吃蛋糕/);
    assert.match(formatCapsuleHint(hit.capsule, '宝宝'), /宝宝/);
  });
});
