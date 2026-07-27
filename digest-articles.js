/**
 * GitHub 热门 / 科技快讯：飞书可读详版模板
 * 每条：标题 → 一句话 → 简介 → 为什么值得看 → 链接
 */

function fallbackWhy(sourceId, item) {
  if (sourceId === 'github') {
    const lang = (String(item.meta || '').split('·')[1] || '').trim();
    return lang && lang !== '—'
      ? `近期高星，适合关注 ${lang} / 同类工具的开发者：先扫 README 再决定是否 star。`
      : '近期高星仓库，建议先扫 README 与 Issues，判断是否跟自己相关。';
  }
  return '今日科技向热点：先读导读判断相关性，再决定是否点开原文。';
}

function formatEntryBlock(sourceId, item, index) {
  const n = index + 1;
  const title = item.title || '未命名';
  const blurb = item.blurb || item.desc || '暂无导读';
  const desc = String(item.desc || '').trim();
  const showDesc = desc && desc !== blurb && desc.length > 8;
  const why = item.why || fallbackWhy(sourceId, item);
  const head = sourceId === 'github'
    ? `**#${n} 仓库** · ${title}`
    : `**#${n} 快讯** · ${title}`;

  return [
    head,
    item.meta ? `元信息：${item.meta}` : null,
    '',
    '**一句话**',
    blurb,
    showDesc ? `\n**简介**\n${desc}` : null,
    '',
    '**为什么值得看**',
    why,
    item.url ? `\n**打开**\n${item.url}` : null
  ].filter((x) => x != null && x !== '').join('\n');
}

function formatGithubArticle(items, dateKey) {
  const list = (items || []).slice(0, 3);
  const blocks = list.map((it, i) => formatEntryBlock('github', it, i));
  return [
    '🔥 **今日精选 · GitHub 热门**',
    dateKey ? `日期：${dateKey}` : null,
    `共 ${list.length} 个仓库 · 建议挑 1 个点进去看 README`,
    '',
    blocks.join('\n\n——\n\n'),
    '',
    '读完可在飞书回「收到」。'
  ].filter((x) => x != null && x !== '').join('\n');
}

function formatNewsArticle(items, dateKey) {
  const list = (items || []).slice(0, 3);
  const blocks = list.map((it, i) => formatEntryBlock('news', it, i));
  return [
    '📰 **今日精选 · 科技快讯**',
    dateKey ? `日期：${dateKey}` : null,
    `共 ${list.length} 条 · 先读导读，再决定点开哪一条`,
    '',
    blocks.join('\n\n——\n\n'),
    '',
    '读完可在飞书回「收到」。'
  ].filter((x) => x != null && x !== '').join('\n');
}

function formatGithubShort(items, dateKey) {
  const list = (items || []).slice(0, 3);
  const lines = list.map((it, i) => {
    const blurb = it.blurb || it.desc || '';
    return `**#${i + 1}** ${it.title}${it.meta ? ` · ${it.meta}` : ''}${blurb ? `\n${blurb}` : ''}`;
  });
  return [
    '🔥 **今日精选 · GitHub 热门**',
    dateKey ? `日期：${dateKey}` : null,
    `共 ${list.length} 个仓库`,
    '',
    ...lines,
    '',
    '📄 每个仓库的「为什么值得看」与链接已写入飞书文档。',
    '点下方 **阅读全文** 打开。'
  ].filter(Boolean).join('\n');
}

function formatNewsShort(items, dateKey) {
  const list = (items || []).slice(0, 3);
  const lines = list.map((it, i) => {
    const blurb = it.blurb || it.desc || '';
    return `**#${i + 1}** ${it.title}${blurb ? `\n${blurb}` : ''}`;
  });
  return [
    '📰 **今日精选 · 科技快讯**',
    dateKey ? `日期：${dateKey}` : null,
    `共 ${list.length} 条`,
    '',
    ...lines,
    '',
    '📄 导读与原文链接已写入飞书文档。',
    '点下方 **阅读全文** 打开。'
  ].filter(Boolean).join('\n');
}

function buildSourceArticlePush(sourceId, items, dateKey) {
  const markdown = sourceId === 'github'
    ? formatGithubArticle(items, dateKey)
    : formatNewsArticle(items, dateKey);
  const short = sourceId === 'github'
    ? formatGithubShort(items, dateKey)
    : formatNewsShort(items, dateKey);
  const first = (items || [])[0] || {};
  return {
    itemPreview: {
      title: sourceId === 'github' ? '今日精选 · GitHub 热门' : '今日精选 · 科技快讯',
      desc: first.blurb || first.desc || '',
      blurb: first.blurb || first.desc || '',
      meta: `${Math.min((items || []).length, 3)} 条详版`,
      url: '',
      format: 'article',
      body: markdown
    },
    pushItem: {
      kind: 'digest',
      type: 'digest',
      source: sourceId,
      name: sourceId,
      format: 'article',
      message: short,
      fullMarkdown: markdown,
      shortMessage: short
    }
  };
}

module.exports = {
  formatGithubArticle,
  formatNewsArticle,
  formatGithubShort,
  formatNewsShort,
  formatEntryBlock,
  buildSourceArticlePush,
  fallbackWhy
};
