/**
 * 飞书云文档：把长文写入 docx，卡片只保留摘要 +「阅读全文」链接
 * 需要应用权限：docx:document、docx:document.block:convert、drive 权限管理（可选分享）
 */
const feishuBot = require('./feishu-bot');

const FEISHU_HOST = 'https://open.feishu.cn';

function docBaseUrl() {
  return String(process.env.FEISHU_DOC_BASE || 'https://www.feishu.cn/docx').replace(/\/$/, '');
}

function docUrl(documentId) {
  return `${docBaseUrl()}/${documentId}`;
}

async function api(path, { method = 'GET', body } = {}) {
  const token = await feishuBot.getTenantAccessToken();
  const res = await fetch(`${FEISHU_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { ok: json.code === 0, status: res.status, json };
}

async function createDocument(title, folderToken) {
  const body = { title: String(title || 'Nudge').slice(0, 800) };
  if (folderToken) body.folder_token = folderToken;
  return api('/open-apis/docx/v1/documents', { method: 'POST', body });
}

async function convertMarkdown(markdown) {
  return api('/open-apis/docx/v1/documents/blocks/convert', {
    method: 'POST',
    body: {
      content_type: 'markdown',
      content: String(markdown || '').slice(0, 200000)
    }
  });
}

function stripReadonlyFields(block) {
  if (!block || typeof block !== 'object') return block;
  const out = { ...block };
  if (out.table) {
    const table = { ...out.table };
    delete table.merge_info;
    out.table = table;
  }
  return out;
}

async function insertConvertedBlocks(documentId, convertData) {
  const blocks = (convertData.blocks || []).map(stripReadonlyFields);
  const childrenId = convertData.first_level_block_ids || [];
  if (!childrenId.length || !blocks.length) {
    return { ok: false, error: 'convert 未返回可插入块' };
  }
  return api(
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/descendant?document_revision_id=-1`,
    {
      method: 'POST',
      body: {
        children_id: childrenId,
        descendants: blocks,
        index: 0
      }
    }
  );
}

/** 无 convert 权限时的降级：按行写入文本块 */
async function insertPlainTextBlocks(documentId, markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(0, 120);
  const children = lines.map((line) => ({
    block_type: 2,
    text: {
      elements: [{ text_run: { content: (line || ' ').slice(0, 2000) } }],
      style: {}
    }
  }));
  // 分批插入
  for (let i = 0; i < children.length; i += 40) {
    const batch = children.slice(i, i + 40);
    const r = await api(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=-1`,
      {
        method: 'POST',
        body: { index: -1, children: batch }
      }
    );
    if (!r.ok) return r;
  }
  return { ok: true };
}

async function shareWithChat(documentId, chatId) {
  if (!chatId) return { ok: false, skipped: true };
  return api(
    `/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/members?type=docx`,
    {
      method: 'POST',
      body: {
        member_type: 'chatid',
        member_id: String(chatId),
        perm: 'view'
      }
    }
  );
}

/**
 * @returns {{ ok: boolean, documentId?: string, url?: string, error?: string }}
 */
async function createMarkdownDocument({ title, markdown, folderToken, chatId } = {}) {
  if (!feishuBot.botConfigured()) {
    return { ok: false, error: '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET' };
  }
  try {
    const created = await createDocument(title, folderToken || process.env.FEISHU_DOC_FOLDER_TOKEN || '');
    if (!created.ok) {
      return { ok: false, error: created.json?.msg || '创建文档失败' };
    }
    const documentId = created.json?.data?.document?.document_id;
    if (!documentId) return { ok: false, error: '创建文档未返回 document_id' };

    const converted = await convertMarkdown(markdown);
    let filled = false;
    if (converted.ok && converted.json?.data) {
      const inserted = await insertConvertedBlocks(documentId, converted.json.data);
      filled = inserted.ok;
    }
    if (!filled) {
      const plain = await insertPlainTextBlocks(documentId, markdown);
      if (!plain.ok) {
        return {
          ok: false,
          error: plain.json?.msg || converted.json?.msg || '写入文档内容失败',
          documentId,
          url: docUrl(documentId)
        };
      }
    }

    await shareWithChat(documentId, chatId);

    return { ok: true, documentId, url: docUrl(documentId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 从详版正文抽短摘要（用于卡片） */
function shortenDigestMarkdown(fullMarkdown, hint) {
  const text = String(fullMarkdown || '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => /今日课题|今日精选/.test(l)) || lines[0] || '今日精选';
  let one = hint || '';
  const idx = lines.findIndex((l) => l.includes('一句话'));
  if (!one && idx >= 0 && lines[idx + 1]) one = lines[idx + 1].replace(/\*\*/g, '');
  if (!one) {
    const blurbLine = lines.find((l) => !/今日课题|今日精选|标签|日期|一句话|是什么|为什么|元信息|#\d/.test(l));
    one = blurbLine || '点击下方打开飞书文档阅读全文。';
  }
  one = String(one).replace(/\*\*/g, '').slice(0, 80);
  return [
    title.replace(/\*\*/g, '**'),
    '',
    one,
    '',
    '📄 详细内容已写入飞书文档，点下方 **阅读全文** 打开（不跳转网页）。'
  ].join('\n');
}

module.exports = {
  createMarkdownDocument,
  shortenDigestMarkdown,
  docUrl,
  shareWithChat
};
