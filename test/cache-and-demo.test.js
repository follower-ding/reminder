/**
 * No process cache; empty list after clear; push-test events fire today.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-cache-'));
process.env.DATA_DIR = tmp;
delete process.env.VERCEL;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

delete require.cache[require.resolve('../store')];
delete require.cache[require.resolve('../server')];
const store = require('../store');
const app = require('../server');

function request(server, method, urlPath, { token, body } = {}) {
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
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('cache + demo push data', () => {
  let server;
  let token;

  before(async () => {
    fs.writeFileSync(path.join(tmp, 'data.json'), JSON.stringify({
      events: [
        { id: 1, type: 'birthday', name: '妈妈', enabled: true, schedule: { mode: 'yearly', month: 8, day: 15 } },
        { id: 2, type: 'anniversary', name: '结婚纪念日', enabled: true, schedule: { mode: 'yearly', month: 10, day: 1 } }
      ],
      history: []
    }));
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(store.DEFAULT_CONFIG));
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('clear demo leaves zero events on disk (no seed revive)', async () => {
    const cleared = await request(server, 'POST', '/api/demo/clear', { token, body: {} });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.events, 0);

    const list = await request(server, 'GET', '/api/events', { token });
    assert.equal(list.body.length, 0);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'data.json'), 'utf8'));
    assert.equal(onDisk.events.length, 0);
  });

  it('load-push-test creates today-active events', async () => {
    const loaded = await request(server, 'POST', '/api/demo/load-push-test', { token, body: {} });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.events, 4);
    assert.ok(loaded.body.todayCount >= 2, 'expected multiple today hits');

    const list = await request(server, 'GET', '/api/events', { token });
    assert.ok(list.body.every(e => String(e.name).includes('【测试】')));

    const dash = await request(server, 'GET', '/api/dashboard', { token });
    assert.ok(dash.body.today.length >= 2);
  });

  it('push/run without channels returns channel errors but counts today', async () => {
    const res = await request(server, 'POST', '/api/push/run', {
      token,
      body: { feishu_enabled: false, serverchan_enabled: false }
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.today >= 1);
    assert.equal(res.body.feishu.ok, false);
    assert.equal(res.body.serverchan.ok, false);
  });

  it('readPushTestData uses provided month/day', () => {
    const d = store.readPushTestData({ month: 7, day: 27 });
    const bday = d.events.find(e => e.id === 9002);
    assert.equal(bday.schedule.month, 7);
    assert.equal(bday.schedule.day, 27);
  });
});
