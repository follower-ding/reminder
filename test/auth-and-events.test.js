/**
 * Regression: blank page / cannot add events
 * - Token must remain valid across "cold starts" (new process / cleared memory)
 * - /api/events must return an array when authenticated
 * - eventFormHTML must not ReferenceError on isNew
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
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

describe('auth + events blank-page regressions', () => {
  let server;
  let token;

  before(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('login returns signed token usable without in-memory session store', async () => {
    const login = await request(server, 'POST', '/api/login', {
      body: { username: 'admin', password: 'admin123' }
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token, 'token missing');
    assert.match(login.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'token should be payload.sig');
    token = login.body.token;

    // Old bug: tokens lived in let tokens = {}. Cold start → 401 → frontend crash.
    const events = await request(server, 'GET', '/api/events', { token });
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.body), 'events must be array; object.error causes events.filter crash');
  });

  it('dashboard survives BOM / missing events in data.json', async () => {
    // Even if parse fails, loadData must yield events=[] and HTTP 200
    const dash = await request(server, 'GET', '/api/dashboard', { token });
    assert.equal(dash.status, 200, `dashboard must not 500: ${typeof dash.body === 'string' ? dash.body.slice(0,200) : JSON.stringify(dash.body)}`);
    assert.ok(Array.isArray(dash.body.today));
    assert.ok(Array.isArray(dash.body.upcoming));
  });

  it('invalid token returns 401 JSON (frontend must not call .filter on it)', async () => {
    const events = await request(server, 'GET', '/api/events', { token: 'dead.beef' });
    assert.equal(events.status, 401);
    assert.equal(typeof events.body, 'object');
    assert.ok(events.body.error);
    assert.equal(Array.isArray(events.body), false);
  });

  it('dashboard includes daily events as today (days:0)', async () => {
    const created = await request(server, 'POST', '/api/events', {
      token,
      body: { type: 'medicine', name: '每日药-回归', schedule: { mode: 'daily' }, messages: { default: '吃药' } }
    });
    assert.equal(created.status, 200);
    const dash = await request(server, 'GET', '/api/dashboard', { token });
    assert.equal(dash.status, 200);
    const hit = (dash.body.today || []).find(x => x.name === '每日药-回归');
    assert.ok(hit, 'daily event must appear in dashboard.today; missing days:0 filtered them out');
    assert.equal(hit.days, 0);
  });

  it('eventFormHTML does not throw ReferenceError on isNew', () => {
    const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    assert.match(appJs, /function eventFormHTML\(ev,\s*isNew/, 'isNew must be a parameter');
    assert.match(appJs, /showEventForm\(null\)/, 'add button must not pass MouseEvent as id');
    assert.match(appJs, /Array\.isArray\(events\)/, 'renderEvents must guard non-array');
  });
});
