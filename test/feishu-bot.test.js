const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchAckIntent, parseMessageText, handleEvent } = require('../feishu-bot');

describe('feishu bot intents', () => {
  it('matches ack phrases', () => {
    assert.deepEqual(matchAckIntent('收到'), { intent: 'ack', nameHint: null });
    assert.deepEqual(matchAckIntent('已收到'), { intent: 'ack', nameHint: null });
    assert.deepEqual(matchAckIntent('收到 跑步'), { intent: 'ack', nameHint: '跑步' });
    assert.equal(matchAckIntent('今天经期要注意什么'), null);
  });

  it('parses text message content', () => {
    const text = parseMessageText({
      event: { message: { message_type: 'text', content: JSON.stringify({ text: '收到' }) } }
    });
    assert.equal(text, '收到');
  });

  it('returns challenge for url verification', async () => {
    const r = await handleEvent({ type: 'url_verification', challenge: 'abc', token: '' });
    assert.equal(r.http, 200);
    assert.equal(r.json.challenge, 'abc');
  });

  it('acks via handler without requiring live Feishu credentials', async () => {
    let called = 'unset';
    const r = await handleEvent(
      {
        header: { event_type: 'im.message.receive_v1' },
        event: {
          message: {
            message_id: 'om_test',
            message_type: 'text',
            content: JSON.stringify({ text: '收到' })
          }
        }
      },
      {
        ackToday: async (hint) => {
          called = hint;
          return { text: 'ok', count: 1 };
        }
      }
    );
    assert.equal(called, null);
    assert.equal(r.json.action, 'ack');
    assert.equal(r.json.count, 1);
  });
});
