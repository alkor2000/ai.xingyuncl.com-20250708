# P03 交接账本受限数据库角色：运维手册候选（2026-09-21，未执行）

正式运行时（`backend/src/services/artifactHandoff/formalRuntime.js`）只用一个**独立的受限 MySQL 账号**连接四张账本表，启动时核验它的授权恰好是账本 DML、不多不少；现有 ALL PRIVILEGES 的应用账号被显式拒绝充当账本角色（`handoff_ledger_role_missing`）。本手册只列步骤与精确语句，**不含任何生产执行**；执行归运维，并受 fc1+e1 登记 G3–G5 门约束（见 `p03-release-readiness-candidate.md`）。星云站按用户决定不接交接，不建此角色；其应用账号全局 `ALL PRIVILEGES ON *.*` 是独立加固项，不在本手册顺带处理。

## 顺序

1. **建表**：把 `backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js` 晋级到 `backend/migrations/`（授权后），按 dev/RELEASE.md 第三节"加法式，迁移先行"执行（北大站 `make deploy-docker` 自动跑 knex，星云站 `make migrate`）。表结构与 `mysqlStore.SCHEMA` 逐字一致。
2. **建账号**：运维在 MySQL 8 上创建登录账号（口令由运维生成、只进部署配置，不进仓库、不进日志）：
   ```sql
   CREATE USER 'p03_handoff'@'<应用连接来源主机>' IDENTIFIED BY '<运维生成的口令>';
   ```
   北大站 backend 容器经 compose 内网连 `mysql` 服务，来源主机按现有应用账号的 host 部分取（`SELECT host FROM mysql.user WHERE user=<应用账号>`），不要用 `'%'` 宽泛匹配。
3. **授权**：只执行下列语句（由 `restrictedRoleGrants({ database: '<DB_NAME>', user: 'p03_handoff', host: '<主机>' })` 生成，`sourceTables` 为空——生产的来源事实经应用模型读取，账本角色不需要读业务表）：
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_owners`     TO 'p03_handoff'@'<主机>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_operations` TO 'p03_handoff'@'<主机>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_snapshots`  TO 'p03_handoff'@'<主机>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_keys`       TO 'p03_handoff'@'<主机>';
   ```
   不要加 `GRANT OPTION`、不要 `ON <DB_NAME>.*`、不要任何 `*.*` 上除隐含 USAGE 以外的权限——就绪核验会以 `handoff_ledger_role_too_broad` 拒绝。
4. **配置**（只在授权开启时；默认部署不设）：`P03_HANDOFF_DB_USER=p03_handoff`、`P03_HANDOFF_DB_PASSWORD=<口令>`，其余 `P03_HANDOFF_*` 见 `p03-instance-binding-candidate.json` 的 `env_candidate_pku`；`IDENTITY_DEPLOYMENT_INSTANCE_KEY` 必须已由 enrollment 流程写入 `pku-ai-platform-prod`（当前运行容器为空）。
5. **核验（只读）**：
   ```bash
   cd backend && node scripts/p03-ledger-readiness.cjs
   ```
   输出只有事实（库名、MySQL 版本、授权条数、四表在位）或固定码：`handoff_ledger_role_too_broad` / `handoff_ledger_role_missing` / `handoff_ledger_table_missing` / `handoff_ledger_schema_mismatch` / `handoff_ledger_database_mismatch` / `handoff_ledger_version_unsupported` / `handoff_ledger_unavailable`。同一核验在运行时启动时再执行一次，不通过即启动失败关闭。

## 回退

- 关闭开关（去掉 `P03_HANDOFF_ENABLED` 或设 `false`）即停：运行时不再连接账本、不调对端；表和账号可以留着。
- 收回账号：`REVOKE ALL PRIVILEGES ON *.* FROM 'p03_handoff'@'<主机>'; DROP USER 'p03_handoff'@'<主机>';`
- 删表：迁移 `down`（按 keys/snapshots → operations → owners 顺序），**丢账本数据**；执行前按 dev/RELEASE.md 备份门备份，或从 `/var/backups/ai-platform/mysql/` 最近 dump 恢复。

## 隔离演练

`dev/p03-ledger-migration-check.py` 在一次性 mysql:8.0 容器上以本地线上副本的 schema 前像演练：迁移 up/幂等/down、与 `SCHEMA` 直建的 `SHOW CREATE TABLE` 逐字节相等、受限账号通过就绪核验、ALL PRIVILEGES 账号/缺一表授权/错库/缺表被拒、四表备份→删除→恢复→再核验、部分建表后续跑。证据 `storage/private/p03-handoff-validation/ledger-migration/`。
