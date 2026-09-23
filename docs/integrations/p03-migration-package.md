# P03 迁移装配准备（2026-09-23，未晋级、未上线）

**已解决：**原候选直接移动到 `backend/migrations/` 会报 `MODULE_NOT_FOUND`。新增离线装配工具，在新临时目录将唯一一处导入从 `../../src/.../mysqlStore` 改为 `../src/.../mysqlStore`，复制同版本 mysqlStore 与 source。原迁移候选和真实迁移目录均不改。旧文档的直接 `git mv` 步骤不能单独执行。

## 固定输入与使用

输入提交 `77a9ccfe2cab8cc7911e6637c249ee6ff192b92f`；工具逐字核对 Git 对象和当前树中的迁移、mysqlStore、source、前后端 package.json/lock 共七项。无新增依赖，不读 `.env`，不搜索其他工作树，不连接数据库。

```bash
# 在本候选仓库根执行；默认只校验并输出清单，零文件写入
node backend/scripts/p03-migration-package.cjs
# 显式生成一个新的 /tmp/p03-migration-package-* 目录
node backend/scripts/p03-migration-package.cjs --write-staging
# 复核上一步返回的 staging_directory；拒绝错布局、额外文件、符号链接和字节漂移
node backend/scripts/p03-migration-package.cjs --verify-staging <staging_directory>
```

仅接受输入提交上述完整 SHA、目标 `pku-ai-platform-prod`。错提交、错前像、错布局、星云目标、真实目录已存在该迁移均具名拒绝。清单写明 `production_authorized:false`、`runtime_enabled:false`；没有部署或执行 SQL 的命令。默认预演不变更开关。

输出布局与 SHA256：

| 临时目录内文件 | SHA256 |
|---|---|
| `backend/migrations/20260921_001_p03_handoff_ledger.js` | `1f9a8a87fb7d96320c087853d151712bf67835161c6a960b1b2805ff4395fa81` |
| `backend/src/services/artifactHandoff/mysqlStore.js` | `065beb58ac682af4e755da8ff5a2e2676c1e0a3b1bd1c9b425a02b54e49b80c3` |
| `backend/src/services/artifactHandoff/source.js` | `625a8702ddb1bdcc92266962d347b722c6795fe87846e6e187de128d4865e0d7` |
| `manifest.json` | `88c2334c6a0a0ac3d70b38dd4a4fa128e1f0b5d365ecc9646a7c76ae47818397` |

文件内容可重建；临时目录名每次不同。不自动把输出拷回仓库或服务器。

## 有界验证

`node --test backend/tests/p03-migration-package.test.cjs` 验默认零写、两次生成一致、实际加载及错误拒绝。`python3 dev/p03-migration-package-check.py` 只创建自有一次性 mysql:8.0、随机回环端口与合成业务哨兵；不读取既有本地/生产数据库，不启动完整后端，不运行外仓代码。

实际通过：Knex up、原路径与发布布局的 SHOW CREATE TABLE 一致、重复 Knex/直接 up 保留数据、受限角色核验、越权/缺授权/错库拒绝、快照不可改、重建store后读取、恢复期与hold保留、部分建表续跑、缺表拒绝与修复、down仅删四张账本表、再up。默认关闭时零建池。演练容器已删除；这不是生产备份恢复或真实教师验收。

## 生产角色最小清单（未执行）

北大实例经单独核验后，由运维建立独立账号。口令不进脚本/仓库；`DB_NAME`、`SOURCE_HOST` 须取真实核验事实，不用 `%`。账本角色仅四表 DML，不读业务表、不授DDL/GRANT OPTION：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_owners` TO 'p03_handoff'@'<SOURCE_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_operations` TO 'p03_handoff'@'<SOURCE_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_snapshots` TO 'p03_handoff'@'<SOURCE_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `<DB_NAME>`.`p03_handoff_keys` TO 'p03_handoff'@'<SOURCE_HOST>';
```

## 交接与教师验证

本包只证明文件装配及隔离数据库行为可用。Identity **000030 正式迁移与匹配构建**、TE-DNA **当前发布父版的固定接收候选**、北大 enrollment/policy/pairs/角色/TLS/容器配置和最新三端联调仍待。星云不接通；不改变学生资格或附件复制权。

真实发布仍须核定北大专用迁移安排；不能将临时文件放入共享 main 的自动迁移目录，令星云日后跟跑。生产 down 会删除账本，通常退代码/关开关并保留表，不能照搬隔离演练的删除步骤。

条件齐备后沿 [教师测试单](P03-SAVE-TO-LIBRARY-TEST.md) 验“选一段→预览→保存”，再到 TE-DNA「我的资料」查看并在备课/课件采用；重试等待、重开与过期也要实测。本包不填真人通过记录，也不解除原外仓审核 HOLD。
