jest.mock('../../../../models/Message', () => ({ getRecentMessages: jest.fn() }));
jest.mock('../../../../services/imageGenerationService', () => ({ isImageGenerationModel: model => model.image_generation_enabled === true }));
const Message = require('../../../../models/Message');
const { buildDiscussionSummary, MAX_MESSAGES, MAX_BYTES } = require('../../../../services/chat/discussionSummary');
const row = (role, content, extra = {}) => ({ role, content, status: 'completed', ...extra });
const user = { hasTokenQuota: jest.fn(() => true) };
const build = () => buildDiscussionSummary({ conversationId: 'owned', aiModel: {}, user });
beforeEach(() => { jest.clearAllMocks(); user.hasTokenQuota.mockReturnValue(true); });

test('includes the beginning beyond ordinary 20-message context, preserving chronology', async () => {
  const history = Array.from({ length: 44 }, (_, i) => row(i % 2 ? 'assistant' : 'user', `topic-${i}`));
  Message.getRecentMessages.mockResolvedValue(history);
  const result = await build();
  expect(Message.getRecentMessages).toHaveBeenCalledWith('owned', MAX_MESSAGES + 1);
  expect(JSON.parse(result[1].content.split('\n').slice(1).join('\n'))).toEqual(history.map(({ role, content }) => ({ role, content })));
  expect(result).toHaveLength(2);
});
test('excludes system instructions, thinking, failed messages and all file metadata', async () => {
  Message.getRecentMessages.mockResolvedValue([
    row('system', 'HIDDEN_SYSTEM'), row('user', '目标'),
    row('assistant', '<thinking>PRIVATE_REASONING</thinking>保留方案', { file_ids: ['SECRET_FILE'], thinking: 'HIDDEN_FIELD' }),
    row('assistant', 'FAILED_PARTIAL', { status: 'failed' })
  ]);
  const result = JSON.stringify(await build());
  expect(result).toContain('保留方案');
  for (const forbidden of ['HIDDEN_SYSTEM', 'PRIVATE_REASONING', 'SECRET_FILE', 'HIDDEN_FIELD', 'FAILED_PARTIAL']) expect(result).not.toContain(forbidden);
});
test.each([
  ['message count', () => Array.from({ length: MAX_MESSAGES + 1 }, () => row('assistant', 'text'))],
  ['bytes', () => [row('assistant', 'a'.repeat(MAX_BYTES + 1))]],
  ['estimated tokens', () => [row('assistant', '中'.repeat(30000))]]
])('rejects oversized %s instead of silently truncating the discussion', async (_, makeHistory) => {
  Message.getRecentMessages.mockResolvedValue(makeHistory());
  await expect(build()).rejects.toMatchObject({ statusCode: 413 });
});
test('fails closed for incomplete thinking and no completed answer', async () => {
  Message.getRecentMessages.mockResolvedValue([row('assistant', '<think>still hidden')]);
  await expect(build()).rejects.toMatchObject({ statusCode: 409 });
  Message.getRecentMessages.mockResolvedValue([row('user', 'question')]);
  await expect(build()).rejects.toMatchObject({ statusCode: 400 });
});
test('checks transcript token quota and rejects image generation models', async () => {
  Message.getRecentMessages.mockResolvedValue([row('assistant', '方案')]);
  user.hasTokenQuota.mockReturnValue(false);
  await expect(build()).rejects.toThrow('Token配额不足');
  await expect(buildDiscussionSummary({ conversationId: 'owned', aiModel: { image_generation_enabled: true }, user })).rejects.toThrow('文字对话模型');
});
