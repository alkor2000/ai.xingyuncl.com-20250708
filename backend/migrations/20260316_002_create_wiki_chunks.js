/**
 * 数据库迁移：创建 wiki_chunks 表 + wiki_items 增加RAG字段
 * 
 * wiki_chunks: 存储文档分块和向量，用于RAG检索
 * wiki_items: 增加 rag_enabled / index_status / source_type / file_path 字段
 */

exports.up = async function(knex) {
  /* ===== 1. 创建 wiki_chunks 表 ===== */
  const chunksExists = await knex.schema.hasTable('wiki_chunks');
  if (!chunksExists) {
    await knex.schema.createTable('wiki_chunks', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('wiki_id').unsigned().notNullable().comment('所属知识库ID');
      table.integer('version_number').notNullable().comment('所属版本号');
      table.integer('chunk_index').notNullable().comment('分块序号（从0开始）');
      table.text('content').notNullable().comment('分块文本内容');
      table.integer('token_count').defaultTo(0).comment('该块Token数');
      table.integer('char_count').defaultTo(0).comment('字符数');
      table.json('embedding').nullable().comment('向量数据JSON数组(1536维或更多)');
      table.string('embedding_model', 100).nullable().comment('使用的Embedding模型名');
      table.text('metadata').nullable().comment('元数据JSON(标题、页码、段落等)');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      /* 索引 */
      table.index(['wiki_id', 'version_number'], 'idx_wiki_version');
      table.index(['wiki_id', 'chunk_index'], 'idx_wiki_chunk');
    });
    console.log('wiki_chunks 表创建成功');
  }

  /* ===== 2. wiki_items 增加RAG相关字段 ===== */
  const hasRagEnabled = await knex.schema.hasColumn('wiki_items', 'rag_enabled');
  if (!hasRagEnabled) {
    await knex.schema.alterTable('wiki_items', (table) => {
      table.boolean('rag_enabled').defaultTo(false).after('version_count')
        .comment('是否启用RAG向量检索');
      table.enum('index_status', ['none', 'processing', 'completed', 'failed'])
        .defaultTo('none').after('rag_enabled')
        .comment('向量索引状态');
      table.integer('chunk_count').defaultTo(0).after('index_status')
        .comment('分块数量');
      table.enum('source_type', ['text', 'file', 'mixed']).defaultTo('text').after('chunk_count')
        .comment('内容来源类型');
      table.string('file_path', 500).nullable().after('source_type')
        .comment('上传文件路径（file/mixed类型）');
      table.string('file_name', 255).nullable().after('file_path')
        .comment('原始文件名');
      table.integer('file_size').nullable().after('file_name')
        .comment('文件大小(字节)');
      table.datetime('indexed_at').nullable().after('file_size')
        .comment('最后索引完成时间');
    });
    console.log('wiki_items 表已添加RAG字段');
  }

  /* ===== 3. 创建 embedding_config 系统配置（使用system_settings表） ===== */
  const configExists = await knex('system_settings')
    .where('setting_key', 'embedding_config')
    .first();
  if (!configExists) {
    await knex('system_settings').insert({
      setting_key: 'embedding_config',
      setting_value: JSON.stringify({
        provider: 'openrouter',
        api_endpoint: 'https://openrouter.ai/api/v1/embeddings',
        api_key: '',
        model: 'openai/text-embedding-3-small',
        dimensions: 1536,
        chunk_size: 512,
        chunk_overlap: 50,
        top_k: 5
      })
    });
    console.log('embedding_config 默认配置已插入');
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('wiki_chunks');

  const hasRagEnabled = await knex.schema.hasColumn('wiki_items', 'rag_enabled');
  if (hasRagEnabled) {
    await knex.schema.alterTable('wiki_items', (table) => {
      table.dropColumn('rag_enabled');
      table.dropColumn('index_status');
      table.dropColumn('chunk_count');
      table.dropColumn('source_type');
      table.dropColumn('file_path');
      table.dropColumn('file_name');
      table.dropColumn('file_size');
      table.dropColumn('indexed_at');
    });
  }

  await knex('system_settings').where('setting_key', 'embedding_config').delete();
};
