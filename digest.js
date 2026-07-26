/**
 * 每日热点：按来源分卡推送 + 可选 DeepSeek 导读。
 */
const { buildDailyProgrammingLesson } = require('./digest-learning');
const { buildSourceArticlePush } = require('./digest-articles');

const cache = { key: '', at: 0, data: null };
const CACHE_MS = 60 * 60 * 1000;

const SOURCE_META = {
  github: { title: 'GitHub 热门', emoji: '🔥', defaultTime: '' },
  news: { title: '科技快讯', emoji: '📰', defaultTime: '' },
  learning: { title: '每日编程', emoji: '📚', defaultTime: '' }
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

/** @deprecated 保留导出兼容；实际推送走 buildDailyProgrammingLesson */
function learningTips(topics) {
  const pool = Array.isArray(topics) && topics.length ? topics : ['JavaScript', '算法', 'Git', 'HTTP'];
  const today = new Date().getDate();
  const topic = pool[today % pool.length];
  return [
    {
      title: `今日课题 · ${topic}`,
      desc: `围绕「${topic}」读完今日卡片里的讲解与练习即可`,
      url: '',
      meta: '编程',
      blurb: `今天聚焦「${topic}」：先读「是什么 / 为什么」，再做动手题。`,
      format: 'lesson'
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
    return list.map((it) => ({
      ...it,
      blurb: it.blurb || it.desc || '暂无导读（未配置 DEEPSEEK_API_KEY）'
    }));
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
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              '你是资讯编辑。为每条返回 JSON 数组，元素为对象 {"blurb":"...","why":"..."}。'
              + 'blurb：18～36字中文一句话导读；why：28～48字说明为什么值得看/适合谁。'
              + '数组长度与输入条数一致。不要 markdown，只 JSON。'
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
    const rows = match ? JSON.parse(match[0]) : null;
    if (!Array.isArray(rows) || rows.length === 0) {
      return list.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
    }
    return list.map((it, i) => {
      const row = rows[i];
      if (typeof row === 'string') {
        return { ...it, blurb: String(row).trim().slice(0, 80) };
      }
      return {
        ...it,
        blurb: String(row?.blurb || it.desc || '').trim().slice(0, 80),
        why: String(row?.why || '').trim().slice(0, 120)
      };
    });
  } catch {
    return list.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
  }
}

/** @deprecated 旧扁平列表；现用详版 article 单卡 */
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

async function buildSourceSection(def, digests, dateKey) {
  let items = [];
  let pushItems = [];
  let error = null;
  try {
    if (def.id === 'github') {
      items = await fetchGitHubTrending(5);
    } else if (def.id === 'news') {
      items = await fetchNews(def.feeds || digests.news?.feeds, 5);
    } else if (def.id === 'learning') {
      const built = await buildDailyProgrammingLesson({
        dateKey: dateKey || new Date().toISOString().slice(0, 10),
        topics: def.topics || digests.learning?.topics,
        useAI: !!def.ai
      });
      items = [built.item];
      pushItems = [built.pushItem];
    }
  } catch (e) {
    error = e.message;
    items = [];
    pushItems = [];
  }

  if (def.id === 'github' || def.id === 'news') {
    if (items.length && def.ai) {
      items = await summarizeWithAI(def.title, items);
    } else {
      items = items.map((it) => ({ ...it, blurb: it.blurb || it.desc || '' }));
    }
    if (items.length) {
      const built = buildSourceArticlePush(
        def.id,
        items,
        dateKey || new Date().toISOString().slice(0, 10)
      );
      pushItems = [built.pushItem];
    } else {
      pushItems = [];
    }
  }

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
      digests,
      dateKey
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
