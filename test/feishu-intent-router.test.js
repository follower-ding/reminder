const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  softMatchQaIntent,
  parseRouteJson,
  normalizeRouted,
  resolveQaIntent,
  INTENT_CATALOG
} = require('../lib/feishu-intent-router');
const { matchQaIntent } = require('../feishu-bot');

describe('feishu intent router', () => {
  it('has extensible catalog', () => {
    assert.ok(INTENT_CATALOG.some((x) => x.id === 'birthdays'));
    assert.ok(INTENT_CATALOG.some((x) => x.id === 'repost_digest'));
  });

  it('soft-matches natural paraphrases', () => {
    assert.deepEqual(softMatchQaIntent('帮我看看最近谁过生日'), {
      intent: 'birthdays',
      via: 'soft'
    });
    assert.equal(softMatchQaIntent('这周有什么安排')?.intent, 'upcoming');
    assert.equal(softMatchQaIntent('把热点再发一遍')?.intent, 'repost_digest');
    assert.equal(softMatchQaIntent('换点学习资料')?.intent, 'rotate_learning');
    assert.equal(softMatchQaIntent('随便聊聊天气'), null);
  });

  it('parses LLM route json', () => {
    const r = parseRouteJson('{"intent":"birthdays","source":null,"confidence":0.9}');
    assert.equal(r.intent, 'birthdays');
    assert.equal(r.confidence, 0.9);
    assert.equal(parseRouteJson('{"intent":"nope"}'), null);
    assert.equal(
      normalizeRouted({ intent: 'chat', confidence: 0.9 }, 'llm'),
      null
    );
    assert.deepEqual(
      normalizeRouted({ intent: 'repost_digest', source: null, confidence: 0.8 }, 'llm'),
      { intent: 'repost_digest', source: 'news', via: 'llm' }
    );
  });

  it('resolve prefers exact then soft without llm', async () => {
    const exact = await resolveQaIntent('生日', matchQaIntent, { useLlm: false });
    assert.equal(exact.intent, 'birthdays');
    assert.equal(exact.via, 'exact');

    const soft = await resolveQaIntent('帮我看看最近有没有人生日', matchQaIntent, { useLlm: false });
    assert.equal(soft.intent, 'birthdays');
    assert.equal(soft.via, 'soft');

    const none = await resolveQaIntent('今天心情怎么样呀', matchQaIntent, { useLlm: false });
    assert.equal(none, null);
  });
});
