const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatGithubArticle, formatNewsArticle, buildSourceArticlePush } = require('../digest-articles');
const { buildFeishuCard } = require('../engine');
const { getDigestBundle, clearDigestCache } = require('../digest');

describe('github / news article templates', () => {
  const sampleGh = [
    {
      title: 'owner/cool-repo',
      desc: 'A cool open source tool',
      blurb: '实用开源工具，值得扫一眼 README',
      why: '适合做效率工具的开发者跟进',
      meta: '★ 1200 · TypeScript',
      url: 'https://github.com/owner/cool-repo'
    }
  ];

  it('formats GitHub article with clear sections', () => {
    const md = formatGithubArticle(sampleGh, '2026-07-27');
    assert.match(md, /今日精选 · GitHub 热门/);
    assert.match(md, /一句话/);
    assert.match(md, /为什么值得看/);
    assert.match(md, /打开/);
    assert.match(md, /cool-repo/);
  });

  it('formats news article with clear sections', () => {
    const md = formatNewsArticle([{
      title: 'Some AI news',
      desc: 'short',
      blurb: '一条科技向快讯导读',
      why: '跟开发者工具相关',
      meta: '新闻',
      url: 'https://example.com/n'
    }], '2026-07-27');
    assert.match(md, /今日精选 · 科技快讯/);
    assert.match(md, /导读|一句话/);
    assert.match(md, /为什么值得看/);
    assert.match(md, /打开/);
  });

  it('feishu card uses article body without 每日热点 bullets', () => {
    const { pushItem } = buildSourceArticlePush('github', sampleGh, '2026-07-27');
    const card = buildFeishuCard('2026-07-27', [pushItem], 'Nudge · GitHub 热门', 'http://example.com');
    const raw = JSON.stringify(card);
    assert.match(raw, /今日开源精选/);
    assert.match(raw, /为什么值得看/);
    assert.doesNotMatch(raw, /每日热点/);
    assert.doesNotMatch(raw, /• 🔥/);
  });

  it('bundle github section emits one article push item', async () => {
    clearDigestCache();
    const bundle = await getDigestBundle({
      digests: {
        enabled: true,
        push_time: '08:00',
        ai_summary: false,
        github: { enabled: true, ai: false },
        news: { enabled: false },
        learning: { enabled: false }
      }
    }, '2026-07-27', { withAI: false });
    // 网络可能失败；有内容时校验模板
    if (bundle.sections[0]?.pushItems?.length) {
      const item = bundle.sections[0].pushItems[0];
      assert.equal(item.format, 'article');
      assert.match(item.message, /今日精选 · GitHub 热门/);
      assert.match(item.message, /为什么值得看/);
    }
  });
});
