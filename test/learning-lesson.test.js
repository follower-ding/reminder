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

  it('card body has no bullet prefix for lesson format', () => {
    const lesson = pickLesson('2026-07-27', []);
    const message = formatLessonMarkdown(lesson, '2026-07-27');
    const card = buildFeishuCard('2026-07-27', [{
      kind: 'digest',
      type: 'digest',
      format: 'lesson',
      message
    }], 'Nudge · 每日编程', 'http://example.com');
    const raw = JSON.stringify(card);
    assert.match(raw, /今日课题/);
    assert.match(raw, /今日编程精读/);
    assert.doesNotMatch(raw, /• 📚/);
    assert.doesNotMatch(raw, /每日热点/);
  });

  it('bundle learning section uses lesson push item', async () => {
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
    const msg = bundle.sections[0].pushItems[0].message;
    assert.equal(bundle.sections[0].pushItems[0].format, 'lesson');
    assert.match(msg, /今日课题/);
    assert.match(msg, /是什么/);
  });

  it('buildDailyProgrammingLesson returns one structured item', async () => {
    const built = await buildDailyProgrammingLesson({
      dateKey: '2026-01-01',
      topics: ['Git'],
      useAI: false
    });
    assert.ok(built.lesson.topic);
    assert.equal(built.pushItem.format, 'lesson');
    assert.match(built.pushItem.message, /动手/);
  });
});
