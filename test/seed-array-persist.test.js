/**
 * Regression: seed as raw array made events disappear after create
 * (JSON.stringify drops Array.events named property)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-seed-'));
process.env.DATA_DIR = tmp;
process.env.VERCEL = '1';

// Write legacy array seed into DATA_DIR source path simulation:
// server copies from __dirname/seed — we inject array into DATA_FILE directly
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

describe('legacy array seed + event persistence', () => {
  let server;
  let token;

  before(async () => {
    // Simulate Vercel cold start that copied a raw-array seed into data.json
    fs.writeFileSync(path.join(tmp, 'data.json'), JSON.stringify([
      { id: 1, type: 'custom', name: '旧种子', enabled: true, schedule: { mode: 'daily' } }
    ]), 'utf8');
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
      feishu: { enabled: false, webhook_url: '' },
      serverchan: { enabled: false, sendkey: '' },
      check_times: ['09:00'],
      timezone: 'Asia/Shanghai',
      users: { admin: { password: 'admin123', label: '管理员' } }
    }), 'utf8');

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

  it('lists events from legacy array seed (not empty)', async () => {
    const events = await request(server, 'GET', '/api/events', { token });
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.body));
    assert.equal(events.body.length, 1);
    assert.equal(events.body[0].name, '旧种子');
  });

  it('create persists and is visible on subsequent GET', async () => {
    const name = '新事件-' + Date.now();
    const created = await request(server, 'POST', '/api/events', {
      token,
      body: { type: 'custom', name, schedule: { mode: 'daily' } }
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.name, name);

    const events = await request(server, 'GET', '/api/events', { token });
    assert.equal(events.status, 200);
    assert.ok(events.body.some(e => e.name === name), 'created event must appear in list');
    assert.ok(events.body.some(e => e.name === '旧种子'), 'seed event must remain');

    // on-disk must be object form, not raw array
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'data.json'), 'utf8'));
    assert.equal(Array.isArray(raw), false);
    assert.ok(Array.isArray(raw.events));
    assert.ok(raw.events.length >= 2);
  });

  it('feishu test accepts webhook from body without prior save', async () => {
    const res = await request(server, 'POST', '/api/feishu/test', {
      token,
      body: { enabled: true, webhook_url: '', persist: false }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error || '', /飞书未配置/);
  });
});
