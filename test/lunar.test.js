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

  it('same solar MD maps to different lunar across years', () => {
    const { solarToLunar } = require('../lib/lunar');
    const a = solarToLunar(new Date(2000, 10, 27, 12));
    const b = solarToLunar(new Date(2026, 10, 27, 12));
    assert.equal(a.label, '冬月初二');
    assert.equal(b.month, 10);
    assert.equal(b.day, 19);
    assert.notEqual(a.label, b.label);
  });
});
