# P03 受限持久 release：发布/回滚就绪清单（候选，未发布）

日期：2026-09-21。派单 CTRL-20260921-PRACTICE-BATCH-01 第 1/4 项。本文只陈述已有实际证据与缺口，不是发布授权，也不改变任何生产配置。生产双站当前已报告版本为并行反馈项目的 `c4a6e86`；本仓工作副本基线 `e4d52d1` 与本分支提交都不是线上验证。

## 1 组件矩阵：真实 vs 模拟

| 组件 | 本轮实际使用 | 真实生产/正式对端 |
|---|---|---|
| 源持久层 | 隔离 `mysql:8.0` 容器、随机库、实验创建的受限角色；`MySQLHandoffStore` 多 owner 锚锁 | 未接：生产应用账号仍 ALL PRIVILEGES，受限角色未创建，业务侧锚锁未接线 |
| 源来源事实（教师资格/复制权/内容） | 合成 `p03_lab_facts` 行；Jest 用显式策略对象；**发起资格候选 `handoffAuthority.js` 已接真实用户模型：活跃/未过期/非影子（`users.uuid_source='sso'`）** | 未接：学生组映射列（决-12）未入库；逐附件持久复制权待事实；教师由 TE-DNA 判定 |
| Identity（issue/revoke） | 持久层实验：I03 Go/PG18 旧实验提供方（draft）；**V10–13 与正式三端：真实 `internal/artifacthandoff` 提供方（rc3 固定包 14b9852，`EnableFormalCandidate()` + formal policy 行 + `formal_pairs`，实验时钟注入）** | 未接：正式 profile 未冻结登记，`cmd/pkuailab-id` 不开启候选，生产无 policy/pairs 行 |
| 目标 TE-DNA | 假 SQLite 目标（实验）；假目标对象（Jest）；**同版三端：未修改的 T11 `cmd/t11-lab`（真实 store/handlers，PG16 隔离库，Identity 拆分角色模型）draft 八场景与正式 wire（e1，`formal:true`）八场景均通过** | 未接：T11 候选未合入/未发布/未启用；生产迁移与生产角色未建 |
| 传输 | 回环 HTTP（draft 客户端）；**正式：`I03FormalClient` 经 `I03HttpsTransport`（固定 origin/443/系统 CA），实验 TLS 对端 5 项业务链 + 21 项传输；三端源跳数走 TLS 对 TE e1 与 r2 各八场景通过；Identity 以 051652b 字节在真实 main 上三跳全 TLS 五门 + 4/4（`identity-i03-g7-all-tls-20260921T131735Z`）** | 生产 TLS 事实（证书链、出网）未在生产核验 |
| 时间源 | 注入时钟（Jest/实验 clock 服务） | 生产依赖 NTP，未验证 |

## 2 V10–13 结果（源侧定向证据；假对端）

| 向量 | 结果 | 证据 |
|---|---|---|
| V10 首 issue 丢响应 / 在途 not_prepared / 有界对账 | 3 项通过：同一 operation 经 status 取回 W 后续原 prepare；结算窗内 not_prepared 只 `retry_later`；3 次可重试失败后 `reconciliation_required`，运维 `reconcile()` 带依据关闭 | `artifactHandoffI03Window.test.js` |
| V11 过 freeze+30d 未到 R | 通过：无正文记录仍在，status 票 = now+60，恢复原资源，不建第二资源 | 同上 |
| V12a 写票截至 W | 通过：W-1 票 `expires_at=W`；跨 W 兑换被拒；目标无资源；到 W 不再申写票 | 同上 + `artifactHandoffI03FormalClient.test.js`（票 > W 拒绝、不发目标） |
| V12b 查询票截至 R | 通过：R-1 票 `expires_at=R`；到 R 不申授权、cancel 拒绝、只读旧结果；R+1d 后元数据删除 | 同上 |
| V13 L≤now<W | 通过：未 release 记 expired；已成功者在正文清理后仍恢复成功 | 同上 |

真实提供方运行 V10–13：**已做**（`dev/p03-formal-provider-check.py`，2026-09-21 16:5x）。Identity 固定包 25b5ff1（契约 rc2 `af86a5cd…`）；9 场景在真实 Go/PG18 提供方上通过、race、0 跳过：formal_success、v10_lost_first_issue（W 保持首次持久值）、v10_first_issue_in_flight（结算窗内 not_prepared 只 retry_later，W 取第二次持久值）、v11_recovery_window（freeze+30d+1 仍签 status 票 now+60）、v12a_write_ticket_cut（**真实提供方在 W−1 签出的 commit 票 `expires_at=W`**，跨 W 兑换 401 ticket_expired，目标无资源）、v12b_status_ticket_cut（**R−1 的 status 票 `expires_at=R`**；R 时源不申授权、cancel 拒绝；提供方直接探测 410 operation_expired）、v13 两半、reconciliation_exit（提供方零操作、hold 行不清理、运维关闭后回收）。真实：提供方与其 PG 持久化；模拟/注入：目标（Node 假目标向真实提供方兑换）、时间源（三端注入时钟）、教师/复制权事实。证据 `storage/private/p03-handoff-validation/formal-provider/`。2026-09-21 18:1x 在 rc3 提供方 `14b9852`（评审文本修订 .4 `8126f539…` 单独固定、验证记录只记不锁）上复跑通过，证据已绑定本轮源侧字节（只读 status 规则修正、worker）；同时复跑 `dev/p03-durable-check.py` 23 通过事件重绑持久层实验证据。

