const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeStreak, isStreakEligible, shiftYmd } = require('../lib/streak');

describe('habit streak', () => {
  it('counts consecutive acks ending today', () => {
    const today = '2026-07-28';
    const acks = {
      '2026-07-26': {},
      '2026-07-27': {},
      '2026-07-28': {}
    };
    const s = computeStreak(acks, today);
    assert.equal(s.days, 3);
    assert.equal(s.active_today, true);
    assert.equal(s.best, 3);
  });

  it('keeps open streak if yesterday acked but not today', () => {
    const s = computeStreak({
      '2026-07-26': {},
      '2026-07-27': {}
    }, '2026-07-28');
    assert.equal(s.days, 2);
    assert.equal(s.active_today, false);
  });

  it('returns 0 when broken', () => {
    const s = computeStreak({
      '2026-07-20': {},
      '2026-07-21': {}
    }, '2026-07-28');
    assert.equal(s.days, 0);
    assert.ok(s.best >= 2);
  });

  it('isStreakEligible for habit / daily custom', () => {
    assert.equal(isStreakEligible({ space: 'habit' }), true);
    assert.equal(isStreakEligible({ type: 'custom', schedule: { mode: 'daily' } }), true);
    assert.equal(isStreakEligible({ type: 'birthday', space: 'moment' }), false);
  });

  it('shiftYmd works across month', () => {
    assert.equal(shiftYmd('2026-08-01', -1), '2026-07-31');
  });
});
