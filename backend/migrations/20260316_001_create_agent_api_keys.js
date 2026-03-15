/**
 * 数据库迁移：创建 agent_api_keys 表
 * 
 * 用途：存储Agent工作流的外部API访问密钥
 * 每个已发布的工作流可以生成一个API Key，供外部系统调用
 * 
 * 功能：
 * - API Key绑定到单个工作流（一对一）
 * - 支持访问控制：频率限制、IP白名单、有效期、调用次数上限
 * - 调用统计：总调用次数、最后调用时间
 * - 多轮对话会话管理
 */

exports.up = async function(knex) {
  /* 检查表是否已存在（幂等性） */
  const exists = await knex.schema.hasTable('agent_api_keys');
  if (exists) {
    console.log('agent_api_keys 表已存在，跳过创建');
    return;
  }

  await knex.schema.createTable('agent_api_keys', (table) => {
    /* 主键 */
    table.bigIncrements('id').primary();

    /* 工作流关联（一对一） */
    table.bigInteger('workflow_id').unsigned().notNullable().comment('关联的工作流ID');
    table.bigInteger('user_id').unsigned().notNullable().comment('工作流创建者ID（积分消耗方）');

    /* API Key */
    table.string('api_key', 255).notNullable().comment('API密钥，格式: ak-{hash}');
    table.string('api_key_hash', 64).notNullable().comment('API密钥的SHA-256哈希，用于快速查找');
    table.string('key_name', 100).defaultTo('默认密钥').comment('密钥名称/备注');

    /* 状态 */
    table.enum('status', ['active', 'inactive', 'expired']).defaultTo('active').comment('密钥状态');

    /* 访问控制 */
    table.integer('rate_limit_per_minute').defaultTo(10).comment('每分钟最大调用次数');
    table.text('ip_whitelist').nullable().comment('IP白名单JSON数组，为空则不限制');
    table.datetime('expires_at').nullable().comment('过期时间，为空则永不过期');
    table.integer('max_calls').nullable().comment('最大调用次数上限，为空则不限制');

    /* 调用统计 */
    table.integer('total_calls').defaultTo(0).comment('累计调用次数');
    table.integer('total_credits_used').defaultTo(0).comment('累计消耗积分');
    table.datetime('last_called_at').nullable().comment('最后调用时间');

    /* 时间戳 */
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    /* 索引 */
    table.unique('workflow_id', 'uk_workflow_id');
    table.unique('api_key_hash', 'uk_api_key_hash');
    table.index('user_id', 'idx_user_id');
    table.index('status', 'idx_status');
    table.index('expires_at', 'idx_expires_at');
  });

  console.log('agent_api_keys 表创建成功');

  /* 创建外部API调用日志表 */
  const logExists = await knex.schema.hasTable('agent_api_call_logs');
  if (!logExists) {
    await knex.schema.createTable('agent_api_call_logs', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('api_key_id').unsigned().notNullable().comment('API Key ID');
      table.bigInteger('workflow_id').unsigned().notNullable().comment('工作流ID');
      table.bigInteger('user_id').unsigned().notNullable().comment('工作流创建者ID');
      table.string('call_type', 20).notNullable().comment('调用类型: run/chat');
      table.string('session_id', 100).nullable().comment('对话会话ID（chat模式）');
      table.string('caller_ip', 45).nullable().comment('调用方IP');
      table.integer('credits_used').defaultTo(0).comment('本次消耗积分');
      table.integer('duration_ms').nullable().comment('执行耗时(毫秒)');
      table.enum('status', ['success', 'failed', 'error']).defaultTo('success').comment('调用状态');
      table.text('error_message').nullable().comment('错误信息');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index('api_key_id', 'idx_api_key_id');
      table.index('workflow_id', 'idx_log_workflow_id');
      table.index('created_at', 'idx_log_created_at');
      table.index('session_id', 'idx_session_id');
    });
    console.log('agent_api_call_logs 表创建成功');
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('agent_api_call_logs');
  await knex.schema.dropTableIfExists('agent_api_keys');
};
