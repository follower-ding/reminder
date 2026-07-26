/**
 * 每日热点：GitHub / 新闻 RSS / 学习主题。带日内内存缓存。
 */
const cache = { key: '', at: 0, data: null };
const CACHE_MS = 60 * 60 * 1000;

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'daily-reminder/3.2', Accept: 'application/json, application/rss+xml, text/xml, */*' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchGitHubTrending(limit = 5) {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const ymd = since.toISOString().slice(0, 10);
  const url = `https://api.github.com/search/repositories?q=created:>=${ymd}&sort=stars&order=desc&per_page=${limit}`;
  const text = await fetchText(url);
  const json = JSON.parse(text);
  return (json.items || []).slice(0, limit).map((r) => ({
    title: r.full_name,
    desc: (r.description || '').slice(0, 120),
    url: r.html_url,
    meta: `★ ${r.stargazers_count} · ${r.language || '—'}`
  }));
}

function parseRssItems(xml, limit = 5) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    if (items.length >= limit) break;
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || block.match(/<title>(.*?)<\/title>/i) || [])[1];
    const link = (block.match(/<link>(.*?)<\/link>/i) || [])[1];
    if (!title) continue;
    items.push({
      title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      url: (link || '').trim(),
      desc: '',
      meta: '新闻'
    });
  }
  return items;
}

async function fetchNews(feeds, limit = 5) {
  const list = Array.isArray(feeds) && feeds.length ? feeds : ['https://hnrss.org/frontpage'];
  const out = [];
  for (const feed of list.slice(0, 2)) {
    try {
      const xml = await fetchText(feed);
      out.push(...parseRssItems(xml, limit));
      if (out.length >= limit) break;
    } catch {
      /* skip feed */
    }
  }
  return out.slice(0, limit);
}

function learningTips(topics) {
  const pool = Array.isArray(topics) && topics.length ? topics : ['前端', '算法', '英语', '写作'];
  const today = new Date().getDate();
  const topic = pool[today % pool.length];
  const tips = [
    { title: `今日学习 · ${topic}`, desc: `花 25 分钟专注练习「${topic}」，完成后给自己打个勾`, url: '', meta: '学习' },
    { title: '番茄钟提醒', desc: '工作 25 分钟 + 休息 5 分钟，完成 2 轮即可', url: '', meta: '学习' }
  ];
  return tips;
}

async function getDigestBundle(config, dateKey) {
  const digests = config?.digests || {};
  if (digests.enabled === false) {
    return { enabled: false, sections: [], pushItems: [] };
  }
  const key = `${dateKey}|${JSON.stringify({
    g: digests.github?.enabled !== false,
    n: digests.news?.enabled !== false,
    l: digests.learning?.enabled !== false,
    feeds: digests.news?.feeds,
    topics: digests.learning?.topics
  })}`;
  if (cache.key === key && cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const sections = [];
  const pushItems = [];

  if (digests.github?.enabled !== false) {
    try {
      const items = await fetchGitHubTrending(5);
      sections.push({ id: 'github', title: 'GitHub 热门', items });
      for (const it of items.slice(0, 3)) {
        pushItems.push({
          kind: 'digest',
          type: 'digest',
          name: 'GitHub',
          message: `🔥 ${it.title}${it.meta ? `（${it.meta}）` : ''}${it.url ? `\n${it.url}` : ''}`
        });
      }
    } catch (e) {
      sections.push({ id: 'github', title: 'GitHub 热门', items: [], error: e.message });
    }
  }

  if (digests.news?.enabled !== false) {
    try {
      const items = await fetchNews(digests.news?.feeds, 5);
      sections.push({ id: 'news', title: '新闻精选', items });
      for (const it of items.slice(0, 3)) {
        pushItems.push({
          kind: 'digest',
          type: 'digest',
          name: '新闻',
          message: `📰 ${it.title}${it.url ? `\n${it.url}` : ''}`
        });
      }
    } catch (e) {
      sections.push({ id: 'news', title: '新闻精选', items: [], error: e.message });
    }
  }

  if (digests.learning?.enabled !== false) {
    const items = learningTips(digests.learning?.topics);
    sections.push({ id: 'learning', title: '学习推荐', items });
    pushItems.push({
      kind: 'digest',
      type: 'digest',
      name: '学习',
      message: `📚 ${items[0].title}：${items[0].desc}`
    });
  }

  const data = {
    enabled: true,
    push_time: digests.push_time || '20:00',
    sections,
    pushItems
  };
  cache.key = key;
  cache.at = Date.now();
  cache.data = data;
  return data;
}

module.exports = { getDigestBundle, fetchGitHubTrending, fetchNews, learningTips };
