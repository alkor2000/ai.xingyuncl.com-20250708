const path = require('path');
const fs = require('fs/promises');
const { createSourceAdapter } = require('../../services/artifactHandoff/source');
const { DraftStore } = require('../../services/artifactHandoff/store');
const { ArtifactHandoffService } = require('../../services/artifactHandoff/service');
const ids = {
  message: 'a0300000-0000-4000-8000-000000000001', other: 'a0300000-0000-4000-8000-000000000002',
  conversation: 'a0300000-0000-4000-8000-000000000003', file: 'a0300000-0000-4000-8000-000000000004',
  missing: 'a0300000-0000-4000-8000-000000000005', unsupported: 'a0300000-0000-4000-8000-000000000006'
};
async function fixture(directory, now = Date.now) {
  const uploadRoot = path.join(directory, 'uploads');
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.writeFile(path.join(uploadRoot, 'activity.md'), '# 合成材料\n让学生观察两杯水的蒸发现象。\n');
  const messages = {
    [ids.message]: { id: ids.message, conversation_id: ids.conversation, role: 'assistant', status: 'completed',
      content: '<thinking>PRIVATE_THINKING_NOT_FOR_EXPORT</thinking>\n# 水循环探究方案\n\n先观察，再记录两杯水的变化。\n\n比较结果，讨论影响蒸发的条件。🌧️\n\n参考链接：https://example.org/water-cycle（仅链接，未抓取正文）。\n',
      file_ids: [ids.file, ids.missing, ids.unsupported], created_at: '2026-09-18T00:00:00Z' },
    [ids.other]: { id: ids.other, conversation_id: ids.conversation, role: 'user', status: 'completed',
      content: 'UNSELECTED_PRIVATE_PROMPT', created_at: '2026-09-18T00:00:00Z' }
  };
  const conversations = { [ids.conversation]: { id: ids.conversation, user_id: 101 } };
  const files = {
    [ids.file]: { id: ids.file, user_id: 101, status: 'ready', original_name: 'activity.md', mime_type: 'text/markdown', file_path: path.join(uploadRoot, 'activity.md') },
    [ids.missing]: { id: ids.missing, user_id: 101, status: 'ready', original_name: 'missing.txt', mime_type: 'text/plain', file_path: path.join(uploadRoot, 'missing.txt') },
    [ids.unsupported]: { id: ids.unsupported, user_id: 101, status: 'ready', original_name: 'page.html', mime_type: 'text/html', file_path: path.join(uploadRoot, 'page.html') }
  };
  const source = createSourceAdapter({ Message: { findById: async id => messages[id] },
    Conversation: { findById: async id => conversations[id] }, File: { findById: async id => files[id] }, uploadRoot });
  const store = new DraftStore(path.join(directory, 'private'), now);
  const service = new ArtifactHandoffService({ source, store, now });
  return { service, source, store, messages, conversations, files, uploadRoot, ids };
}
module.exports = { fixture, ids };
