const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickComfort, formatComfortReply } = require('../lib/comfort');
const { matchQaIntent } = require('../feishu-bot');
const { answerQa, helpText } = require('../feishu-event-http');

describe('comfort 哄哄她', () => {
  it('picks stable line for same date seed', () => {
    const a = pickComfort({ date: '2026-07-28', context: 'general', offset: 0 });
    const b = pickComfort({ date: '2026-07-28', context: 'general', offset: 0 });
    assert.equal(a.text, b.text);
    const c = pickComfort({ date: '2026-07-28', context: 'general', offset: 1 });
    assert.notEqual(a.text, c.text);
  });

  it('uses period sweet when provided', () => {
    const p = pickComfort({
      date: '2026-07-28',
      context: 'period',
      periodSweet: '今天有我在，你只管休息。',
      offset: 0
    });
    assert.equal(p.context, 'period');
    assert.ok(p.text);
  });

  it('formats reply with title', () => {
    const text = formatComfortReply(
      { title: '哄哄她', text: '慢慢来就好。' },
      '宝宝'
    );
    assert.match(text, /哄哄她/);
    assert.match(text, /宝宝/);
    assert.match(text, /慢慢来/);
  });

  it('matches Feishu comfort intent', () => {
    assert.deepEqual(matchQaIntent('哄哄她'), { intent: 'comfort' });
    assert.deepEqual(matchQaIntent('说句好听的'), { intent: 'comfort' });
    assert.equal(matchQaIntent('随便聊聊天气'), null);
  });

  it('help mentions 哄哄她', () => {
    assert.match(helpText('Nudge'), /哄哄她/);
  });

  it('answerQa comfort returns text', async () => {
    const r = await answerQa('comfort', '哄哄她');
    assert.ok(r.text);
    assert.match(r.text, /💬|哄/);
  });
});
