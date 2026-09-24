/**
 * 迁移候选：P03 教师成果交接源侧持久账本（p03_handoff_owners / operations / snapshots / keys）
 *
 * 为什么改：teacher-artifact-handoff/1（fc1+e1）正式运行时需要跨重启的 owner 锚锁、W/R 恢复窗口与幂等键，
 *          文件暂存只用于开发草案；账本表由 backend/src/services/artifactHandoff/mysqlStore.js 的 SCHEMA 定义，
 *          本文件逐字复用同一批 DDL，不另写一份可能漂移的表结构。
 * 影响多少行：0 行——纯加法，四张新表，不触碰任何现有表、列或索引。
 * 能否重复执行：能。CREATE TABLE IF NOT EXISTS；knex_migrations 记录后不会再跑；直接重跑 up() 也无副作用。
 * down：真的回退——按外键顺序删除四张表（keys / snapshots → operations → owners）。**回退会丢失账本数据**，
 *       只在确认没有在途 operation（或已按 dev/RELEASE.md 备份门备份）后执行。
 *
 * 为什么在 backend/migrations-candidates/ 而不是 backend/migrations/：
 *   knexfile.js 的 migrations.directory 是 ./migrations；ai.pkuailab.com 的 `make deploy-docker` 会在切换容器前
 *   自动执行 `knex migrate:latest`，ai.xingyuncl.com 由 `make migrate` 执行。也就是说，文件一旦进入
 *   backend/migrations/ 并合并到 main，下一次 Docker 发布就会在生产建表。本候选在 fc1+e1 登记、G3/G4 生产
 *   迁移授权（见 docs/integrations/p03-release-readiness-candidate.md）之前保持在候选目录，任何启动路径都不会读到它。
 * 晋级步骤（授权后）：`git mv backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js backend/migrations/`
 *   → 本地 `cd backend && npx knex migrate:latest` 演练 → 按 dev/RELEASE.md 第三节"加法式，迁移先行"发布。
 *   受限角色（GRANT 语句）见 docs/integrations/p03-restricted-role-runbook.md，由运维在建表后另行执行。
 *
 * 创建时间：2026-09-21
 */
const { SCHEMA, TABLES } = require('../../src/services/artifactHandoff/mysqlStore');

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
