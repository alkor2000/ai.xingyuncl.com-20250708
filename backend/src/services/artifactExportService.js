const JSZip = require('jszip');
const { prepareSelection, request, validUUID } = require('./artifactHandoff/selection');
const { fail } = require('./artifactHandoff/source');

// Fixed ZIP metadata makes an unchanged selection byte-identical on retry.
const ZIP_DATE = new Date('1980-01-01T00:00:00Z');
class ArtifactExportService {
  constructor(source) { this.source = source; }
  inspect(owner, id) {
    if (!validUUID(id)) fail('source_unavailable', 404);
    return this.source.inspect(owner, id);
  }
  async download(owner, id, body) {
    request(body, ['expected_version', 'selection', 'attachments']);
    const { manifest, payload } = await prepareSelection(this.source, owner,
      { ...body, message_id: id, purpose: 'reference' });
    const zip = new JSZip();
    const file = (name, text) => zip.file(name, text, { date: ZIP_DATE, createFolders: false });
    file('answer.md', payload.text);
    const attachments = payload.attachments.map((attachment, i) => {
      const name = attachment.name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').slice(0, 160) || 'attachment.txt';
      const archivePath = `attachments/${String(i + 1).padStart(2, '0')}-${name}`;
      file(archivePath, attachment.text);
      return { ...manifest.attachments[i], archive_path: archivePath };
    });
    file('source.json', JSON.stringify({ export_schema: 'practice-selected-export/v1', ...manifest,
      answer_path: 'answer.md', attachments }, null, 2));
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer, filename: `answer-${id.slice(0, 8)}-${manifest.content_sha256.slice(0, 8)}.zip` };
  }
}
module.exports = { ArtifactExportService };
