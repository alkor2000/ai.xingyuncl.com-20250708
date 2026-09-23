// Source-side encoder for review of i03-draft-0.1. Not mounted on any HTTP route.
// Input must be a source-validated frozen selection, not an untrusted browser body.
// This performs no authorization, ticket issue, release, network call or TE-DNA write.
const { digest, fail } = require('./source');
const { validUUID } = require('./selection');
const VERSION = 'i03-draft-0.1';
// Formal candidate message version (rc1/rc2). Not frozen; used only by the separately gated formal
// client/orchestration path and never mixed with the draft in one operation.
const FORMAL_VERSION = 'teacher-artifact-handoff/1';
const WIRE_VERSIONS = Object.freeze([VERSION, FORMAL_VERSION]);
const BINDING_FIELDS = ['operation_id', 'source_instance', 'target_instance', 'action', 'artifact_id',
  'artifact_version', 'manifest_sha256', 'selection_sha256', 'byte_length', 'destination', 'landing', 'return_kind', 'rights'];
const requireValue = ok => { if (!ok) fail('invalid_draft_package'); };
const version = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function utf8(text) {
  requireValue(typeof text === 'string' && !text.includes('\0'));
  const bytes = Buffer.from(text, 'utf8');
  requireValue(bytes.toString('utf8') === text); // Reject unpaired surrogates rather than replacing them.
  return bytes;
}
function frameHash(domain, values) {
  const parts = [Buffer.from(`${domain}\0`, 'ascii')];
  for (const value of values) {
    const bytes = utf8(String(value));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return digest(Buffer.concat(parts));
}
function selectionHash(manifest) {
  const s = manifest.source, l = manifest.locator;
  return frameHash('i03-selection-v1', [s.instance, s.kind, s.object_id, s.version, l.basis, l.start, l.end,
    ...manifest.blobs.flatMap(b => [b.blob_id, b.sha256, b.mime])]);
}
function bindingHash(binding) { return frameHash('i03-binding-v1', BINDING_FIELDS.map(k => binding[k])); }
function encodeDraft(snapshot, { sourceInstance, targetInstance, title, wireVersion = VERSION }) {
  requireValue(WIRE_VERSIONS.includes(wireVersion));
  requireValue(validUUID(snapshot.id) && validUUID(snapshot.binding?.operation_id));
  for (const instance of [sourceInstance, targetInstance]) requireValue(typeof instance === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(instance));
  requireValue(utf8(title).length > 0 && Array.from(title).length <= 120);
  const s = snapshot.manifest.source, l = snapshot.manifest.locator;
  requireValue(s.platform === 'practice' && s.kind === 'assistant_message' && validUUID(s.object_id) && validUUID(s.conversation_id) && version(s.version));
  requireValue(s.generated_at === null || integer(s.generated_at));
  requireValue(s.model_name === null || (typeof s.model_name === 'string' && Array.from(s.model_name).length <= 128));
  if (s.model_name !== null) utf8(s.model_name);
  requireValue(l.basis === 'answer_without_thinking_utf16' && integer(l.start) && integer(l.end) && l.end > l.start);
  requireValue(snapshot.payload.text.length === l.end - l.start);
  const landing = { reference: 'library', lesson_preparation: 'lesson_preparation', courseware: 'courseware' }[snapshot.manifest.purpose];
  requireValue(!!landing && snapshot.manifest.visibility === 'private' && snapshot.manifest.material_status === 'ai_output_unreviewed');
  requireValue(Array.isArray(snapshot.payload.attachments) && snapshot.payload.attachments.length <= 3);
  const files = [...snapshot.payload.attachments].sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0);
  requireValue(new Set(files.map(f => f.source_id)).size === files.length);
  const originals = [{ source_id: s.object_id, name: 'answer.md', format: 'text/markdown', version: s.version,
    text: snapshot.payload.text }, ...files];
  const blobs = [], transport = [];
  for (const [i, item] of originals.entries()) {
    requireValue(validUUID(item.source_id) && ['text/plain', 'text/markdown'].includes(item.format));
    requireValue(typeof item.name === 'string' && item.name.length > 0 && Array.from(item.name).length <= 160 &&
      !['.', '..'].includes(item.name) && !/[\u0000-\u001f\u007f/\\]/.test(item.name));
    utf8(item.name);
    const bytes = utf8(item.text), hash = digest(bytes);
    requireValue(bytes.length > 0 && bytes.length <= (i === 0 ? 131072 : 65536));
    requireValue(i === 0 || (item.byte_length === bytes.length && item.version === `sha256:${hash}`));
    const blobId = i === 0 ? 'answer' : item.source_id;
    blobs.push({ blob_id: blobId, source_id: item.source_id, name: item.name, mime: item.format,
      byte_length: bytes.length, sha256: hash, version: item.version });
    transport.push({ blob_id: blobId, data_b64: bytes.toString('base64') });
  }
  // Explicit fields keep source_checks, excerpts, draft diagnostics and account data out of Identity.
  const manifest = { schema_version: 1, protocol_version: wireVersion,
    source: { platform: 'practice', instance: sourceInstance, kind: 'assistant_message', object_id: s.object_id,
      conversation_id: s.conversation_id, version: s.version, generated_at: s.generated_at, model_name: s.model_name },
    locator: { basis: l.basis, start: l.start, end: l.end }, title, purpose: snapshot.manifest.purpose,
    visibility: 'private', material_status: 'ai_output_unreviewed', web_links: 'references_only_not_fetched',
    rights: 'persistent_private_copy', blobs };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  requireValue(manifestBytes.length <= 16384);
  const binding = { operation_id: snapshot.binding.operation_id, source_instance: sourceInstance, target_instance: targetInstance,
    action: 'teacher_artifact_import', artifact_id: snapshot.id, artifact_version: s.version,
    manifest_sha256: digest(manifestBytes), selection_sha256: selectionHash(manifest),
    byte_length: blobs.reduce((sum, b) => sum + b.byte_length, 0), destination: 'personal_library',
    landing, return_kind: 'practice_artifact', rights: 'persistent_private_copy' };
  const packet = { manifest_b64: manifestBytes.toString('base64'), blobs: transport };
  requireValue(binding.byte_length <= 327680 && Buffer.byteLength(JSON.stringify(packet)) <= 512 * 1024);
  return { protocol_version: wireVersion, binding, binding_sha256: bindingHash(binding), package: packet };
}
module.exports = { VERSION, FORMAL_VERSION, WIRE_VERSIONS, encodeDraft, selectionHash, bindingHash };
