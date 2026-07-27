/**
 * Time capsules — yearly notes on birthday / anniversary.
 * Stored on event as capsules: [{ year, note, at }]
 */

function normalizeCapsules(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => ({
      year: parseInt(c?.year, 10),
      note: String(c?.note || '').trim().slice(0, 500),
      at: c?.at || null
    }))
    .filter((c) => Number.isFinite(c.year) && c.year >= 1900 && c.year <= 2100 && c.note)
    .sort((a, b) => b.year - a.year);
}

function isCapsuleEligible(ev) {
  if (!ev) return false;
  if (ev.type === 'birthday' || ev.subtype === 'birthday') return true;
  if (ev.subtype === 'anniversary') return true;
  if (ev.type === 'custom' && ev.space === 'moment' && ev.schedule?.mode === 'yearly') return true;
  return false;
}

/** Previous year's capsule relative to refYear (default: this calendar year). */
function getPreviousCapsule(ev, refYear) {
  const year = Number(refYear) || new Date().getFullYear();
  const list = normalizeCapsules(ev?.capsules);
  return list.find((c) => c.year === year - 1) || list.find((c) => c.year < year) || null;
}

function getCapsuleForYear(ev, year) {
  const y = Number(year);
  return normalizeCapsules(ev?.capsules).find((c) => c.year === y) || null;
}

function upsertCapsule(ev, { year, note }) {
  const y = parseInt(year, 10);
  const text = String(note || '').trim().slice(0, 500);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) {
    return { ok: false, error: '年份无效' };
  }
  if (!text) return { ok: false, error: '请写一句给未来的话' };
  const list = normalizeCapsules(ev?.capsules).filter((c) => c.year !== y);
  list.push({ year: y, note: text, at: new Date().toISOString() });
  list.sort((a, b) => b.year - a.year);
  return { ok: true, capsules: list, entry: list.find((c) => c.year === y) };
}

function formatCapsuleHint(capsule, name) {
  if (!capsule?.note) return '';
  const who = name ? `「${name}」` : '';
  return `💌 ${capsule.year} 年留给${who || '今天'}的话：${capsule.note}`;
}

module.exports = {
  normalizeCapsules,
  isCapsuleEligible,
  getPreviousCapsule,
  getCapsuleForYear,
  upsertCapsule,
  formatCapsuleHint
};
