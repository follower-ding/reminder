/**
 * 飞书确认深链 HMAC、待办归档、撤销确认
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  createAckSig,
  verifyAckSig,
  buildAckUrl,
  ackEvent,
  unackEvent,
  isAcked,
  isArchived,
  buildFeishuCard,
  migrateEvent
} = require('../engine');

const app = require('../server');

function request(server, method, urlPath, { token, body, followRedirects = false } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('ack deeplink + archive + unack', () => {
  it('signs and verifies ack HMAC', () => {
    const secret = 'test-secret';
    const sig = createAckSig(12, '2026-07-27', secret);
    assert.ok(sig.length > 10);
    assert.equal(verifyAckSig(12, '2026-07-27', sig, secret), true);
    assert.equal(verifyAckSig(12, '2026-07-27', 'bad', secret), false);
    assert.equal(verifyAckSig(13, '2026-07-27', sig, secret), false);
    const url = buildAckUrl('https://example.com', 12, '2026-07-27', 'feishu', secret);
    assert.match(url, /\/api\/ack\/12\/2026-07-27\//);
    assert.equal(url.includes('&'), false);
    assert.equal(url.includes('?'), false);
  });

  it('archives task on ack and restores on unack', () => {
    let task = migrateEvent({
      id: 1,
      space: 'task',
      name: '买菜',
      enabled: true,
      schedule: { mode: 'once', time: '10:00' },
      acks: {}
    });
    task = ackEvent(task, '2026-07-27', 'feishu');
    assert.equal(isAcked(task, '2026-07-27'), true);
    assert.equal(isArchived(task), true);
    assert.equal(task.enabled, false);

    let habit = migrateEvent({
      space: 'habit',
      name: '跑步',
      enabled: true,
      schedule: { mode: 'daily', time: '07:00' },
      acks: {}
    });
    habit = ackEvent(habit, '2026-07-27', 'feishu');
    assert.equal(isAcked(habit, '2026-07-27'), true);
    assert.equal(isArchived(habit), false);
    assert.equal(habit.enabled, true);

    task = unackEvent(task, '2026-07-27');
    assert.equal(isAcked(task, '2026-07-27'), false);
    assert.equal(isArchived(task), false);
    assert.equal(task.enabled, true);
  });

  it('feishu card uses callback buttons without jump url for ack', () => {
    const { buildAckValue } = require('../engine');
    const value = buildAckValue(9, '2026-07-27', 's');
    const card = buildFeishuCard('2026-07-27', [
      { type: 'custom', name: '吃药', message: '记得吃药', eventId: 9, ackValue: value }
    ], 'Nudge · 今日事项', 'https://example.com');
    const raw = JSON.stringify(card);
    assert.match(raw, /已收到/);
    assert.match(raw, /吃药/);
    assert.match(raw, /"type":"callback"/);
    assert.match(raw, /"action":"ack"/);
    assert.doesNotMatch(raw, /\/api\/ack\/9\//);
    assert.doesNotMatch(raw, /\[已收到\]\(/);
  });

  let server;
  let token;

  before(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const login = await request(server, 'POST', '/api/login', {
      body: { username: 'admin', password: 'admin123' }
    });
    token = login.body.token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/ack rejects missing sig and accepts valid sig', async () => {
    const created = await request(server, 'POST', '/api/events', {
      token,
      body: {
        space: 'task',
        name: '深链归档测',
        schedule: { mode: 'once', time: '09:00' },
        messages: { default: '测' }
      }
    });
    assert.equal(created.status, 200);
    const id = created.body.id;
    const bad = await request(server, 'GET', `/api/ack/${id}/2026-07-27/badsig/feishu`);
    assert.equal(bad.status, 400);
    assert.match(String(bad.body), /确认失败/);

    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const sig = createAckSig(id, day);
    const pathUrl = `/api/ack/${id}/${day}/${encodeURIComponent(sig)}/feishu`;
    assert.equal(pathUrl.includes('&'), false);
    const ok = await request(server, 'GET', pathUrl);
    assert.equal(ok.status, 200);
    assert.match(String(ok.body), /已确认并归档|已确认收到/);

    const detail = await request(server, 'GET', `/api/events/${id}/detail`, { token });
    assert.equal(detail.body.item.archived, true);
    assert.equal(isAcked(detail.body.item, day), true);

    const un = await request(server, 'POST', `/api/events/${id}/unack`, {
      token,
      body: { date: day }
    });
    assert.equal(un.status, 200);
    assert.equal(un.body.item.archived, false);
    assert.equal(isAcked(un.body.item, day), false);
  });
});
