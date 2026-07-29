/**
 * Persistent entity memory ("Brain DB") — facts about people, things, events.
 *
 * Stored inside data.json under `brain_facts` so it survives restarts
 * without requiring a new database. Indexed by entity name for fast lookup.
 *
 * Schema:
 * {
 *   entity_name: string,       // normalized lowercase key
 *   entity_type: "person" | "thing" | "date",
 *   display_name: string,      // original display name
 *   facts: {
 *     birthday: "2000-05-15",
 *     phone: "138xxxx",
 *     likes: ["篮球"],
 *     notes: "free text"
 *   },
 *   source_chat_id: string,    // where this was learned
 *   learned_at: ISO string,
 *   updated_at: ISO string
 * }
 */

const store = require('../store');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

async function loadFacts() {
  const data = await store.loadData();
  return Array.isArray(data.brain_facts) ? data.brain_facts : [];
}

async function saveFacts(facts) {
  const data = await store.loadData();
  data.brain_facts = facts;
  await store.saveData(data);
  return facts;
}

/** Get all facts about an entity by name (fuzzy: case-insensitive). */
async function getEntity(name) {
  const facts = await loadFacts();
  const key = normalizeName(name);
  return facts.find((f) => normalizeName(f.entity_name) === key
    || normalizeName(f.display_name) === key) || null;
}

/** Upsert a fact about an entity. Merges into existing facts. */
async function setFact(entityName, factKey, factValue, opts = {}) {
  const facts = await loadFacts();
  const key = normalizeName(entityName);
  let entry = facts.find((f) => normalizeName(f.entity_name) === key
    || normalizeName(f.display_name) === key);

  const now = new Date().toISOString();
  if (!entry) {
    entry = {
      entity_name: key,
      entity_type: opts.entity_type || 'person',
      display_name: entityName.trim(),
      facts: {},
      source_chat_id: opts.chat_id || '',
      learned_at: now,
      updated_at: now
    };
    facts.push(entry);
  }

  // Merge: if value is an array and existing is array, concatenate uniquely
  const existing = entry.facts[factKey];
  if (Array.isArray(existing) && Array.isArray(factValue)) {
    entry.facts[factKey] = [...new Set([...existing, ...factValue])];
  } else if (typeof existing === 'object' && existing !== null && typeof factValue === 'object' && factValue !== null) {
    entry.facts[factKey] = { ...existing, ...factValue };
  } else {
    entry.facts[factKey] = factValue;
  }

  entry.updated_at = now;
  if (opts.chat_id) entry.source_chat_id = opts.chat_id;

  await saveFacts(facts);
  return entry;
}

/** Set multiple facts at once. */
async function setFactsBatch(entityName, updates, opts = {}) {
  let entry = null;
  for (const [key, value] of Object.entries(updates)) {
    entry = await setFact(entityName, key, value, opts);
  }
  return entry;
}

/** Delete a specific fact key from an entity. */
async function deleteFact(entityName, factKey) {
  const facts = await loadFacts();
  const key = normalizeName(entityName);
  const idx = facts.findIndex((f) => normalizeName(f.entity_name) === key
    || normalizeName(f.display_name) === key);
  if (idx < 0) return null;
  const entry = facts[idx];
  delete entry.facts[factKey];
  entry.updated_at = new Date().toISOString();
  await saveFacts(facts);
  return entry;
}

/** Delete entire entity. */
async function deleteEntity(entityName) {
  const facts = await loadFacts();
  const key = normalizeName(entityName);
  const filtered = facts.filter((f) => normalizeName(f.entity_name) !== key
    && normalizeName(f.display_name) !== key);
  if (filtered.length === facts.length) return false;
  await saveFacts(filtered);
  return true;
}

/** List all entities, optionally filtered by type. */
async function listEntities(entityType) {
  const facts = await loadFacts();
  if (entityType) return facts.filter((f) => f.entity_type === entityType);
  return facts;
}

/** Search entities whose name or facts match a query string. */
async function searchEntities(query) {
  const facts = await loadFacts();
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  return facts.filter((f) => {
    if (f.entity_name.includes(q) || (f.display_name || '').toLowerCase().includes(q)) return true;
    return Object.values(f.facts || {}).some((v) => {
      if (typeof v === 'string') return v.toLowerCase().includes(q);
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(q));
      return false;
    });
  });
}

/** Format entity facts as readable text for chat context. */
function formatEntityForContext(entry) {
  if (!entry) return '';
  const lines = [`「${entry.display_name || entry.entity_name}」`];
  const f = entry.facts || {};
  if (f.birthday) lines.push(`  生日: ${f.birthday}`);
  if (f.phone) lines.push(`  电话: ${f.phone}`);
  if (f.likes && f.likes.length) lines.push(`  喜好: ${f.likes.join('、')}`);
  if (f.relation) lines.push(`  关系: ${f.relation}`);
  if (f.anniversary) lines.push(`  纪念日: ${f.anniversary}`);
  if (f.notes) lines.push(`  备注: ${f.notes}`);
  return lines.join('\n');
}

/** Build a context snippet of all known entities for the LLM. */
async function buildEntityContext() {
  const facts = await loadFacts();
  if (!facts.length) return '';
  return [
    '【已知人物/事物档案】',
    ...facts.map(formatEntityForContext)
  ].join('\n');
}

module.exports = {
  loadFacts,
  saveFacts,
  getEntity,
  setFact,
  setFactsBatch,
  deleteFact,
  deleteEntity,
  listEntities,
  searchEntities,
  formatEntityForContext,
  buildEntityContext,
  normalizeName
};
