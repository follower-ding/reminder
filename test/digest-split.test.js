const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listSourceDefs, getDigestBundle, clearDigestCache } = require('../digest');

describe('digest split + ai flags', () => {
  it('lists per-source push times falling back to default', () => {
    const defs = listSourceDefs({
      push_time: '07:11',
      ai_summary: true,
      github: { enabled: true, push_time: '08:00', ai: false },
      news: { enabled: false },
      learning: { enabled: true, push_time: '' }
    });
    const gh = defs.find((d) => d.id === 'github');
    const news = defs.find((d) => d.id === 'news');
    const learn = defs.find((d) => d.id === 'learning');
    assert.equal(gh.enabled, true);
    assert.equal(gh.push_time, '08:00');
    assert.equal(gh.ai, false);
    assert.equal(news.enabled, false);
    assert.equal(learn.push_time, '07:11');
    assert.equal(learn.ai, true);
  });

  it('builds separate sections with pushItems', async () => {
    clearDigestCache();
    const bundle = await getDigestBundle({
      digests: {
        enabled: true,
        push_time: '07:11',
        ai_summary: false,
        github: { enabled: false },
        news: { enabled: false },
        learning: { enabled: true, ai: true }
      }
    }, '2026-07-27', { withAI: false });
    assert.equal(bundle.sections.length, 1);
    assert.equal(bundle.sections[0].id, 'learning');
    assert.ok(bundle.sections[0].pushItems.length >= 1);
    assert.match(bundle.sections[0].pushItems[0].message, /学习|番茄/);
  });
});
