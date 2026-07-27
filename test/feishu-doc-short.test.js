const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shortenDigestMarkdown, docUrl } = require('../feishu-doc');
const { buildFeishuCard } = require('../engine');

describe('feishu doc short card', () => {
  it('shortenDigestMarkdown keeps title and one liner', () => {
    const full = [
      '📚 **今日课题** · 闭包',
      '标签：JavaScript',
      '',
      '**一句话**',
      '函数记住外层变量',
      '',
      '**是什么**',
      '很长很长的正文'
    ].join('\n');
    const short = shortenDigestMarkdown(full);
    assert.match(short, /今日课题/);
    assert.match(short, /函数记住外层变量/);
    assert.match(short, /阅读全文/);
    assert.doesNotMatch(short, /很长很长的正文/);
  });

  it('docUrl joins base and id', () => {
    assert.match(docUrl('doxcnABC'), /docx\/doxcnABC/);
  });

  it('buildFeishuCard with docUrl uses 阅读全文 not web list', () => {
    const card = buildFeishuCard(
      '2026-07-27',
      [{ kind: 'digest', type: 'digest', format: 'lesson', message: '📚 **今日课题** · x\n简短' }],
      'Nudge · 每日编程',
      'http://web.example.com',
      'Nudge',
      { docUrl: 'https://www.feishu.cn/docx/abc', openLabel: '阅读全文' }
    );
    const raw = JSON.stringify(card);
    assert.match(raw, /阅读全文/);
    assert.match(raw, /feishu\.cn\/docx\/abc/);
    assert.doesNotMatch(raw, /web\.example\.com/);
    assert.doesNotMatch(raw, /打开清单/);
  });
});
