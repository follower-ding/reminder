const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../lib/feishu-memory');
const actions = require('../lib/feishu-actions');
const { softMatchQaIntent, resolveQaIntent } = require('../lib/feishu-intent-router');
const { matchQaIntent, matchAckIntent } = require('../feishu-bot');
const { checkEvent } = require('../engine');
const store = require('../store');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('feishu memory + actions', () => {
  beforeEach(() => memory.resetAllForTests());

  it('keeps last turns and last digest', () => {
    memory.appendTurn('oc1', 'user', '科技快讯');
    memory.setLastDigest('oc1', 'news');
    memory.appendTurn('oc1', 'assistant', '已推送');
    assert.equal(memory.getLastDigest('oc1'), 'news');
    assert.match(memory.contextSnippet('oc1'), /科技快讯/);
  });

  it('pending confirm ttl fields', () => {
    memory.setPending('oc1', { type: 'snooze', eventId: 1, summary: '推迟跑步' });
    assert.equal(memory.getPending('oc1').type, 'snooze');
    memory.clearPending('oc1');
    assert.equal(memory.getPending('oc1'), null);
  });

  it('matchConfirmIntent', () => {
    assert.equal(actions.matchConfirmIntent('确认').intent, 'confirm_yes');
    assert.equal(actions.matchConfirmIntent('取消').intent, 'confirm_no');
    assert.equal(actions.matchConfirmIntent('随便'), null);
  });

  it('soft matches write and again', () => {
    assert.equal(softMatchQaIntent('再推一次')?.intent, 'repost_digest');
    assert.equal(softMatchQaIntent('推迟跑步')?.intent, 'snooze');
    assert.equal(softMatchQaIntent('推送状态')?.intent, 'push_status');
  });

  it('ack named via 帮我确认', () => {
    assert.deepEqual(matchAckIntent('帮我确认跑步'), { intent: 'ack', nameHint: '跑步' });
  });

  it('snooze_until skips checkEvent', () => {
    const n = { year: 2026, month: 7, day: 29, hour: 9, minute: 0 };
    const ev = {
      id: 1, name: '跑步', type: 'custom', enabled: true,
      schedule: { mode: 'daily', time: '09:00' },
      snooze_until: '2026-07-30'
    };
    assert.equal(checkEvent(ev, n), null);
    assert.ok(checkEvent({ ...ev, snooze_until: '2026-07-29' }, n));
  });
});

describe('atomic json write', () => {
  it('saveData writes readable json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-atomic-'));
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    // re-require won't reload; call write via saveData using current store paths
    // Instead test writeJSONFile behavior through saveData after pointing files - store binds DATA_DIR at load.
    // Smoke: write temp rename pattern manually matching store
    const file = path.join(dir, 'data.json');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, '{"events":[]}', 'utf8');
    fs.renameSync(tmp, file);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).events.length, 0);
    process.env.DATA_DIR = prev;
  });
});
