/**
 * Push ledger — dedupe + per-item history.
 */
function emptyLedger() {
  return [];
}

function normalizeLedger(raw) {
  return Array.isArray(raw) ? raw : [];
}

function makeDedupeKey(itemId, dateYmd, timeHHMM, channel) {
  return `item:${itemId}:${dateYmd}:${timeHHMM}:${channel}`;
}

function hasSuccessfulPush(ledger, dedupeKey) {
  return (ledger || []).some((e) => e.dedupe_key === dedupeKey && e.status === 'success');
}

function nextLedgerId(ledger) {
  return ledger.length ? Math.max(...ledger.map((x) => x.id)) + 1 : 1;
}

function appendLedger(ledger, entry) {
  const list = normalizeLedger(ledger);
  const row = {
    id: nextLedgerId(list),
    item_id: entry.item_id,
    channel: entry.channel,
    planned_at: entry.planned_at,
    sent_at: entry.sent_at || new Date().toISOString(),
    status: entry.status || 'success',
    dedupe_key: entry.dedupe_key,
    card_preview: entry.card_preview || '',
    error: entry.error || null
  };
  list.push(row);
  return list.slice(-500);
}

function listByItem(ledger, itemId, limit = 50) {
  return normalizeLedger(ledger)
    .filter((e) => e.item_id === itemId)
    .sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''))
    .slice(0, limit);
}

function listToday(ledger, dateYmd, limit = 100) {
  return normalizeLedger(ledger)
    .filter((e) => (e.planned_at || e.sent_at || '').startsWith(dateYmd) || (e.dedupe_key || '').includes(`:${dateYmd}:`))
    .sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''))
    .slice(0, limit);
}

module.exports = {
  emptyLedger,
  normalizeLedger,
  makeDedupeKey,
  hasSuccessfulPush,
  appendLedger,
  listByItem,
  listToday,
  nextLedgerId
};
