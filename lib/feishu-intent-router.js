/**
 * Extensible Feishu intent catalog + soft/LLM router.
 * Fast regex → soft paraphrase → DeepSeek JSON route → free chat.
 */

const INTENT_CATALOG = [
  { id: 'help', desc: '查看帮助菜单、能做什么' },
  { id: 'today', desc: '今日待确认事项、今天要做什么' },
  { id: 'birthdays', desc: '谁过生日、近期生日、哪些人生日' },
  { id: 'upcoming', desc: '近期日程、即将到来的提醒、这周有什么' },
  { id: 'inventory', desc: '全部清单、有哪些习惯/日子/待办' },
  { id: 'summary', desc: '项目概况、整体状态、总结一下' },
  { id: 'learning', desc: '推送今日编程/学习资料卡' },
  { id: 'github', desc: '推送 GitHub 开源热门卡' },
  { id: 'news', desc: '推送科技快讯/热点卡（首次推，非刷新）' },
  { id: 'period', desc: '经期相关问答与注意' },
  { id: 'comfort', desc: '哄她、说暖话、安慰' },
  { id: 'rotate_learning', desc: '换学习课题/换资料并重推编程卡' },
  { id: 'refresh_news', desc: '换一批热点/刷新快讯后再推' },
  { id: 'refresh_github', desc: '换/刷新 GitHub 开源后再推' },
  {
    id: 'repost_digest',
    desc: '把已有订阅再推一次（可带 source: learning|github|news；「再推一次」可指上一源）',
    sources: ['learning', 'github', 'news']
  },
  { id: 'snooze', desc: '推迟某事项提醒到明天/后天（需确认）' },
  { id: 'disable_event', desc: '停用某事项（需确认）' },
  { id: 'enable_event', desc: '启用某事项' },
  { id: 'create_habit', desc: '新增每日习惯（需确认）' },
  { id: 'push_status', desc: '推送是否成功、失败了几条' },
  { id: 'chat', desc: '闲聊或无法归入以上动作' }
];

const INTENT_SET = new Set(INTENT_CATALOG.map((x) => x.id));
const SOURCE_SET = new Set(['learning', 'github', 'news']);

function catalogPromptBlock() {
  return INTENT_CATALOG.map((x) => `- ${x.id}: ${x.desc}`).join('\n');
}

/** Looser paraphrase matching (no API). */
function softMatchQaIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 200) return null;

  if (/(帮我看下|帮我查|告诉我|想知道|请问|有没有)/.test(t) && /生日/.test(t)) {
    return { intent: 'birthdays', via: 'soft' };
  }
  if (/生日/.test(t) && /(谁|哪些人|快到|最近|过生|还有几天)/.test(t)) {
    return { intent: 'birthdays', via: 'soft' };
  }
  if (/(这(两)?周|接下来|马上|快到期|即将).*(事|提醒|日程)|日程安排|有什么安排/.test(t)) {
    return { intent: 'upcoming', via: 'soft' };
  }
  if (/(都有哪些|全部|列一下).*(习惯|日子|待办|事项)|我的清单|事项总览/.test(t)) {
    return { intent: 'inventory', via: 'soft' };
  }
  if (/(整体|现在).*(怎样|如何|状态)|汇报一下|简报/.test(t)) {
    return { intent: 'summary', via: 'soft' };
  }
  if (
    /(再发|重发|再推|重新发|再给我).*(热点|快讯|新闻)/.test(t)
    || /(热点|快讯|新闻).*(再发|重发|再推|重新发|再推送|一遍)/.test(t)
  ) {
    return { intent: 'repost_digest', source: 'news', via: 'soft' };
  }
  if (
    /(再发|重发|再推|重新发).*(github|开源)/i.test(t)
    || /(github|开源).*(再发|重发|再推|重新发)/i.test(t)
  ) {
    return { intent: 'repost_digest', source: 'github', via: 'soft' };
  }
  if (
    /(再发|重发|再推|重新发).*(编程|学习|课题)/.test(t)
    || /(编程|学习|课题).*(再发|重发|再推|重新发)/.test(t)
  ) {
    return { intent: 'repost_digest', source: 'learning', via: 'soft' };
  }
  if (/(换一?(批|下|些)?|换点).*(热点|快讯|新闻)/.test(t)) {
    return { intent: 'refresh_news', via: 'soft' };
  }
  if (/(换一?(批|下|些)?|换点).*(学习|课题|资料|编程)/.test(t)) {
    return { intent: 'rotate_learning', via: 'soft' };
  }
  if (/(推(一下|给我)?|发(一下|给我)?).*(热点|快讯)/.test(t) && !/(换|刷新|重)/.test(t)) {
    return { intent: 'news', via: 'soft' };
  }
  if (/(推(一下|给我)?|发(一下|给我)?).*(编程|学习)/.test(t) && !/(换|刷新|重)/.test(t)) {
    return { intent: 'learning', via: 'soft' };
  }
  if (/今天.*(还没|未).*(确认|做)|还有什么.*(没确认|待办)/.test(t)) {
    return { intent: 'today', via: 'soft' };
  }
  if (/^(再推一次|再发一次|再发一遍|再推送一下|再推)$/.test(t)) {
    return { intent: 'repost_digest', source: null, via: 'soft' };
  }
  if (/(推迟|延期|明天再说|延后).{0,12}/.test(t) && !/生日|经期/.test(t)) {
    return { intent: 'snooze', via: 'soft' };
  }
  if (/(停用|关掉|关闭).*(习惯|事项|提醒)|把.+停用/.test(t)) {
    return { intent: 'disable_event', via: 'soft' };
  }
  if (/(启用|打开|恢复).*(习惯|事项|提醒)/.test(t)) {
    return { intent: 'enable_event', via: 'soft' };
  }
  if (/(加一个|新增|创建).*(习惯|每日)/.test(t) || /^加个习惯/.test(t)) {
    return { intent: 'create_habit', via: 'soft' };
  }
  if (/(推送).*(失败|状态|怎样|成功了吗)|有没有推成功|推送记录/.test(t)) {
    return { intent: 'push_status', via: 'soft' };
  }
  return null;
}

