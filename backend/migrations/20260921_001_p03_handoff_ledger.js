/**
 * 迁移：P03 教师成果交接源侧持久账本（p03_handoff_owners / operations / snapshots / keys）
 *
 * 为什么改：teacher-artifact-handoff/1（fc1+e1）正式运行时需要跨重启的 owner 锚锁、W/R 恢复窗口与幂等键，
 *          文件暂存只用于开发草案；账本表由 backend/src/services/artifactHandoff/mysqlStore.js 的 SCHEMA 定义，
 *          本文件逐字复用同一批 DDL，不另写一份可能漂移的表结构。
 * 影响多少行：0 行——纯加法，四张新表，不触碰任何现有表、列或索引。
 * 能否重复执行：能。CREATE TABLE IF NOT EXISTS；knex_migrations 记录后不会再跑；直接重跑 up() 也无副作用。
 * down：真的回退——按外键顺序删除四张表（keys / snapshots → operations → owners）。**回退会丢失账本数据**，
 *       只在确认没有在途 operation（或已按 dev/RELEASE.md 备份门备份）后执行。
 *
 * 2026-10-04 从 backend/migrations-candidates/p03/ 晋级：产品负责人决定两站都建表。
 *   ai.xingyuncl.com 由 `make migrate` 执行，那里的四张表保持为空——发送方按代码只能是北大实例，星云开不起来；
 *   ai.pkuailab.com 由 `make deploy-docker` 在切换容器前执行。建表不打开任何功能：P03_HANDOFF_ENABLED 仍默认关闭。
 *   相对候选的唯一代码改动是下面 mysqlStore 的相对路径（../../src → ../src），与 c99943b 迁移装配包核过的变换一致。
 *   受限角色（GRANT 语句）见 docs/integrations/p03-restricted-role-runbook.md，由运维在建表后另行执行。
 *
 * 创建时间：2026-09-21
 */
const { SCHEMA, TABLES } = require('../src/services/artifactHandoff/mysqlStore');

exports.up = async function up(knex) {
  for (const statement of SCHEMA) {
    await knex.raw(statement); // CREATE TABLE IF NOT EXISTS ... ENGINE=InnoDB（ascii_bin 标识列，JSON 记录列）
  }
  console.log(`P03 交接账本表就位：${Object.values(TABLES).join(', ')}`);
};

exports.down = async function down(knex) {
  for (const name of ['keys', 'snapshots', 'operations', 'owners']) {
    await knex.raw(`DROP TABLE IF EXISTS \`${TABLES[name]}\``);
  }
  console.log('P03 交接账本表已删除（账本数据随之丢失）');
};

// 供演练脚本与就绪核验读取；不改变 knex 的 up/down 约定。
exports.tables = Object.values(TABLES);
