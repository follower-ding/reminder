/**
 * Persistence: filesystem backend + postgres detection.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-durable-'));
process.env.DATA_DIR = tmp;
delete process.env.VERCEL;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;

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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('durable store (filesystem backend)', () => {
  let server;
  let token;

  before(async () => {
    fs.writeFileSync(path.join(tmp, 'data.json'), JSON.stringify({
      events: [{ id: 1, type: 'custom', name: '可删事件', enabled: true, schedule: { mode: 'daily' } }],
      history: []
    }));
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
      ...store.DEFAULT_CONFIG,
      feishu: { enabled: true, webhook_url: 'https://example.com/hook' }
    }));
    store.resetCache();

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

  it('health reports durable fs backend', async () => {
    const health = await request(server, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.persistence.backend, 'fs');
    assert.equal(health.body.persistence.durable, true);
  });

  it('delete event survives cache reset (simulates new request path)', async () => {
    const before = await request(server, 'GET', '/api/events', { token });
    assert.ok(before.body.some(e => e.name === '可删事件'));

    const del = await request(server, 'DELETE', '/api/events/1', { token });
    assert.equal(del.status, 200);

    store.resetCache();
    const after = await request(server, 'GET', '/api/events', { token });
    assert.equal(after.body.some(e => e.name === '可删事件'), false);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'data.json'), 'utf8'));
    assert.equal(onDisk.events.some(e => e.name === '可删事件'), false);
  });

  it('feishu url save survives cache reset', async () => {
    const cfg = await request(server, 'GET', '/api/config', { token });
    cfg.body.feishu = { enabled: true, webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/persist-test' };
    const put = await request(server, 'PUT', '/api/config', { token, body: cfg.body });
    assert.equal(put.status, 200);

    store.resetCache();
    const again = await request(server, 'GET', '/api/config', { token });
    assert.equal(again.body.feishu.webhook_url, 'https://open.feishu.cn/open-apis/bot/v2/hook/persist-test');
  });

  it('detectBackend is fs without DATABASE_URL', () => {
    assert.equal(store.detectBackend(), 'fs');
  });
});

describe('backend detection', () => {
  it('VERCEL without DATABASE_URL => ephemeral', () => {
    process.env.VERCEL = '1';
    delete process.env.DATABASE_URL;
    delete require.cache[require.resolve('../store')];
    const s = require('../store');
    assert.equal(s.detectBackend(), 'ephemeral');
    assert.equal(s.persistenceInfo().durable, false);
    delete process.env.VERCEL;
  });

  it('DATABASE_URL => postgres (durable)', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db';
    delete process.env.VERCEL;
    delete require.cache[require.resolve('../store')];
    const s = require('../store');
    assert.equal(s.detectBackend(), 'postgres');
    assert.equal(s.persistenceInfo().durable, true);
    delete process.env.DATABASE_URL;
  });
});
