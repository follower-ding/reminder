/**
 * Lunar calendar conversion smoke tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lunarToSolar } = require('../lib/lunar');
const engine = require('../engine');

describe('lunar calendar', () => {
  it('converts 2026 mid-autumn (lunar 8/15) to a Date', () => {
    const d = lunarToSolar(8, 15, 2026);
    assert.ok(d instanceof Date);
    assert.equal(d.getFullYear(), 2026);
  });

  it('checkEvent uses lunar calendar for yearly birthday', () => {
    const d = lunarToSolar(8, 15, 2026);
    assert.ok(d);
    const n = {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: 9,
      minute: 0
    };
    const ev = {
      id: 1,
      type: 'birthday',
      space: 'moment',
      subtype: 'birthday',
      name: '中秋生日',
      enabled: true,
      calendar: 'lunar',
      birth_year: 1990,
      remind_ahead: 0,
      schedule: { mode: 'yearly', month: 8, day: 15, time: '09:00' },
      messages: {}
    };
    const hit = engine.checkEvent(ev, n);
    assert.ok(hit);
    assert.equal(hit.active, true);
    assert.equal(hit.days, 0);
  });

  it('normalizeEventInput keeps calendar and birth_year', () => {
    const out = engine.normalizeEventInput({
      space: 'moment',
      subtype: 'birthday',
      name: '妈妈',
      calendar: 'lunar',
      birth_year: 1965,
      schedule: { mode: 'yearly', month: 8, day: 15, time: '09:00' }
    });
    assert.equal(out.calendar, 'lunar');
    assert.equal(out.birth_year, 1965);
    assert.equal(out.type, 'birthday');
  });

  it('solarToLunar returns month/day for a Gregorian date', () => {
    const { solarToLunar } = require('../lib/lunar');
    const r = solarToLunar(new Date(2026, 2, 4)); // 2026-03-04
    assert.ok(r);
    assert.ok(r.month >= 1 && r.month <= 12);
    assert.ok(r.day >= 1 && r.day <= 30);
    assert.match(r.label, /月/);
  });

  it('2000-11-27 solar maps to 冬月初二', () => {
    const { solarToLunar, lunarToSolar, formatLunar } = require('../lib/lunar');
    const r = solarToLunar(new Date(2000, 10, 27, 12));
    assert.equal(r.month, 11);
    assert.equal(r.day, 2);
    assert.equal(r.label, '冬月初二');
    assert.equal(formatLunar(11, 2), '冬月初二');
    const back = lunarToSolar(11, 2, 2000);
    assert.ok(back);
    assert.equal(back.getFullYear(), 2000);
    assert.equal(back.getMonth() + 1, 11);
    assert.equal(back.getDate(), 27);
  });

  it('1993-05-16 maps to leap month 闰三月廿五', () => {
    const { solarToLunar, lunarToSolar, formatLunar } = require('../lib/lunar');
    const r = solarToLunar(new Date(1993, 4, 16, 12));
    assert.ok(r);
    assert.equal(r.month, 3);
    assert.equal(r.day, 25);
    assert.equal(r.leap, true);
    assert.equal(r.label, '闰三月廿五');
    assert.equal(formatLunar(3, 25, true), '闰三月廿五');
    const back = lunarToSolar(3, 25, 1993, true);
    assert.ok(back);
    assert.equal(back.getFullYear(), 1993);
    assert.equal(back.getMonth() + 1, 5);
    assert.equal(back.getDate(), 16);
  });

  it('birth_date solar converts to lunar birthday (冬月初二 → 2026-12-10)', () => {
    const { solarToLunar, lunarToSolar } = require('../lib/lunar');
    const out = engine.normalizeEventInput({
      space: 'moment',
      subtype: 'birthday',
      name: '宝宝',
      birth_date: '2000-11-27',
      schedule: { time: '09:00' },
      remind_ahead: 3
    });
    assert.equal(out.calendar, 'lunar');
    assert.equal(out.birth_year, 2000);
    assert.equal(out.birth_solar, '2000-11-27');
    assert.equal(out.schedule.month, 11);
    assert.equal(out.schedule.day, 2);
    assert.equal(out.schedule.leap_month, false);
    const lun = solarToLunar(new Date(2000, 10, 27, 12));
    assert.equal(lun.label, '冬月初二');
    const y2026 = lunarToSolar(out.schedule.month, out.schedule.day, 2026, false);
    assert.ok(y2026);
    assert.equal(y2026.getFullYear(), 2026);
    assert.equal(y2026.getMonth() + 1, 12);
    assert.equal(y2026.getDate(), 10);
  });

  it('birth_date with leap month saves leap_month flag', () => {
    const out = engine.normalizeEventInput({
      space: 'moment',
      subtype: 'birthday',
      name: 'iu',
      birth_date: '1993-05-16',
      schedule: { time: '09:00' }
    });
    assert.equal(out.calendar, 'lunar');
    assert.equal(out.schedule.month, 3);
    assert.equal(out.schedule.day, 25);
    assert.equal(out.schedule.leap_month, true);
    assert.equal(out.birth_solar, '1993-05-16');
  });
});
