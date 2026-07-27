/**
 * Habit ack streak — consecutive calendar days with an ack.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 12);
}

function shiftYmd(ymd, deltaDays) {
  const d = parseYmd(ymd);
  if (!d) return null;
  d.setDate(d.getDate() + deltaDays);
  return ymdFromDate(d);
}

/**
 * @param {Record<string, unknown>|null|undefined} acks
 * @param {string} todayYmd
 * @returns {{ days: number, active_today: boolean, last_ack: string|null, best: number }}
 */
function computeStreak(acks, todayYmd) {
  const keys = Object.keys(acks || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const set = new Set(keys);
  const activeToday = set.has(todayYmd);

  let cursor = activeToday ? todayYmd : shiftYmd(todayYmd, -1);
  let days = 0;
  if (cursor && set.has(cursor)) {
    while (cursor && set.has(cursor)) {
      days += 1;
      cursor = shiftYmd(cursor, -1);
    }
  }

  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    if (prev && k === shiftYmd(prev, 1)) run += 1;
    else run = 1;
    if (run > best) best = run;
    prev = k;
  }
  if (days > best) best = days;

  return {
    days,
    active_today: activeToday,
    last_ack: keys.length ? keys[keys.length - 1] : null,
    best
  };
}

function isStreakEligible(ev) {
  if (!ev) return false;
  if (ev.space === 'habit') return true;
  if (ev.schedule?.mode === 'daily' && ev.type === 'custom') return true;
  return false;
}

function streakLabel(streak) {
  if (!streak || !streak.days) return '';
  if (streak.days === 1) return streak.active_today ? '今天已打卡' : '连续 1 天';
  return `连续 ${streak.days} 天`;
}

module.exports = {
  computeStreak,
  isStreakEligible,
  streakLabel,
  shiftYmd,
  ymdFromDate
};
