/**
 * 每日热点：按来源分卡推送 + 可选 DeepSeek 导读。
 */
const cache = { key: '', at: 0, data: null };
const CACHE_MS = 60 * 60 * 1000;

const SOURCE_META = {
  github: { title: 'GitHub 热门', emoji: '🔥', defaultTime: '' },
  news: { title: '科技快讯', emoji: '📰', defaultTime: '' },
  learning: { title: '学习推荐', emoji: '📚', defaultTime: '' }
};

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'nudge-digest/4.2', Accept: 'application/json, application/rss+xml, text/xml, */*' }
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
    desc: (r.description || '').slice(0, 160),
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
    const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i)
      || block.match(/<description>(.*?)<\/description>/i) || [])[1];
    if (!title) continue;
    items.push({
      title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      url: (link || '').trim(),
      desc: String(desc || '').replace(/<[^>]+>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 160),
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
  return [
    {
      title: `今日学习 · ${topic}`,
      desc: `花 25 分钟专注练习「${topic}」，完成后给自己打个勾`,
      url: '',
      meta: '学习',
      blurb: `今天聚焦「${topic}」：设定一个小目标，用一个番茄钟做完即可。`
    },
    {
      title: '番茄钟提醒',
      desc: '工作 25 分钟 + 休息 5 分钟，完成 2 轮即可',
      url: '',
      meta: '学习',
      blurb: '别贪多：两轮番茄钟比刷一天视频更有效。'
    }
  ];
}

function sourcePushTime(digests, sourceId) {
  const src = digests?.[sourceId] || {};
  const t = String(src.push_time || '').trim();
  if (t) return t;
  return String(digests?.push_time || '20:00').trim() || '20:00';
}

function sourceAiEnabled(digests, sourceId) {
  if (digests?.ai_summary === false) return false;
  const src = digests?.[sourceId] || {};
  return src.ai !== false;
}

function listSourceDefs(digests) {
  const d = digests || {};
  return [
    {
      id: 'github',
      enabled: d.github?.enabled !== false,
      title: d.github?.card_title || SOURCE_META.github.title,
      push_time: sourcePushTime(d, 'github'),
      ai: sourceAiEnabled(d, 'github')
    },
    {
      id: 'news',
      enabled: d.news?.enabled !== false,
      title: d.news?.card_title || SOURCE_META.news.title,
      push_time: sourcePushTime(d, 'news'),
      ai: sourceAiEnabled(d, 'news'),
      feeds: d.news?.feeds
    },
    {
      id: 'learning',
      enabled: d.learning?.enabled !== false,
      title: d.learning?.card_title || SOURCE_META.learning.title,
      push_time: sourcePushTime(d, 'learning'),
      ai: sourceAiEnabled(d, 'learning'),
      topics: d.learning?.topics
    }
  ];
}

async function summarizeWithAI(sourceTitle, items) {
  const key = process.env.DEEPSEEK_API_KEY;
  const list = (items || []).slice(0, 5);
  if (!list.length) return list;
  if (!key) {
    return list.map((it) => ({ ...it, blurb: it.blurb || it.desc || '暂无导读（未配置 DEEPSEEK_API_KEY）' }));
  }
  const lines = list.map((it, i) => {
    const bits = [`${i + 1}. ${it.title}`];
    if (it.meta) bits.push(`(${it.meta})`);
    if (it.desc) bits.push(`— ${it.desc}`);
    return bits.join(' ');
  }).join('\n');

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.4,
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              '你是资讯编辑。为每条内容写一句中文导读（18～36字），说明为什么值得看。只返回 JSON 数组，长度与输入条数一致，元素为字符串，不要 markdown。'
          },
          {
            role: 'user',
            content: `栏目：${sourceTitle}\n条目：\n${lines}`
          }
        ]
      })
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    const match = text.match(/\[[\s\S]*\]/);
    const blurbs = match ? JSON.parse(match[0]) : null;
    if (!Array.isArray(blurbs) || blurbs.length === 0) {
      return list.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
    }
    return list.map((it, i) => ({
      ...it,
      blurb: String(blurbs[i] || it.desc || '').trim().slice(0, 80)
    }));
  } catch {
    return list.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
  }
}

