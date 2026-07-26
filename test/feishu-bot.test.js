const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  matchAckIntent,
  matchBindIntent,
  matchQaIntent,
  parseMessageText,
  stripMentions,
  handleEvent,
  sendInteractiveCard,
  extractChatId
} = require('../feishu-bot');
const { helpText } = require('../feishu-event-http');

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

  it('strips @mention so group「@Nudge 收到」acks', () => {
    const text = parseMessageText({
      event: {
        message: {
          message_type: 'text',
          content: JSON.stringify({ text: '@_user_1 收到' })
        }
      }
    });
    assert.equal(text, '收到');
    assert.deepEqual(matchAckIntent(text), { intent: 'ack', nameHint: null });
    assert.deepEqual(matchAckIntent(stripMentions('@Nudge 收到')), {
      intent: 'ack',
      nameHint: null
    });
  });

  it('returns challenge for url verification', async () => {
    const r = await handleEvent({ type: 'url_verification', challenge: 'abc', token: '' });
    assert.equal(r.http, 200);
    assert.equal(r.json.challenge, 'abc');
  });

  it('sendInteractiveCard requires chat_id', async () => {
    const r = await sendInteractiveCard('', { card: { elements: [] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /chat_id|receive_id/);
  });

  it('bind intent and nested chat_id extraction', async () => {
    assert.equal(matchBindIntent('绑定'), true);
    assert.equal(matchBindIntent('收到'), false);
    assert.equal(
      extractChatId({ event: { message: { chat_id: 'oc_abc', message_id: 'om_1', content: '{}' } } }),
      'oc_abc'
    );
    let bound = null;
    const r = await handleEvent(
      {
        header: { event_type: 'im.message.receive_v1' },
        event: {
          message: {
            message_id: 'om_bind',
            chat_id: 'oc_group1',
            message_type: 'text',
            content: JSON.stringify({ text: '@_user_1 绑定' })
          }
        }
      },
      {
        bindChat: async (id) => {
          bound = id;
          return { chat_id: id };
        }
      }
    );
    assert.equal(r.json.action, 'bind');
    assert.equal(bound, 'oc_group1');
    assert.equal(r.json.chat_id, 'oc_group1');
  });

  it('matches structured qa intents', () => {
    assert.deepEqual(matchQaIntent('帮助'), { intent: 'help' });
    assert.deepEqual(matchQaIntent('今天学什么'), { intent: 'learning' });
    assert.deepEqual(matchQaIntent('GitHub 有啥'), { intent: 'github' });
    assert.deepEqual(matchQaIntent('科技快讯'), { intent: 'news' });
    assert.deepEqual(matchQaIntent('今天事项'), { intent: 'today' });
    assert.deepEqual(matchQaIntent('经期要注意什么'), { intent: 'period' });
    assert.equal(matchQaIntent('随便聊聊天气'), null);
    assert.match(helpText('Nudge'), /今天学什么/);
  });

  it('routes qa intent to answerQa handler', async () => {
    let got = null;
    const r = await handleEvent(
      {
        header: { event_type: 'im.message.receive_v1' },
        event: {
          message: {
            message_id: 'om_qa',
            message_type: 'text',
            content: JSON.stringify({ text: '今天学什么' })
          }
        }
      },
      {
        answerQa: async (intent) => {
          got = intent;
          return { text: 'lesson ok' };
        }
      }
    );
    assert.equal(got, 'learning');
    assert.equal(r.json.action, 'qa');
    assert.equal(r.json.intent, 'learning');
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
