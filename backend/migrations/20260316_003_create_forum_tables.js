/**
 * 数据库迁移：创建论坛模块全部表
 * 
 * 论坛模块包含8张表：
 * 1. forum_boards          - 版块/分区
 * 2. forum_posts           - 帖子主表
 * 3. forum_replies         - 回复/评论
 * 4. forum_attachments     - 附件（图片+文件）
 * 5. forum_likes           - 点赞记录
 * 6. forum_favorites       - 收藏记录
 * 7. forum_moderators      - 版主指定
 * 8. forum_notifications   - 论坛通知
 * 
 * 另外在 system_modules 表中插入论坛模块记录
 * 
 * 创建时间：2026-03-16
 * 幂等性：所有操作前检查 hasTable
 */

exports.up = async function(knex) {

  /* ================================================================
   * 1. forum_boards 版块表
   * 
   * 版块是论坛的一级分类，支持两种可见范围：
   * - public: 全平台所有用户可见（跨组）
   * - group:  仅指定组的用户可见（组隔离）
   * ================================================================ */
  const boardsExists = await knex.schema.hasTable('forum_boards');
  if (!boardsExists) {
    await knex.schema.createTable('forum_boards', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 基本信息 */
      table.string('name', 100).notNullable().comment('版块名称');
      table.text('description').nullable().comment('版块描述');
      table.string('icon', 50).defaultTo('MessageOutlined').comment('图标名(Ant Design Icons)');
      table.string('color', 20).defaultTo('#1890ff').comment('主题色');
      table.string('cover_image', 500).nullable().comment('版块封面图URL');
      table.text('rules').nullable().comment('版块规则/公告(Markdown)');

      /* 可见范围 */
      table.enum('visibility', ['public', 'group']).defaultTo('public')
        .comment('可见范围: public全平台/group按组隔离');
      table.json('allowed_group_ids').nullable()
        .comment('允许访问的组ID数组(visibility=group时生效)');

      /* 排序与状态 */
      table.integer('sort_order').defaultTo(0).comment('排序权重(越小越靠前)');
      table.boolean('is_active').defaultTo(true).comment('是否启用');

      /* 统计计数(冗余字段,避免COUNT查询) */
      table.integer('post_count').defaultTo(0).comment('帖子总数');
      table.datetime('last_post_at').nullable().comment('最后发帖时间');

      /* 创建者 */
      table.integer('created_by').unsigned().notNullable().comment('创建者用户ID');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      /* 索引 */
      table.index('is_active', 'idx_board_active');
      table.index('sort_order', 'idx_board_sort');
      table.index('visibility', 'idx_board_visibility');
    });
    console.log('forum_boards 表创建成功');
  } else {
    console.log('forum_boards 表已存在，跳过创建');
  }

  /* ================================================================
   * 2. forum_posts 帖子主表
   * 
   * 帖子属于某个版块，支持多种管理状态：
   * - is_hidden:         隐藏(列表中不可见，仅管理员可查看)
   * - is_locked:         锁定(列表可见但内容遮蔽，显示"已被封禁")
   * - is_reply_disabled: 禁止回复(内容可见但不能跟帖)
   * - is_pinned:         置顶
   * - is_featured:       精华
   * ================================================================ */
  const postsExists = await knex.schema.hasTable('forum_posts');
  if (!postsExists) {
    await knex.schema.createTable('forum_posts', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('board_id').unsigned().notNullable().comment('所属版块ID');
      table.integer('user_id').unsigned().notNullable().comment('发帖人用户ID');
      table.integer('group_id').unsigned().nullable()
        .comment('发帖人所在组ID(冗余快照,用于组隔离查询加速)');

      /* 内容 */
      table.string('title', 200).notNullable().comment('帖子标题');
      table.text('content').notNullable().comment('帖子内容(Markdown格式)');

      /* 管理状态(五个独立布尔,互不影响) */
      table.boolean('is_pinned').defaultTo(false).comment('置顶');
      table.boolean('is_featured').defaultTo(false).comment('精华');
      table.boolean('is_hidden').defaultTo(false).comment('隐藏(列表不可见)');
      table.boolean('is_locked').defaultTo(false).comment('锁定(内容遮蔽不可查看)');
      table.boolean('is_reply_disabled').defaultTo(false).comment('禁止回复');

      /* 统计计数(冗余字段) */
      table.integer('view_count').defaultTo(0).comment('浏览数');
      table.integer('reply_count').defaultTo(0).comment('回复数');
      table.integer('like_count').defaultTo(0).comment('点赞数');
      table.integer('favorite_count').defaultTo(0).comment('收藏数');

      /* 编辑追踪 */
      table.integer('edit_count').defaultTo(0).comment('编辑次数');
      table.datetime('last_edited_at').nullable().comment('最后编辑时间');

      /* 最后回复信息(冗余,列表排序用) */
      table.datetime('last_reply_at').nullable().comment('最后回复时间');
      table.integer('last_reply_user_id').unsigned().nullable().comment('最后回复人ID');

      /* 管理信息 */
      table.string('ip_address', 45).nullable().comment('发帖IP(管理员可见)');

      /* 时间戳与软删除 */
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.datetime('deleted_at').nullable().comment('软删除时间');

      /* 索引 - 覆盖主要查询场景 */
      table.index(['board_id', 'is_hidden', 'deleted_at', 'is_pinned', 'last_reply_at'],
        'idx_post_board_list');
      table.index(['user_id', 'deleted_at'], 'idx_post_user');
      table.index(['board_id', 'is_hidden', 'deleted_at', 'created_at'], 'idx_post_latest');
      table.index('group_id', 'idx_post_group');
    });
    console.log('forum_posts 表创建成功');
  } else {
    console.log('forum_posts 表已存在，跳过创建');
  }

  /* ================================================================
   * 3. forum_replies 回复表
   * 
   * 扁平评论结构：所有回复直属帖子，通过 reply_to_id 引用楼中楼
   * floor_number 楼层号在创建时自增分配
   * ================================================================ */
  const repliesExists = await knex.schema.hasTable('forum_replies');
  if (!repliesExists) {
    await knex.schema.createTable('forum_replies', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('post_id').unsigned().notNullable().comment('所属帖子ID');
      table.integer('user_id').unsigned().notNullable().comment('回复人用户ID');

      /* 楼中楼引用(可选,扁平模式下为NULL) */
      table.integer('reply_to_id').unsigned().nullable()
        .comment('回复某条评论的ID(楼中楼引用)');
      table.integer('reply_to_user_id').unsigned().nullable()
        .comment('被回复人的用户ID');

      /* 内容 */
      table.text('content').notNullable().comment('回复内容(Markdown格式)');
      table.integer('floor_number').notNullable().comment('楼层号(从1开始自增)');

      /* 状态 */
      table.boolean('is_hidden').defaultTo(false).comment('隐藏(版主/管理员操作)');
      table.integer('like_count').defaultTo(0).comment('点赞数');

      /* 编辑追踪 */
      table.integer('edit_count').defaultTo(0).comment('编辑次数');
      table.datetime('last_edited_at').nullable().comment('最后编辑时间');

      /* 管理信息 */
      table.string('ip_address', 45).nullable().comment('回复IP(管理员可见)');

      /* 时间戳与软删除 */
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.datetime('deleted_at').nullable().comment('软删除时间');

      /* 索引 */
      table.index(['post_id', 'deleted_at', 'floor_number'], 'idx_reply_post');
      table.index(['user_id', 'deleted_at'], 'idx_reply_user');
      table.index('reply_to_id', 'idx_reply_to');
    });
    console.log('forum_replies 表创建成功');
  } else {
    console.log('forum_replies 表已存在，跳过创建');
  }

  /* ================================================================
   * 4. forum_attachments 附件表
   * 
   * 多态关联：通过 target_type + target_id 关联帖子或回复
   * 支持 OSS 和本地双模式存储
   * ================================================================ */
  const attachmentsExists = await knex.schema.hasTable('forum_attachments');
  if (!attachmentsExists) {
    await knex.schema.createTable('forum_attachments', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 多态关联 */
      table.enum('target_type', ['post', 'reply']).notNullable()
        .comment('关联目标类型: post帖子/reply回复');
      table.integer('target_id').unsigned().notNullable()
        .comment('关联目标ID(帖子ID或回复ID)');
      table.integer('user_id').unsigned().notNullable().comment('上传者用户ID');

      /* 文件信息 */
      table.enum('file_type', ['image', 'file']).notNullable()
        .comment('文件类型: image图片/file文档附件');
      table.string('file_name', 255).notNullable().comment('原始文件名');
      table.string('file_path', 500).notNullable().comment('存储路径(OSS key或本地相对路径)');
      table.string('thumbnail_path', 500).nullable().comment('缩略图路径(仅图片)');
      table.integer('file_size').unsigned().defaultTo(0).comment('文件大小(字节)');
      table.string('mime_type', 100).nullable().comment('MIME类型');
      table.enum('storage_mode', ['local', 'oss']).defaultTo('local')
        .comment('存储模式: local本地/oss阿里云');

      /* 排序(同一帖子/回复内的附件顺序) */
      table.integer('sort_order').defaultTo(0).comment('排序序号');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 索引 */
      table.index(['target_type', 'target_id'], 'idx_attachment_target');
      table.index('user_id', 'idx_attachment_user');
    });
    console.log('forum_attachments 表创建成功');
  } else {
    console.log('forum_attachments 表已存在，跳过创建');
  }

  /* ================================================================
   * 5. forum_likes 点赞表
   * 
   * 多态关联：支持帖子和回复的点赞
   * 唯一约束防止重复点赞
   * ================================================================ */
  const likesExists = await knex.schema.hasTable('forum_likes');
  if (!likesExists) {
    await knex.schema.createTable('forum_likes', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('user_id').unsigned().notNullable().comment('点赞人用户ID');
      table.enum('target_type', ['post', 'reply']).notNullable()
        .comment('目标类型: post帖子/reply回复');
      table.integer('target_id').unsigned().notNullable()
        .comment('目标ID(帖子ID或回复ID)');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 唯一约束:同一用户对同一目标只能点赞一次 */
      table.unique(['user_id', 'target_type', 'target_id'], 'uk_like_user_target');

      /* 索引 */
      table.index(['target_type', 'target_id'], 'idx_like_target');
    });
    console.log('forum_likes 表创建成功');
  } else {
    console.log('forum_likes 表已存在，跳过创建');
  }

  /* ================================================================
   * 6. forum_favorites 收藏表
   * 
   * 用户收藏帖子(只支持帖子级别收藏)
   * ================================================================ */
  const favoritesExists = await knex.schema.hasTable('forum_favorites');
  if (!favoritesExists) {
    await knex.schema.createTable('forum_favorites', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('user_id').unsigned().notNullable().comment('收藏人用户ID');
      table.integer('post_id').unsigned().notNullable().comment('收藏的帖子ID');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 唯一约束:同一用户对同一帖子只能收藏一次 */
      table.unique(['user_id', 'post_id'], 'uk_favorite_user_post');

      /* 索引 */
      table.index('post_id', 'idx_favorite_post');
    });
    console.log('forum_favorites 表创建成功');
  } else {
    console.log('forum_favorites 表已存在，跳过创建');
  }

  /* ================================================================
   * 7. forum_moderators 版主表
   * 
   * 超管可以为任意版块指定版主用户
   * 组管理员对 visibility=group 的本组版块自动拥有版主权限(不入表)
   * ================================================================ */
  const moderatorsExists = await knex.schema.hasTable('forum_moderators');
  if (!moderatorsExists) {
    await knex.schema.createTable('forum_moderators', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('board_id').unsigned().notNullable().comment('版块ID');
      table.integer('user_id').unsigned().notNullable().comment('版主用户ID');
      table.integer('appointed_by').unsigned().notNullable().comment('指定人(超管)用户ID');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 唯一约束:同一版块同一用户只能指定一次 */
      table.unique(['board_id', 'user_id'], 'uk_moderator_board_user');

      /* 索引 */
      table.index('user_id', 'idx_moderator_user');
    });
    console.log('forum_moderators 表创建成功');
  } else {
    console.log('forum_moderators 表已存在，跳过创建');
  }

  /* ================================================================
   * 8. forum_notifications 论坛通知表
   * 
   * 存储论坛相关通知：@提及、回复通知、点赞通知、系统通知
   * extra_data JSON字段存储扩展信息(帖子标题摘要等)避免多次JOIN
   * ================================================================ */
  const notificationsExists = await knex.schema.hasTable('forum_notifications');
  if (!notificationsExists) {
    await knex.schema.createTable('forum_notifications', (table) => {
      /* 主键 */
      table.increments('id').primary();

      /* 关联 */
      table.integer('user_id').unsigned().notNullable().comment('接收人用户ID');
      table.integer('sender_id').unsigned().notNullable().comment('触发人用户ID');

      /* 通知类型与内容 */
      table.enum('type', ['mention', 'reply', 'like', 'system']).notNullable()
        .comment('通知类型: mention@提及/reply回复/like点赞/system系统');
      table.integer('post_id').unsigned().nullable().comment('关联帖子ID');
      table.integer('reply_id').unsigned().nullable().comment('关联回复ID');
      table.string('content', 500).notNullable().comment('通知摘要文本');
      table.json('extra_data').nullable()
        .comment('扩展数据JSON(帖子标题、版块名等,避免查询时JOIN)');

      /* 状态 */
      table.boolean('is_read').defaultTo(false).comment('是否已读');

      /* 时间戳 */
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 索引 */
      table.index(['user_id', 'is_read', 'created_at'], 'idx_notification_user_unread');
      table.index(['user_id', 'created_at'], 'idx_notification_user_time');
    });
    console.log('forum_notifications 表创建成功');
  } else {
    console.log('forum_notifications 表已存在，跳过创建');
  }

  /* ================================================================
   * 9. 在 system_modules 表中插入论坛模块记录
   * 
   * 字段参考现有模块(chat/agent/wiki)的实际值
   * 关键字段：menu_icon(非icon), proxy_path(NOT NULL唯一键)
   * ================================================================ */
  const forumModule = await knex('system_modules')
    .where('name', 'forum')
    .first();
  if (!forumModule) {
    await knex('system_modules').insert({
      name: 'forum',
      display_name: '社区论坛-Forum',
      description: '平台社区论坛，支持版块管理、帖子发布、回复讨论、@提及、点赞收藏等功能',
      module_type: 'fullstack',
      module_category: 'system',
      route_path: '/forum',
      open_mode: 'iframe',
      menu_icon: 'CommentOutlined',
      proxy_path: '/forum',
      auth_mode: 'jwt',
      is_active: 1,
      can_disable: 1,
      sort_order: 55,
      allowed_groups: null,
      config: null
    });
    console.log('system_modules 论坛模块记录插入成功');
  } else {
    console.log('system_modules 论坛模块记录已存在，跳过插入');
  }

  console.log('===== 论坛模块数据库迁移全部完成 =====');
};

exports.down = async function(knex) {
  /* 按依赖顺序反向删除 */
  await knex.schema.dropTableIfExists('forum_notifications');
  await knex.schema.dropTableIfExists('forum_moderators');
  await knex.schema.dropTableIfExists('forum_favorites');
  await knex.schema.dropTableIfExists('forum_likes');
  await knex.schema.dropTableIfExists('forum_attachments');
  await knex.schema.dropTableIfExists('forum_replies');
  await knex.schema.dropTableIfExists('forum_posts');
  await knex.schema.dropTableIfExists('forum_boards');

  /* 删除系统模块记录 */
  await knex('system_modules').where('name', 'forum').delete();

  console.log('论坛模块所有表已删除');
};