function toPushItems(sourceId, emoji, items) {
  return (items || []).slice(0, 3).map((it) => {
    const blurb = it.blurb || it.desc || '';
    const lines = [
      `${emoji} **${it.title}**${it.meta ? `（${it.meta}）` : ''}`,
      blurb ? blurb : null,
      it.url || null
    ].filter(Boolean);
    return {
      kind: 'digest',
      type: 'digest',
      source: sourceId,
      name: sourceId,
      message: lines.join('\n')
    };
  });
}

async function buildSourceSection(def, digests) {
  const emoji = SOURCE_META[def.id]?.emoji || '•';
  let items = [];
  let error = null;
  try {
    if (def.id === 'github') items = await fetchGitHubTrending(5);
    else if (def.id === 'news') items = await fetchNews(def.feeds || digests.news?.feeds, 5);
    else if (def.id === 'learning') items = learningTips(def.topics || digests.learning?.topics);
  } catch (e) {
    error = e.message;
    items = [];
  }

  if (items.length && def.ai && def.id !== 'learning') {
    items = await summarizeWithAI(def.title, items);
  } else if (items.length && def.id === 'learning' && def.ai) {
    /* learning already has blurbs; optional polish skipped for speed */
  } else {
    items = items.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
  }

  const pushItems = toPushItems(def.id, emoji, items);
  return {
    id: def.id,
    title: def.title,
    push_time: def.push_time,
    ai: !!def.ai,
    enabled: true,
    items,
    pushItems,
    error
  };
}

async function getDigestBundle(config, dateKey, options = {}) {
  const digests = config?.digests || {};
  if (digests.enabled === false) {
    return { enabled: false, sections: [], sources: [], pushItems: [] };
  }

  const defs = listSourceDefs(digests).filter((d) => d.enabled);
  const withAI = options.withAI !== false;
  const key = `${dateKey}|ai=${withAI}|${JSON.stringify(defs.map((d) => ({
    id: d.id, t: d.push_time, ai: d.ai && withAI, feeds: d.feeds, topics: d.topics
  })))}`;
  if (cache.key === key && cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const sections = [];
  for (const def of defs) {
    const section = await buildSourceSection(
      { ...def, ai: withAI && def.ai },
      digests
    );
    sections.push(section);
  }

  const data = {
    enabled: true,
    push_time: digests.push_time || '20:00',
    ai_summary: digests.ai_summary !== false,
    sections,
    sources: sections,
    // 兼容旧调用：扁平列表（不推荐再用于单卡）
    pushItems: sections.flatMap((s) => s.pushItems || [])
  };
  cache.key = key;
  cache.at = Date.now();
  cache.data = data;
  return data;
}

/** 返回到点且尚未在调用方去重的源（含内容）；调度侧再查 ledger */
async function getDueDigestSources(config, dateKey, nowParts) {
  const bundle = await getDigestBundle(config, dateKey);
  if (!bundle.enabled) return [];
  const nowM = (nowParts.hour || 0) * 60 + (nowParts.minute || 0);
  return (bundle.sections || []).filter((sec) => {
    if (!sec.pushItems?.length) return false;
    const [hh, mm] = String(sec.push_time || '20:00').split(':').map((x) => parseInt(x, 10));
    const planned = (hh || 0) * 60 + (mm || 0);
    return nowM >= planned;
  });
}

function clearDigestCache() {
  cache.key = '';
  cache.at = 0;
  cache.data = null;
}

module.exports = {
  getDigestBundle,
  getDueDigestSources,
  listSourceDefs,
  fetchGitHubTrending,
  fetchNews,
  learningTips,
  summarizeWithAI,
  clearDigestCache,
  SOURCE_META
};