## 3 本轮改动清单（分支 `codex/p03-handoff-adapter`）

- 源侧：`backend/src/services/artifactHandoff/{mysqlStore,store,i03Source,i03Client,i03Draft,i03HttpsTransport}.js`
- 测试：`backend/src/__tests__/unit/services/artifactHandoff{I03Window,I03FormalClient,BindingCandidate}.test.js`，helpers `p03FormalPeers.js`、`p03I03Fixture.js`
- 隔离实验：`dev/p03-mysql-fixture.cjs`、`dev/p03-mysql-worker.cjs`、`dev/p03-durable-scenarios.py`、`dev/p03-durable-check.py`、`dev/p03-provider-overlay.go`；真实提供方 V10–13：`dev/p03-formal-provider-check.py`、`dev/p03-formal-scenarios.py`、`dev/p03-formal-provider-overlay.go`、`dev/p03-formal-target.cjs`
- 文档：`docs/integrations/p03-source-handoff.md`（9/21 节）、`docs/integrations/p03-instance-binding-candidate.json`、本文
- 2026-09-22 产品入口（ENTRY-01）：`backend/src/routes/artifactHandoffEntry.js`、`frontend/src/components/chat/ArtifactHandoff.jsx`、`formalRuntime.js`（`P03_HANDOFF_LAB`）、`i03Source.js`（`list`）、`dev/p03-triad/{entry_overlay.go,entry_scenarios.py,candidate-entry.json}`、`dev/p03-entry-{e2e.cjs,web.mjs}`；精确清单与候选部署包见 `docs/integrations/p03-entry-deploy-candidate.md`
- 私有证据（不入库）：`storage/private/p03-handoff-validation/durable-release-candidate-20260921.json` 及其引用文件

## 4 同版运行清单（本轮实验使用的版本）

| 项 | 值 |
|---|---|
| 源工作副本 | `codex/p03-handoff-adapter` @ `e4d52d1`（未提交改动经本分支后续提交固化；文件 SHA 在私有证据 `input_sha256`） |
| Identity 实验提供方（持久层实验） | `/home/hanying/pkuailab-id` @ `b0a551ee18169aec2c376117826f6697e31ea05f`，`dev/i03/provider`（draft） |
| Identity 真实提供方候选（V10–13） | 首跑固定包 `25b5ff1`（rc2 提供方）；复跑 rc3 `14b9852035d908bc27af9ce3691ef613fdd1b062`（新增 formal_pairs 白名单，运行时 HEAD 941fa66，提供方路径与固定包一致），`internal/artifacthandoff`；候选文档 rc2-provider SHA `df54623c…`、rc3 SHA `90c21a95…` |
| T11 候选 | 刷新候选（第一包为基重整，33 源）parent `5089cb645147df626705ab906c79c617f016dd7f`，manifest `0eff21a1825f9463a3eba91dc87096806f940bd12520e0323d53d59c2e10f607`、closure `3dc4d0cd…`，schema 前像 `f4264ea8…`，迁移 `20260921_03`（`dev/p03-triad/candidate.json` 固定；`cmd/t11-lab` 以 `-race` 构建） |
| 契约 | rc1 `aa685614…`、rc2 `af86a5cd…`；运行 wire `i03-draft-0.1`；formal 候选 `teacher-artifact-handoff/1` |
| 镜像 | mysql:8.0 `sha256:7dcddc01…`、postgres:18 `sha256:4ef4dbc9…` |
| 测试 | P03 10 套 145 通过（含 V14–V17）；实验 23 通过/race/0 跳过；后端全量 795 通过，6 项既有失败（ImageService/MessageService，HEAD 既有） |

## 5 发布就绪清单（候选）

