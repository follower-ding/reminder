const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../ledger');

describe('push ledger', () => {
  it('dedupes successful pushes', () => {
    let led = [];
    const key = ledger.makeDedupeKey(12, '2026-07-27', '03:25', 'feishu');
    assert.equal(ledger.hasSuccessfulPush(led, key), false);
    led = ledger.appendLedger(led, {
      item_id: 12,
      channel: 'feishu',
      planned_at: '2026-07-27T03:25:00',
      status: 'success',
      dedupe_key: key,
      card_preview: '吃药'
    });
    assert.equal(ledger.hasSuccessfulPush(led, key), true);
    assert.equal(ledger.listByItem(led, 12).length, 1);
  });
});
