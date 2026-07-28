const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBirthdayText,
  formatUpcomingText,
  formatInventoryText
} = require('../lib/feishu-brain');

describe('feishu brain formatters', () => {
  it('formats empty birthdays', () => {
    assert.match(formatBirthdayText([]), /没有登记/);
  });

  it('formats birthday rows', () => {
    const text = formatBirthdayText([
      { name: '小明', days: 0, calendar: '阳历', time: '09:00' },
      { name: '小红', days: 3, calendar: '农历', time: '10:00' }
    ]);
    assert.match(text, /小明/);
    assert.match(text, /就是今天/);
    assert.match(text, /3 天后/);
  });

  it('formats upcoming and inventory', () => {
    assert.match(
      formatUpcomingText([{ name: '跑步', days: 1, space: 'habit', subtype: '', time: '07:00' }]),
      /明天/
    );
    const inv = formatInventoryText({
      habit: [{ name: '跑步', enabled: true, subtype: '', time: '07:00' }],
      moment: [{ name: '纪念日', enabled: true, subtype: '纪念日', time: '' }],
      task: [{ name: '买菜', enabled: false, subtype: '', time: '' }]
    });
    assert.match(inv, /习惯/);
    assert.match(inv, /买菜/);
    assert.match(inv, /停用/);
  });
});