| 项 | 状态 | 依据/缺口 |
|---|---|---|
| 加法迁移 | **候选就绪，未晋级** | `backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js`（knex，复用 `SCHEMA`）；隔离演练通过（up/幂等/down/备份恢复/部分状态/失败迁移账号）；**进入 `backend/migrations/` 即在下次 `make deploy-docker` 自动执行**，G3/G4 授权前保持候选目录 |
| 数据库角色 | 未建（手册就绪） | `docs/integrations/p03-restricted-role-runbook.md`：精确 GRANT、只读核验脚本 `backend/scripts/p03-ledger-readiness.cjs`、回退；运行时以 `SHOW GRANTS` 精确核验，应用账号被拒；生产应用账号仍 ALL PRIVILEGES（星云全局 `ON *.*`，独立加固项） |
| 配置 | 候选 | `p03-instance-binding-candidate.json`；`P03_HANDOFF_ENABLED=false` 为默认；北大站缺显式实例键（须经 enrollment 流程） |
| 编排装配 | **已做（默认关闭）** | `formalRuntime.js` + `server.js` 启动钩子：`P03_HANDOFF_ENABLED` 未设/false 关闭；true 严格构造并就绪核验，任一事实缺失启动失败关闭；非法值配置错误；`I03DraftSource` 的 production 拒绝原样 |
| 路由 | **已挂，默认不可用** | `/api/p03/handoffs`（`routes/artifactHandoffEntry.js`，登录后）只读 `app.locals.p03Handoff`：运行时未开启时 capability 回 `available:false`、其余 `503 handoff_disabled`，不建池/读凭据/调对端；前端入口只在 capability 为 true 时渲染。真实链路隔离验收见 `p03-entry-deploy-candidate.md` §3 |
| 回滚 | 就绪但未演练 | 关闭开关即停；DDL 为加法可保留；数据库回滚沿 `/var/backups/ai-platform/mysql/` 最近 dump（dev/RELEASE.md 第六节）；未在生产演练 |
| 发布顺序 | 沿 dev/RELEASE.md | 先 ai.xingyuncl.com `make deploy` 再 `make deploy-docker`，两站同一提交；本候选不进入该队列 |
| 只读核对 | 部分 | 两站当前发布版本由发布工具推到 GitHub 的标签证明：`deploy-20260921_110105`（ai.xingyuncl.com）与 `deploy-docker-20260921_110616`（ai.pkuailab.com）均指向 `c4a6e86`（与星云站磁盘 HEAD 只读一致）。北大站实例键、两站 DB 与 Identity 元数据重读仍被会话审核拒绝（Production Reads，已试两次，不再重试），2026-09-21 18:55 用户自行运行 `dev/p03-prod-readonly-facts.sh` 取得：两站 HEAD `c4a6e86`、跟踪文件干净；**北大站运行容器 `IDENTITY_DEPLOYMENT_INSTANCE_KEY` 为空**（确认 9/20 事实）、`IDENTITY_CLIENT_ID=ai-platform-client` 与候选一致；星云站显式为 `xingyun-ai-platform-test` / `ai-platform-xingyun-test-client`（不接交接）。19:2x 复跑取得两站 DB 事实：应用账号均 ALL PRIVILEGES（**星云为全局 `ON *.*`**，北大限本库）；`users.uuid_source` 两站均在（影子账号星云 439 / 北大 11）；`user_groups` 无决-12 映射列；两站均无 `p03_handoff_*` 表（候选零部署）；MySQL 8.0.46 / 8.0.43 |

## 6 接续包

- Identity rc2 提供方与 rc3 候选均已消费（见 §2 与 `p03-product-decisions-20260921.md` rc3 节）；若 Identity 再出新候选版本，重跑 `dev/p03-formal-provider-check.py`（它核对固定 commit 为祖先且提供方路径未变，版本变化须先更新 `PROVIDER_COMMIT`）。rc3 状态模型 `recycled`/`deleted` 已在源侧 formal 路径实现并测试（V14–V16），等待同版冻结后对端才会发出。
- 同版三端隔离联验（draft wire）已完成：`dev/p03-triad/check.py` 固定运行八场景通过（证据 `storage/private/p03-handoff-validation/triad-20260921-t11-refresh-rebase/`），Identity 自己的重绑同版通过。正式 wire 三端运行器亦就绪（`check.py --candidate=candidate-formal.json`，本仓 overlay 启用 Identity 正式候选 + TE fc1 目标 `formal:true`），对 fc1 首跑 1/8 暴露清单 `protocol_version` 差异 → Identity 勘误 01 采纳源侧读法（正式向量本仓逐字节复现）→ TE e1 候选（manifest `bdc6dace…`）后固定运行 **8/8 通过**（证据 `triad-20260921-t11-formal-e1/`），与 Identity 同日正式三端 9/9 互证。
- 2026-09-22：产品入口（选择→预览→明确保存→状态/重试）与登录保护后端入口已接到正式运行时，默认关闭；真实 `src/server.js` × 真实 Identity 提供方 × TE r2 `t11-lab` 的浏览器验收（桌面 + 360/390/430）通过（`triad-20260922-entry-browser-r2/`）。候选部署顺序与缺口见 `p03-entry-deploy-candidate.md` §5/§6。
- 以上完成前不开放正式保存，不解除 D03/教师/实例/profile 条件。
