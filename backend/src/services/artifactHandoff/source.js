// P03 source adapter. No network fetches, AI calls, or cross-platform credentials.
const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { TextDecoder } = require('util');

const MAX_TEXT_BYTES = 128 * 1024;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
class HandoffError extends Error {
  constructor(code, status = 400, retryable = false) {
    super(code);
    Object.assign(this, { code, status, retryable });
  }
}
const fail = (code, status, retryable) => { throw new HandoffError(code, status, retryable); };

function fileIds(message) {
  let ids = message.file_ids;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch { fail('source_not_ready', 409); }
  }
  if (ids != null && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) fail('source_not_ready', 409);
  return [...new Set(ids?.length ? ids : message.file_id ? [message.file_id] : [])];
}

// Matches the chat's answer/thinking boundary; don't silently export a hidden trace.
function answerText(content) {
  const answer = content.replace(/<(thinking|think)>[\s\S]*?<\/\1>\n*/gi, '');
  if (/<\/?(?:thinking|think)>/i.test(answer)) fail('source_not_ready', 409);
  return answer;
}

function createSourceAdapter({ Message, Conversation, File, uploadRoot }) {
  async function load(ownerId, messageId) {
    const message = await Message.findById(messageId);
    const conversation = message && await Conversation.findById(message.conversation_id);
    if (!conversation || String(conversation.user_id) !== String(ownerId) ||
        (conversation.cleared_at && new Date(message.created_at) <= new Date(conversation.cleared_at))) {
      fail('source_unavailable', 404);
    }
    if (message.role !== 'assistant' || message.status !== 'completed') fail('source_not_ready', 409);
    if (typeof message.content !== 'string' || Buffer.byteLength(message.content) > MAX_TEXT_BYTES) fail('source_too_large', 413);
    const ids = fileIds(message);
    // This is a content version, not a fabricated database revision counter.
    const version = `sha256:${digest(JSON.stringify([message.id, message.content, ids, message.generated_images, message.model_name, message.created_at]))}`;
    return { message, ids, version, text: answerText(message.content) };
  }

  async function attachment(ownerId, id) {
    const file = await File.findById(id);
    // Never reveal another owner's filename, path, extracted text or URL.
    if (!file || String(file.user_id) !== String(ownerId) || file.status !== 'ready') fail('attachment_unavailable', 409);
    const ext = path.extname(file.original_name || '').toLowerCase();
    if (!['.txt', '.md'].includes(ext) || !['text/plain', 'text/markdown'].includes(file.mime_type)) fail('attachment_unsupported', 422);
    let diskPath = file.file_path;
    if (typeof diskPath !== 'string') fail('attachment_unavailable', 409);
    for (const prefix of ['/app/storage/uploads/', '/var/www/ai-platform/storage/uploads/', '/storage/uploads/', 'storage/uploads/']) {
      if (diskPath.startsWith(prefix)) { diskPath = path.join(uploadRoot, diskPath.slice(prefix.length)); break; }
    }
    let handle;
    try {
      const root = await fs.realpath(uploadRoot);
      const real = await fs.realpath(diskPath);
      const relative = path.relative(root, real);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('attachment_unavailable', 409);
      handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) fail('attachment_unsupported', 422);
      // Bounded read even if the file grows between stat and read.
      const buffer = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_ATTACHMENT_BYTES) fail('attachment_unsupported', 422);
      const bytes = buffer.subarray(0, bytesRead);
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes('\0')) fail('attachment_unsupported', 422);
      return { source_id: id, name: path.basename(file.original_name), format: ext === '.md' ? 'text/markdown' : 'text/plain',
        version: `sha256:${digest(bytes)}`, byte_length: bytes.length, text };
    } catch (error) {
      if (error instanceof HandoffError) throw error;
      fail('attachment_unavailable', 409);
    } finally { await handle?.close(); }
  }

  async function inspect(ownerId, messageId) {
    const source = await load(ownerId, messageId);
    const attachments = [];
    for (const id of source.ids.slice(0, 20)) {
      try {
        attachments.push({ ...await attachment(ownerId, id), status: 'ready' });
      } catch (error) {
        if (!(error instanceof HandoffError)) throw error;
        attachments.push({ source_id: id, status: error.code });
      }
    }
    return { source: { platform: 'practice', kind: 'assistant_message', object_id: source.message.id,
      conversation_id: source.message.conversation_id, version: source.version }, text: source.text,
    attachments, attachments_truncated: source.ids.length > 20, max_text_bytes: MAX_TEXT_BYTES,
    max_attachment_bytes: MAX_ATTACHMENT_BYTES, generated_media_included: false };
  }
  return { load, attachment, inspect };
}
module.exports = { createSourceAdapter, HandoffError, fail, digest, answerText };
