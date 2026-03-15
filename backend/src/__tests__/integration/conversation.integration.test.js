/**
 * 对话消息系统 - 集成测试
 * 
 * 连接真实测试数据库，验证完整的对话链路：
 * - 会话创建 → 参数入库 → 查询验证
 * - 消息创建 → 序号自增 → 多文件ID存储
 * - 会话列表 → 分页 → 优先级排序
 * - 消息上下文 → context_length控制 → cleared_at过滤
 * - 消息对删除 → 序号重排 → 统计更新
 * - 会话统计更新 → message_count/total_tokens累计
 * - enable_thinking深度思考字段读写
 * 
 * 注意：连接 ai_platform_test 数据库，每个测试后自动清理
 */

const bcrypt = require('bcryptjs');

let dbConnection;
let Conversation;
let Message;

beforeAll(() => {
  dbConnection = require('../../database/connection');
  Conversation = require('../../models/Conversation');
  Message = require('../../models/Message');
});

// ========== 辅助函数 ==========

/** 确保默认用户组存在 */
async function ensureDefaultGroup() {
  const { rows } = await dbConnection.query('SELECT id FROM user_groups WHERE id = 1');
  if (rows.length === 0) {
    await dbConnection.query(`
      INSERT INTO user_groups (id, name, is_active, credits_pool, credits_pool_used, user_limit, sort_order, created_at, updated_at)
      VALUES (1, '默认组', 1, 100000, 0, 1000, 0, NOW(), NOW())
    `);
  }
}

/** 创建真实用户 */
async function createRealUser() {
  await ensureDefaultGroup();
  const timestamp = Date.now();
  const passwordHash = await bcrypt.hash('Test123456', 10);
  const { rows } = await dbConnection.query(`
    INSERT INTO users (uuid, username, email, password_hash, role, group_id, status, token_quota, used_tokens, credits_quota, used_credits, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'user', 1, 'active', 100000, 0, 1000, 0, NOW(), NOW())
  `, [`uuid-${timestamp}`, `user_${timestamp}`, `user_${timestamp}@test.com`, passwordHash]);
  return rows.insertId;
}

// ========== 测试套件 ==========

