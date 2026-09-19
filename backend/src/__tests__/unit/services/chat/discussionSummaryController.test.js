jest.mock('../../../../models/Conversation', () => ({ checkOwnership: jest.fn(), findById: jest.fn() }));
jest.mock('../../../../models/Message', () => ({ create: jest.fn(), getRecentMessages: jest.fn() }));
jest.mock('../../../../models/User', () => ({ findById: jest.fn() }));
jest.mock('../../../../models/AIModel', () => ({}));
jest.mock('../../../../services/chat/ConversationService', () => ({}));
jest.mock('../../../../services/chat/MessageService', () => ({ validateMessageSending: jest.fn(), processFileAttachments: jest.fn(), buildActualContent: s => s, buildAIContext: jest.fn(), refundCredits: jest.fn() }));
jest.mock('../../../../services/chat/StreamMessageService', () => ({ sendStreamMessage: jest.fn() }));
jest.mock('../../../../services/chat/NonStreamMessageService', () => ({ sendNonStreamMessage: jest.fn() }));
jest.mock('../../../../services/chat/discussionSummary', () => ({ buildDiscussionSummary: jest.fn() }));
jest.mock('../../../../services/cacheService', () => ({ getCachedUserModels: jest.fn(), deleteDraft: jest.fn() }));
jest.mock('../../../../middleware/uploadMiddleware', () => ({}));
jest.mock('../../../../middleware/documentUploadMiddleware', () => ({}));
jest.mock('../../../../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../../../database/connection', () => ({}));

const Controller = require('../../../../controllers/ChatControllerRefactored');
const Conversation = require('../../../../models/Conversation');
const Message = require('../../../../models/Message');
const User = require('../../../../models/User');
const Cache = require('../../../../services/cacheService');
const MessageService = require('../../../../services/chat/MessageService');
const Summary = require('../../../../services/chat/discussionSummary');
const Stream = require('../../../../services/chat/StreamMessageService');
const NonStream = require('../../../../services/chat/NonStreamMessageService');
const user = { consumeCredits: jest.fn() };
let res;
const send = body => Controller.sendMessage({ params: { id: 'owned' }, user: { id: 17 }, body: { content: '请整理讨论', summary_mode: 'discussion', ...body } }, res);
beforeEach(() => {
  jest.clearAllMocks();
  res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  Conversation.checkOwnership.mockResolvedValue(true);
  Conversation.findById.mockResolvedValue({ id: 'owned', model_name: 'text-model' });
  Cache.getCachedUserModels.mockResolvedValue([{ id: 1, name: 'text-model', credits_per_chat: 10, stream_enabled: true }]);
  user.getCredits = () => 100;
  user.consumeCredits.mockResolvedValue({ balanceAfter: 90 });
  User.findById.mockResolvedValue(user);
  MessageService.validateMessageSending.mockResolvedValue({ estimatedTokens: 10 });
  MessageService.processFileAttachments.mockResolvedValue({ fileInfos: [] });
  Summary.buildDiscussionSummary.mockReset().mockResolvedValue([{ role: 'user', content: 'complete-discussion' }]);
  Message.create.mockResolvedValue({ id: 'new-request' });
  NonStream.sendNonStreamMessage.mockReset().mockResolvedValue({ assistant_message: { content: 'draft' } });
});
test.each([false, true])('uses existing billing and generation (%s streaming) without consuming unsent draft or ordinary truncated context', async stream => {
  await send({ stream });
  const call = (stream ? Stream.sendStreamMessage : NonStream.sendNonStreamMessage).mock.calls[0][0];
  expect(call.aiMessages).toEqual([{ role: 'user', content: 'complete-discussion' }]);
  expect(call.outputFormat).toBeNull();
  expect(user.consumeCredits).toHaveBeenCalledTimes(1);
  expect(Message.getRecentMessages).not.toHaveBeenCalled();
  expect(MessageService.buildAIContext).not.toHaveBeenCalled();
  expect(Cache.deleteDraft).not.toHaveBeenCalled();
  expect(Message.create.mock.calls[0][0].file_ids).toBeNull();
});
test('rejects another account before reading discussion or charging', async () => {
  Conversation.checkOwnership.mockResolvedValue(false);
  await send({});
  expect(res.status).toHaveBeenCalledWith(403);
  expect(Summary.buildDiscussionSummary).not.toHaveBeenCalled();
  expect(user.consumeCredits).not.toHaveBeenCalled();
});
test('oversized discussion is rejected before charging, saving or deleting drafts', async () => {
  Summary.buildDiscussionSummary.mockRejectedValue(Object.assign(new Error('too long'), { statusCode: 413 }));
  await send({});
  expect(res.status).toHaveBeenCalledWith(413);
  expect(user.consumeCredits).not.toHaveBeenCalled();
  expect(Message.create).not.toHaveBeenCalled();
  expect(Cache.deleteDraft).not.toHaveBeenCalled();
});
test.each([{ file_ids: ['file'] }, { output_format: 'html' }, { summary_mode: true }])('rejects incompatible summary input %j before charging', async body => {
  await send(body);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(user.consumeCredits).not.toHaveBeenCalled();
});
test('provider failure uses the existing refund path once', async () => {
  NonStream.sendNonStreamMessage.mockRejectedValue(new Error('provider unavailable'));
  await send({});
  expect(user.consumeCredits).toHaveBeenCalledTimes(1);
  expect(MessageService.refundCredits).toHaveBeenCalledTimes(1);
});
test('does not refund again when the delivery service already refunded successfully', async () => {
  NonStream.sendNonStreamMessage.mockRejectedValue(Object.assign(new Error('provider unavailable'), { creditsRefunded: true }));
  await send({});
  expect(user.consumeCredits).toHaveBeenCalledTimes(1);
  expect(MessageService.refundCredits).not.toHaveBeenCalled();
});
test('ordinary messages retain their context, draft and output-format behavior', async () => {
  Message.getRecentMessages.mockResolvedValue(['recent']);
  MessageService.buildAIContext.mockResolvedValue(['ordinary']);
  await send({ summary_mode: undefined, output_format: 'html' });
  expect(Summary.buildDiscussionSummary).not.toHaveBeenCalled();
  expect(Cache.deleteDraft).toHaveBeenCalledWith(17, 'owned');
  expect(NonStream.sendNonStreamMessage.mock.calls[0][0].aiMessages).toEqual(['ordinary']);
  expect(NonStream.sendNonStreamMessage.mock.calls[0][0].outputFormat).toBe('html');
});
