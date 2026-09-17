jest.mock('../../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));
const db = require('../../../database/connection');
const service = require('../../../services/forum/ForumNotificationService');
it('restricts marking a notification to its recipient', async () => {
  db.query.mockResolvedValue({ rows: { affectedRows: 1 } });
  await service.markRead(8, 12);
  expect(db.query).toHaveBeenCalledWith('UPDATE forum_notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [8, 12]);
});
it('propagates write failure so the client does not mark a notification as read locally', async () => {
  db.query.mockRejectedValue(new Error('unavailable'));
  await expect(service.markRead(8, 12)).rejects.toThrow('标记已读失败');
});
