// Shared, read-only selection preparation. No receiver, storage, identity exchange or network calls.
const { fail, digest } = require('./source');
const SCHEMA_VERSION = 1;
const validUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function exact(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).some(key => !keys.includes(key)) || keys.some(key => !(key in object))) fail('invalid_request');
}
function request(body, keys) {
  exact(body, ['schema_version', ...keys]);
  if (body.schema_version !== SCHEMA_VERSION) fail('unsupported_schema');
}

function validateSelection(body) {
  request(body, ['message_id', 'expected_version', 'selection', 'attachments', 'purpose']);
  if (!validUUID(body.message_id) || !['reference', 'lesson_preparation', 'courseware'].includes(body.purpose)) fail('invalid_request');
  exact(body.selection, ['start', 'end']);
  if (!Array.isArray(body.attachments) || body.attachments.length > 3) fail('invalid_request');
  for (const item of body.attachments) {
    exact(item, ['source_id', 'expected_version']);
    if (!validUUID(item.source_id) || typeof item.expected_version !== 'string') fail('invalid_request');
  }
  if (new Set(body.attachments.map(item => item.source_id)).size !== body.attachments.length) fail('invalid_request');
}
async function prepareSelection(source, owner, body) {
  validateSelection(body);
  const current = await source.load(owner, body.message_id);
  if (current.version !== body.expected_version) fail('source_changed', 409);
  const { start, end } = body.selection;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > current.text.length) fail('invalid_selection');
  // A browser selection uses UTF-16 offsets. Reject a split surrogate pair.
  const splitsPair = n => n > 0 && n < current.text.length && /[\uD800-\uDBFF]/.test(current.text[n - 1]) && /[\uDC00-\uDFFF]/.test(current.text[n]);
  if (splitsPair(start) || splitsPair(end)) fail('invalid_selection');
  const text = current.text.slice(start, end);
  if (!text.trim()) fail('invalid_selection');
  const attachments = [];
  for (const item of [...body.attachments].sort((a, b) => a.source_id.localeCompare(b.source_id))) {
    const id = item.source_id;
    if (!current.ids.includes(id)) fail('attachment_unavailable', 409);
    const attachment = await source.attachment(owner, id);
    if (attachment.version !== item.expected_version) fail('source_changed', 409);
    attachments.push(attachment);
  }
  const payload = { text, attachments };
  const manifest = {
    source: { platform: 'practice', kind: 'assistant_message',
      object_id: current.message.id, conversation_id: current.message.conversation_id, version: current.version,
      generated_at: Number.isFinite(new Date(current.message.created_at).getTime()) && current.message.created_at
        ? Math.floor(new Date(current.message.created_at).getTime() / 1000) : null,
      model_name: current.message.model_name || null },
    locator: { basis: 'answer_without_thinking_utf16', start, end },
    format: 'text/markdown', byte_length: Buffer.byteLength(text), content_sha256: digest(JSON.stringify(payload)),
    summary: { kind: 'verbatim_excerpt', text: Array.from(text).slice(0, 160).join('') }, purpose: body.purpose,
    visibility: 'private', material_status: 'ai_output_unreviewed', web_links: 'references_only_not_fetched',
    attachments: attachments.map(({ text: ignored, ...metadata }) => metadata)
  };
  return { manifest, payload };
}
module.exports = { SCHEMA_VERSION, validUUID, request, validateSelection, prepareSelection };
