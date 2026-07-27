const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickLesson, formatLessonMarkdown, buildDailyProgrammingLesson } = require('../digest-learning');
const { buildFeishuCard } = require('../engine');
const { getDigestBundle, clearDigestCache, SOURCE_META } = require('../digest');

describe('daily programming lesson template', () => {
  it('SOURCE_META learning title is 每日编程', () => {
    assert.equal(SOURCE_META.learning.title, '每日编程');
  });

  it('formats a readable Feishu lesson body', () => {
    const lesson = pickLesson('2026-07-27', ['前端']);
    const md = formatLessonMarkdown(lesson, '2026-07-27');
    assert.match(md, /今日课题/);
    assert.match(md, /一句话/);
    assert.match(md, /是什么/);
    assert.match(md, /为什么重要/);
    assert.match(md, /动手/);
    assert.match(md, /自检/);
  });

  it('card body uses short lesson + doc button', () => {
    const { formatLessonShort } = require('../digest-learning');
    const lesson = pickLesson('2026-07-27', []);
    const message = formatLessonShort(lesson, '2026-07-27');
    const card = buildFeishuCard('2026-07-27', [{
      kind: 'digest',
      type: 'digest',
      format: 'lesson',
      message
    }], 'Nudge · 每日编程', 'http://example.com', 'Nudge', {
      docUrl: 'https://www.feishu.cn/docx/demo',
      openLabel: '阅读全文'
    });
    const raw = JSON.stringify(card);
    assert.match(raw, /今日课题/);
    assert.match(raw, /阅读全文/);
    assert.match(raw, /feishu\.cn\/docx\/demo/);
    assert.doesNotMatch(raw, /每日热点/);
    assert.doesNotMatch(raw, /打开清单/);
  });

  it('bundle learning section uses short card + fullMarkdown', async () => {
    clearDigestCache();
    const bundle = await getDigestBundle({
      digests: {
        enabled: true,
        push_time: '07:11',
        ai_summary: false,
        github: { enabled: false },
        news: { enabled: false },
        learning: { enabled: true, ai: false, topics: ['前端', '算法'] }
      }
    }, '2026-07-27', { withAI: false });
    const item = bundle.sections[0].pushItems[0];
    assert.equal(item.format, 'lesson');
    assert.match(item.message, /今日课题/);
    assert.match(item.message, /阅读全文|飞书文档/);
    assert.match(item.fullMarkdown, /是什么/);
    assert.match(item.fullMarkdown, /动手/);
  });

  it('buildDailyProgrammingLesson returns short + full', async () => {
    const built = await buildDailyProgrammingLesson({
      dateKey: '2026-01-01',
      topics: ['Git'],
      useAI: false
    });
    assert.ok(built.lesson.topic);
    assert.equal(built.pushItem.format, 'lesson');
    assert.match(built.pushItem.message, /阅读全文|飞书文档/);
    assert.match(built.pushItem.fullMarkdown, /动手/);
  });
});