/**
 * Parse LLM JSON route reply.
 * @returns {{ intent: string, source?: string|null, confidence: number } | null}
 */
function parseRouteJson(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const brace = s.match(/\{[\s\S]*\}/);
  if (brace) s = brace[0];
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  const intent = String(obj.intent || '').trim();
  if (!INTENT_SET.has(intent)) return null;
  let source = obj.source == null || obj.source === '' ? null : String(obj.source).trim();
  if (source && !SOURCE_SET.has(source)) source = null;
  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = intent === 'chat' ? 0.5 : 0.7;
  confidence = Math.max(0, Math.min(1, confidence));
  return { intent, source, confidence };
}

function normalizeRouted(route, via) {
  if (!route || !route.intent || route.intent === 'chat') return null;
  if (route.confidence < 0.55) return null;
  const out = { intent: route.intent, via };
  if (route.intent === 'repost_digest') {
    out.source = route.source || 'news';
  } else if (route.source) {
    out.source = route.source;
  }
  return out;
}

/**
 * Ask DeepSeek to map free text → catalog intent (JSON only).
 */
async function routeIntentWithLLM(userText) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const t = String(userText || '').trim();
  if (!t) return null;

  const system = [
    '你是 Nudge 意图分类器。只输出一个 JSON 对象，不要其它文字。',
    '字段：intent（必须是目录中的 id）、source（仅 repost_digest 时用 learning|github|news，否则 null）、confidence（0~1）。',
    '若只是闲聊、情感倾诉、或无法执行的动作 → intent=chat。',
    '用户想「查/推/换/再发」项目数据时，选对应动作，不要选 chat。',
    '意图目录：',
    catalogPromptBlock()
  ].join('\n');

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: t }
        ],
        temperature: 0.1,
        max_tokens: 120,
        response_format: { type: 'json_object' }
      })
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    return normalizeRouted(parseRouteJson(content), 'llm');
  } catch {
    return null;
  }
}

/**
 * Resolve structured intent: exact → soft → LLM.
 * @param {string} text
 * @param {(t: string) => object|null} exactMatcher matchQaIntent
 * @param {{ useLlm?: boolean }} opts
 */
async function resolveQaIntent(text, exactMatcher, opts = {}) {
  const exact = typeof exactMatcher === 'function' ? exactMatcher(text) : null;
  if (exact) return { ...exact, via: exact.via || 'exact' };

  const soft = softMatchQaIntent(text);
  if (soft) return soft;

  if (opts.useLlm !== false) {
    const llm = await routeIntentWithLLM(text);
    if (llm) return llm;
  }
  return null;
}

module.exports = {
  INTENT_CATALOG,
  catalogPromptBlock,
  softMatchQaIntent,
  parseRouteJson,
  normalizeRouted,
  routeIntentWithLLM,
  resolveQaIntent
};