describe('对话消息系统 - 集成测试（真实数据库）', () => {

  // ---------- 会话创建与查询 ----------
  describe('会话创建与查询', () => {

    test('创建会话后应能通过findById查询到', async () => {
      const userId = await createRealUser();

      const conversation = await Conversation.create({
        user_id: userId,
        title: '测试对话',
        model_name: 'gpt-4',
        context_length: 30,
        ai_temperature: 0.8
      });

      expect(conversation).not.toBeNull();
      expect(conversation.id).toBeDefined();
      expect(conversation.title).toBe('测试对话');
      expect(conversation.model_name).toBe('gpt-4');
      expect(conversation.user_id).toBe(userId);

      const found = await Conversation.findById(conversation.id);
      expect(found).not.toBeNull();
      expect(found.title).toBe('测试对话');
    });

    test('context_length和ai_temperature应正确存储', async () => {
      const userId = await createRealUser();

      const conv = await Conversation.create({
        user_id: userId,
        model_name: 'claude-3',
        context_length: 50,
        ai_temperature: 0.5
      });

      expect(conv.getContextLength()).toBe(50);
      expect(conv.getTemperature()).toBeCloseTo(0.5, 1);
    });

    test('enable_thinking字段应正确读写', async () => {
      const userId = await createRealUser();

      // 默认关闭
      const conv1 = await Conversation.create({ user_id: userId, model_name: 'claude-3' });
      expect(conv1.isThinkingEnabled()).toBe(false);

      // 显式开启
      const conv2 = await Conversation.create({
        user_id: userId, model_name: 'claude-3', enable_thinking: 1
      });
      expect(conv2.isThinkingEnabled()).toBe(true);

      // 通过update切换
      await conv2.update({ enable_thinking: 0 });
      const updated = await Conversation.findById(conv2.id);
      expect(updated.isThinkingEnabled()).toBe(false);
    });

    test('checkOwnership：正确用户应返回true', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      expect(await Conversation.checkOwnership(conv.id, userId)).toBe(true);
      expect(await Conversation.checkOwnership(conv.id, 99999)).toBe(false);
    });
  });

  // ---------- 会话列表与排序 ----------
  describe('会话列表与排序', () => {

    test('getUserConversations应按优先级降序+创建时间降序排列', async () => {
      const userId = await createRealUser();

      await Conversation.create({ user_id: userId, title: '普通', model_name: 'gpt-4', priority: 0 });
      await Conversation.create({ user_id: userId, title: '重要', model_name: 'gpt-4', priority: 5 });
      await Conversation.create({ user_id: userId, title: '置顶', model_name: 'gpt-4', priority: 10 });

      const result = await Conversation.getUserConversations(userId);

      expect(result.conversations.length).toBe(3);
      expect(result.conversations[0].title).toBe('置顶');
      expect(result.conversations[1].title).toBe('重要');
      expect(result.conversations[2].title).toBe('普通');
    });

    test('分页应正确工作', async () => {
      const userId = await createRealUser();

      for (let i = 0; i < 5; i++) {
        await Conversation.create({ user_id: userId, title: `对话${i}`, model_name: 'gpt-4' });
      }

      const page1 = await Conversation.getUserConversations(userId, { page: 1, limit: 2 });
      expect(page1.conversations.length).toBe(2);
      expect(page1.pagination.total).toBe(5);
      expect(page1.pagination.totalPages).toBe(3);

      const page3 = await Conversation.getUserConversations(userId, { page: 3, limit: 2 });
      expect(page3.conversations.length).toBe(1);
    });
  });

  // ---------- 消息创建与序号 ----------
  describe('消息创建与序号', () => {

    test('消息序号应自动递增', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      const msg1 = await Message.create({
        conversation_id: conv.id, role: 'user', content: '你好', tokens: 10
      });
      const msg2 = await Message.create({
        conversation_id: conv.id, role: 'assistant', content: '你好！有什么可以帮你的？', tokens: 20
      });

      expect(msg1.sequence_number).toBe(1);
      expect(msg2.sequence_number).toBe(2);
    });

    test('file_ids多文件ID应正确存储和读取', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      const fileIds = ['file-uuid-1', 'file-uuid-2', 'file-uuid-3'];
      const msg = await Message.create({
        conversation_id: conv.id, role: 'user', content: '看这些图片', file_ids: fileIds
      });

      const retrievedIds = msg.getAllFileIds();
      expect(retrievedIds).toHaveLength(3);
      expect(retrievedIds).toContain('file-uuid-1');
      expect(retrievedIds).toContain('file-uuid-2');
      expect(msg.file_id).toBe('file-uuid-1');
    });

    test('只有file_id没有file_ids：getAllFileIds应回退到file_id', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      const msg = await Message.create({
        conversation_id: conv.id, role: 'user', content: '看这张图', file_id: 'single-file-id'
      });

      const ids = msg.getAllFileIds();
      expect(ids).toEqual(['single-file-id']);
    });

    test('estimateTokens应合理估算中英文混合Token', () => {
      const englishTokens = Message.estimateTokens('Hello World');
      expect(englishTokens).toBeGreaterThan(0);
      expect(englishTokens).toBeLessThan(20);

      const chineseTokens = Message.estimateTokens('你好世界这是一段中文');
      expect(chineseTokens).toBeGreaterThan(0);

      expect(Message.estimateTokens('')).toBe(0);
      expect(Message.estimateTokens(null)).toBe(0);
    });
  });

  // ---------- 消息上下文获取 ----------
  describe('消息上下文（getRecentMessages）', () => {

    test('应按context_length限制返回消息数量', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({
        user_id: userId, model_name: 'gpt-4', context_length: 4
      });

      for (let i = 0; i < 10; i++) {
        await Message.create({
          conversation_id: conv.id,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `消息${i}`, tokens: 10
        });
      }

      const recent = await Message.getRecentMessages(conv.id);
      expect(recent.length).toBe(4);
      expect(recent[0].sequence_number).toBeLessThan(recent[3].sequence_number);
    });

    test('cleared_at之前的消息应被过滤', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      // 创建2条旧消息，手动设置created_at为过去时间
      const pastTime = '2025-01-01 00:00:00';
      await dbConnection.query(`
        INSERT INTO messages (id, conversation_id, sequence_number, role, content, tokens, status, created_at)
        VALUES (?, ?, 1, 'user', '旧消息1', 10, 'completed', ?)
      `, [`old-msg-1-${Date.now()}`, conv.id, pastTime]);

      await dbConnection.query(`
        INSERT INTO messages (id, conversation_id, sequence_number, role, content, tokens, status, created_at)
        VALUES (?, ?, 2, 'assistant', '旧回复1', 10, 'completed', ?)
      `, [`old-msg-2-${Date.now()}`, conv.id, pastTime]);

      // 设置cleared_at为旧消息之后、新消息之前的时间
      const clearedTime = '2025-06-01 00:00:00';
      await dbConnection.query(
        'UPDATE conversations SET cleared_at = ? WHERE id = ?',
        [clearedTime, conv.id]
      );

      // 创建2条新消息（created_at默认NOW()，肯定在cleared_at之后）
      await Message.create({ conversation_id: conv.id, role: 'user', content: '新消息1' });
      await Message.create({ conversation_id: conv.id, role: 'assistant', content: '新回复1' });

      const recent = await Message.getRecentMessages(conv.id);

      // 只应返回cleared_at之后的2条新消息
      expect(recent.length).toBe(2);
      expect(recent[0].content).toBe('新消息1');
      expect(recent[1].content).toBe('新回复1');
    });
  });

  // ---------- 会话统计更新 ----------
  describe('会话统计更新', () => {

    test('updateStats应正确累加message_count和total_tokens', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      expect(conv.message_count).toBe(0);
      expect(conv.total_tokens).toBe(0);

      await conv.updateStats(2, 100);
      const after1 = await Conversation.findById(conv.id);
      expect(after1.message_count).toBe(2);
      expect(after1.total_tokens).toBe(100);

      const conv2 = await Conversation.findById(conv.id);
      await conv2.updateStats(2, 150);
      const after2 = await Conversation.findById(conv.id);
      expect(after2.message_count).toBe(4);
      expect(after2.total_tokens).toBe(250);
    });
  });

  // ---------- 消息对删除 ----------
  describe('消息对删除与序号重排', () => {

    test('deleteMessagePair应删除用户+AI消息并重排序号', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      const msgs = [];
      for (let i = 0; i < 3; i++) {
        const userMsg = await Message.create({
          conversation_id: conv.id, role: 'user', content: `问题${i + 1}`, tokens: 10
        });
        const aiMsg = await Message.create({
          conversation_id: conv.id, role: 'assistant', content: `回答${i + 1}`, tokens: 20
        });
        msgs.push({ user: userMsg, ai: aiMsg });
      }

      await dbConnection.query(
        'UPDATE conversations SET message_count = 6, total_tokens = 180 WHERE id = ?',
        [conv.id]
      );

      const result = await Message.deleteMessagePair(conv.id, msgs[1].ai.id);
      expect(result.deletedAiMessageId).toBe(msgs[1].ai.id);

      const { rows: remaining } = await dbConnection.query(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence_number',
        [conv.id]
      );
      expect(remaining.length).toBe(4);
      expect(remaining[0].sequence_number).toBe(1);
      expect(remaining[1].sequence_number).toBe(2);
      expect(remaining[2].sequence_number).toBe(3);
      expect(remaining[3].sequence_number).toBe(4);
      expect(remaining[0].content).toBe('问题1');
      expect(remaining[1].content).toBe('回答1');
      expect(remaining[2].content).toBe('问题3');
      expect(remaining[3].content).toBe('回答3');
    });
  });

  // ---------- 会话更新 ----------
  describe('会话更新', () => {

    test('update应正确更新多个字段', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4', title: '旧标题' });

      const updated = await conv.update({
        title: '新标题', model_name: 'claude-3', context_length: 100,
        ai_temperature: 0.9, priority: 5
      });

      expect(updated.title).toBe('新标题');
      expect(updated.model_name).toBe('claude-3');
      expect(updated.getContextLength()).toBe(100);
      expect(updated.priority).toBe(5);
    });

    test('删除会话后findById应返回null', async () => {
      const userId = await createRealUser();
      const conv = await Conversation.create({ user_id: userId, model_name: 'gpt-4' });

      await conv.delete();

      const deleted = await Conversation.findById(conv.id);
      expect(deleted).toBeNull();
    });
  });
});
