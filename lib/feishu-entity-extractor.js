/**
 * Entity fact extractor — use DeepSeek to auto-extract facts from Feishu chat.
 *
 * Invoked asynchronously after each user message (fire-and-forget, non-blocking).
 * Extracted facts are stored in feishu-brain-db for future context injection.
 */

const brainDb = require('./feishu-brain-db');

const EXTRACT_PROMPT = `你是 Nudge 的知识提取器。分析用户消息，判断是否包含关于人物或事物的可记忆事实。
只提取明确提到的、永久性或长期有效的信息。不要推测。

输出纯 JSON（不要 markdown 代码块）：
{
  "entities": [
    {
      "entity_name": "小明",
      "entity_type": "person",
      "facts": {
        "birthday": "5月15日",
        "phone": "",
        "likes": ["篮球"],
        "relation": "朋友",
        "anniversary": "",
        "notes": ""
      }
    }
  ],
  "extracted": true,
  "summary": "一句话总结提取了什么"
}

规则：
- 只有明确陈述才提取（"小明下周三生日"→提取；"小明可能喜欢篮球"→不提取）
- 只提取对未来的提醒/查询有价值的信息
- 如果没有可提取的事实，返回 { "entities": [], "extracted": false }
- entity_name 用原始称呼，不要翻译或改名`;

/**
 * Try to extract entities from a user message.
 * Fire-and-forget: never throws, returns null on any error.
 */
async function extractFromMessage(userText, chatId) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;

  const t = String(userText || '').trim();
  if (!t || t.length < 4) return null;

  // Quick pre-filter: skip obvious non-factual messages
  if (/^(收到|确认|帮助|绑定|好的|嗯|是的|取消|算了|ok|help)$/i.test(t)) return null;
  if (/^(今天|明天|这周|重新|再推|换|推送|清单|日程|概况|标签)/.test(t)) return null;

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
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: t }
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    });

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract from code fence
      const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) {
        try { parsed = JSON.parse(fence[1].trim()); } catch { return null; }
      } else {
        return null;
      }
    }

    if (!parsed || !parsed.extracted || !Array.isArray(parsed.entities) || !parsed.entities.length) {
      return { extracted: false, entities: [], summary: '' };
    }

    // Store extracted facts
    const stored = [];
    for (const ent of parsed.entities) {
      if (!ent.entity_name || !ent.facts || !Object.keys(ent.facts).length) continue;
      const cleanFacts = {};
      for (const [k, v] of Object.entries(ent.facts)) {
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
        cleanFacts[k] = v;
      }
      if (!Object.keys(cleanFacts).length) continue;
      await brainDb.setFactsBatch(ent.entity_name, cleanFacts, {
        entity_type: ent.entity_type || 'person',
        chat_id: chatId
      });
      stored.push(ent.entity_name);
    }

    return {
      extracted: stored.length > 0,
      entities: stored,
      summary: parsed.summary || ''
    };
  } catch {
    return null;
  }
}

module.exports = { extractFromMessage, EXTRACT_PROMPT };
