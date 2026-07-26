const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateEvent,
  matchesPushWindow,
  predictPeriod,
  checkEvent,
  normalizeEventInput,
  buildFeishuCard,
  logPeriodStart
} = require('../engine');

describe('scheme B engine', () => {
  it('migrates legacy types to custom/birthday/period', () => {
    assert.equal(migrateEvent({ type: 'medicine', schedule: {} }).type, 'custom');
    assert.equal(migrateEvent({ type: 'medicine', schedule: {} }).schedule.mode, 'daily');
    assert.equal(migrateEvent({ type: 'anniversary', schedule: {} }).type, 'custom');
    assert.equal(migrateEvent({ type: 'birthday', schedule: {} }).type, 'birthday');
  });

  it('matches push window by minute (not whole hour)', () => {
    const ev = { schedule: { time: '08:30' } };
    assert.equal(matchesPushWindow(ev, { hour: 8, minute: 30 }, '09:00'), true);
    assert.equal(matchesPushWindow(ev, { hour: 8, minute: 34 }, '09:00'), true);
    assert.equal(matchesPushWindow(ev, { hour: 8, minute: 0 }, '09:00'), false);
    assert.equal(matchesPushWindow(ev, { hour: 9, minute: 0 }, '09:00'), false);
    assert.equal(matchesPushWindow(ev, { hour: 9, minute: 0 }, '09:00', { ignoreTime: true }), true);
  });

  it('catchUp allows push any time after planned (ledger dedupes)', () => {
    const ev = { schedule: { time: '03:48' } };
    assert.equal(matchesPushWindow(ev, { hour: 3, minute: 40 }, '09:00', { catchUp: true }), false);
    assert.equal(matchesPushWindow(ev, { hour: 3, minute: 48 }, '09:00', { catchUp: true }), true);
    assert.equal(matchesPushWindow(ev, { hour: 4, minute: 10 }, '09:00', { catchUp: true }), true);
  });

  it('predicts period from history', () => {
    const pred = predictPeriod({
      last_start: '2026-06-01',
      cycle_history: ['2026-05-04', '2026-06-01'],
      cycle_length: 28,
      period_length: 5
    }, { year: 2026, month: 6, day: 20 });
    assert.ok(pred);
    assert.equal(pred.cycle_length, 28);
    assert.ok(pred.days_to_next >= 0);
    assert.equal(pred.confidence, 'medium');
  });

  it('checks daily custom with time', () => {
    const r = checkEvent({
      type: 'custom',
      name: '学习',
      enabled: true,
      schedule: { mode: 'daily', time: '08:00' },
      messages: { default: '读书' }
    }, { year: 2026, month: 7, day: 27, hour: 8, minute: 0 });
    assert.equal(r.days, 0);
    assert.equal(r.message, '读书');
  });

  it('normalizes event input to three types', () => {
    const n = normalizeEventInput({ type: 'medicine', name: '药', schedule: { mode: 'daily', time: '9:5' } });
    assert.equal(n.type, 'custom');
    assert.equal(n.schedule.time, '09:05');
  });

  it('logs period start into history', () => {
    const ev = logPeriodStart({
      type: 'period',
      name: '经期',
      schedule: { cycle_history: ['2026-06-01'], last_start: '2026-06-01', cycle_length: 28 }
    }, '2026-06-29');
    assert.deepEqual(ev.schedule.cycle_history, ['2026-06-01', '2026-06-29']);
    assert.equal(ev.schedule.cycle_length, 28);
  });

  it('builds feishu card with sections', () => {
    const card = buildFeishuCard('2026-07-27', [
      { type: 'birthday', message: '生日快乐' },
      { kind: 'digest', message: 'GitHub 热门' }
    ], '测试');
    assert.equal(card.msg_type, 'interactive');
    assert.ok(card.card.header.template);
    assert.ok(JSON.stringify(card).includes('生日') || JSON.stringify(card).includes('热点'));
  });

  it('migrates to space model and ack', () => {
    const { isAcked, ackEvent } = require('../engine');
    assert.equal(migrateEvent({ type: 'birthday', schedule: {} }).space, 'moment');
    assert.equal(migrateEvent({ type: 'custom', category: 'temporary', schedule: {} }).space, 'task');
    assert.equal(migrateEvent({ type: 'medicine', schedule: {} }).space, 'habit');
    assert.equal(migrateEvent({ type: 'anniversary', schedule: {} }).space, 'moment');
    const habit = normalizeEventInput({ space: 'habit', name: '学', schedule: { mode: 'daily', time: '08:00' } });
    assert.equal(habit.space, 'habit');
    assert.equal(habit.type, 'custom');
    const birthday = normalizeEventInput({ space: 'moment', subtype: 'birthday', name: '妈', schedule: { month: 5, day: 1, time: '09:00' } });
    assert.equal(birthday.type, 'birthday');
    let ev = { type: 'custom', name: 'x', schedule: { mode: 'daily' }, acks: {} };
    assert.equal(isAcked(ev, '2026-07-27'), false);
    ev = ackEvent(ev, '2026-07-27', 'app');
    assert.equal(isAcked(ev, '2026-07-27'), true);
    assert.equal(ev.acks['2026-07-27'].via, 'app');
  });
});
