# P03 教师选定成果：源侧交接

当前状态（2026-09-21）：双站整理/下载于 9 月 19 日发布 e4d52d1，之后并行反馈项目已把双站发布到 c4a6e86；本仓工作副本仍以 e4d52d1 为基线，正式保存仍关闭。最新源侧受限持久 release 候选与 V10–13 见下一节，当前源与 T11 主应用候选的八场景隔离联验见文末；以下按阶段保留历史证据，各阶段的版本、测试条件和未验项不互相替代。

## 2026-09-21：受限 MySQL 8 持久 release 候选与 rc2 V10–13 源侧落地

派单 CTRL-20260921-PRACTICE-RESTART-01 / RESUME-02（Claude Code 会话，总控已改为 Codex 任务）。工作副本仍为分支 `codex/p03-handoff-adapter`、HEAD `e4d52d1`，全部在途改动保留、未提交、未发布；**双站生产已由并行反馈项目发布到 `c4a6e86`，本副本不代表当前生产。** 正式 TE-DNA 保存入口继续关闭。

### 本轮实现

- `mysqlStore.js` 改为默认关闭的多 owner 持久候选 `MySQLHandoffStore`：不再绑定单一 owner；每笔事务先以 `INSERT … ON DUPLICATE KEY UPDATE` + `SELECT … FOR UPDATE` 锁定该 owner 的锚行（`p03_handoff_owners`），来源事实复核与 release 写入同一事务；业务侧撤权/改内容/删附件的路径通过 `withOwnerLock` 取同一把锚锁，因而与 release 严格排序（实验里由 root 连接模拟业务侧，两种先后顺序都有场景）。候选 DDL（`p03_handoff_owners/operations/snapshots/keys`，`CREATE TABLE IF NOT EXISTS`）与受限角色授权语句 `restrictedRoleGrants()` 由模块导出，**没有放进 `backend/migrations`**，也没有任何已挂载代码读取它。新增列 `status`（投影）、`recovery_until`（取得可信 W 后 = R + 1 天）、`hold`（首次 issue 尚无可信 W 或对账未关闭的记录不自动清理）；应用层继续拒绝 choice/binding/expires_at/write_until/content_sha256/source_id/protocol_version 的原地变更，`operation_expires_at`/`recovery_until` 只允许 null→值一次。全局分页清理 `cleanup()` 与周期任务 `startCleanup()` 跨 owner 执行，hold 行只能经对账出口退出。
- `i03Client.js` 增加 `wireVersion`：默认仍 `i03-draft-0.1`（行为逐字节不变，原 23 项含"draft 不能静默消费候选字段"继续通过）；`teacher-artifact-handoff/1` 只允许 native 路径，issue 响应必须带整数 `operation_expires_at`，写票上限 `min(now+120, W)`、查询/取消票上限 `min(now+60, R)`（R=W+29d），与记录已存 W 不一致按 `binding_mismatch` 拒绝且不发目标请求；`onIssued(grant)` 在目标请求前把可信 W 交给编排持久化，因此 redeem 响应丢失也不会丢 W。
- `i03Source.js`：W 只设一次；release 需 `now < min(L, W)`；`now ≥ W` 不再申请写票；`now ≥ R` 不再申请任何人级授权（`recovery_window_closed`），只展示最后已知结果；本地正文到 L 后停止新 release，但先查目标原操作，成功或未知结果不会被改写为 expired（V13）。首次 issue 响应丢失：不猜 W、不换 operation、不重传正文，先以 status 签发取回可信 W（V10）；Identity 暂时 `not_prepared` 在原尝试仍可能在途（客户端超时 + 30 s 结算窗）时只返回 `retry_later`，不当作未创建。无可信 W 的有界失败（默认 5 次可重试错误）转为 `reconciliation_required`：停止自动写入、保留最小故障元数据（时间/次数/错误码/阶段，无正文）、记录 hold；只有 `reconcile(actor, owner, id, closure)` 由操作者在核实尝试结束、Identity 历史与目标回执/墓碑后带依据关闭，之后回到常规保留期。draft 与 formal 记录不能互相读取或按同一选择合并（`binding_mismatch`）。
- `i03Draft.js`：清单 `protocol_version` 随 wire 版本；binding/selection 摘要域名与字段不变。
- 实例绑定候选：`docs/integrations/p03-instance-binding-candidate.json` 记录首批实例对（`pku-ai-platform-prod → pku-tedna-prod`）、北大站候选环境变量（含 `IDENTITY_DEPLOYMENT_INSTANCE_KEY` 与默认 `P03_HANDOFF_ENABLED=false`）、星云站不在首批的既有只读依据；单测校验其与 `i03HttpsTransport.js` 固定信任常量一致且保持关闭。**未部署、未改任何服务器配置。**

### 验证

| 层次 | 本轮结果 |
|---|---|
| 本地回归（Jest） | 原 62 项（23 客户端 + 18 编排 + 21 HTTPS）全部通过；新增 12 项 formal 客户端（HTTP 假 Identity/T11：字段必填、W/R 票截断、版本互斥、onIssued 顺序）、11 项 rc2 窗口编排（V10 首次 issue 丢失/在途判定/有界对账、V11、V12a/b、V13、draft/formal 互斥、错误只留安全分类）、2 项实例绑定候选一致性；P03 全部 8 套 137 项通过。后端全量 795 通过，仅 `ImageService`/`MessageService` 6 项为 HEAD 既有且与本轮无关的失败 |
| 隔离 MySQL 8 + 实际 I03 Go/PG18 实验提供方 + 假 SQLite 目标 | `dev/p03-durable-check.py`：MySQL 15 场景（原 12 + `restricted_role`/`multi_owner`/`hold_retention`）与 I03 现有 6 个 Node 源场景，含父测试 23 个通过事件，race，0 跳过。全部 MySQL 场景都在实验创建的受限角色下运行（只对四张账本表 DML、对来源事实表 SELECT）；11 项越权探测（DDL/TRUNCATE/业务写/mysql.user/GRANT/CREATE USER/CREATE DATABASE/杀他人会话）全部拒绝；两个 owner 账本隔离；hold 行跨 31 天清理后仍在、解除后即删 |
| 假对端 | Jest 用进程内 `p03FormalPeers.js` 与回环 HTTP 脚本模拟 rc2 的 t0/W/R 与目标锁后核 W；实验 Identity 仍是 draft（不返回 W、票不截断）。**没有真实 Identity/T11 实现 W/R，V10–13 只是源侧定向证据** |
| 真实教师/手机、正式联调、发布 | 均无。生产读取本会话被权限拦截：仅在拦截前只读取得星云站磁盘 HEAD `c4a6e86`；北大站 HEAD 与两站数据库/Identity 元数据未重读，沿用 2026-09-20 11:35 只读记录 |

私有证据：`storage/private/p03-handoff-validation/durable-release-candidate-20260921.json`（绑定本轮源文件 SHA、Jest 结果、实验结果 SHA）、`durable-source-result.json`/`durable-source-tests.log`（实验机器结果）、`durable-release-candidate-20260921-jest.log`。复现：`cd backend && npx jest src/__tests__/unit/services/artifactHandoff`；实验 `PATH=/usr/local/go/bin:$PATH PYTHONDONTWRITEBYTECODE=1 python3 dev/p03-durable-check.py /home/hanying/pkuailab-id`（需本地 `mysql:8.0`/`postgres:18` 镜像与 Go，自建随机容器并清理）。

### 2026-09-21 16:5x：V10–13 在真实 Identity 提供方候选上通过

Identity BATCH-01 第 2 项固定包（commit `25b5ff1`、rc2 `af86a5cd…`、候选 wire `teacher-artifact-handoff/1`、`Provider.EnableFormalCandidate()` 仅 development）到达后，新增 `dev/p03-formal-provider-check.py`：隔离 mysql:8.0 + postgres:18，Go overlay 在 Identity `internal/artifacthandoff` 测试包内启用 formal 候选并暴露实验时钟，P03 MySQL worker 以 formal wire 经回环 relay（只做丢请求/丢响应/停机注入）访问真实提供方，目标为向真实提供方兑换票据的 Node 假目标。9 场景通过、race、0 跳过；观测到真实提供方 W−1 的 commit 票 `expires_at=W`、R−1 的 status 票 `expires_at=R`、重试/重启后 W 不变、结算窗内 not_prepared 不当作未创建、无 W 的有界失败进入对账 hold。未发现与本仓 formal 客户端的接口差异。仍为模拟/注入：目标、时间源、教师与复制权事实；T11 接收侧 W 保存与锁后核 W 未验。证据 `storage/private/p03-handoff-validation/formal-provider/result.json`。

### 2026-09-21 18:18：同版三端隔离联验通过（BATCH-01 第 3 项）——MySQL 持久源 × 原生 Identity 提供方 × 未修改的 T11 `cmd/t11-lab`

TE 刷新候选 `20260921-t11-refresh`（父版 `5089cb6`；最终以第一包 28 源为基重整的 33 源包：manifest `0eff21a1825f9463a3eba91dc87096806f940bd12520e0323d53d59c2e10f607`、closure `3dc4d0cd…`，事件 `tedna-t11-first-package-rebase-20260921T101319Z`；schema 前像 `post-s05b-expected-schema.sql` `f4264ea8…`、迁移 `20260921_03_teacher_artifact_imports`，锁原语 `teacher_artifact_lock_actor` 恢复、接收角色对 `users` 无权限）。新增 `dev/p03-triad/`：

- `check.py`：外层运行器。按 `candidate.json` 固定输入（manifest/closure/schema/逐文件 SHA、Identity 提供方固定 commit `14b9852` 为祖先且提供方路径未变），起三只一次性容器（postgres:18 = Identity `i03_native`；postgres:16 = 目标；mysql:8.0 = 源）。目标库：装载脱敏 schema 前像后按 TE 自己的迁移原样重放 S05b 权限事实（`tedna_user` 对 `resource_versions` 只 SELECT/INSERT——脱敏 dump 不含 owner/GRANT，而 T11 `verify.sql` 断言这一不可变快照权限模型；与 Identity 驱动的 `schema-privileges.sql` 相同），再在一个事务里执行候选 `up.sql`+`verify.sql`；**目标运行角色默认取 Identity current-triad 的 `roles.sql` 拆分模型**：非登录 guard 角色持有锁原语（对 `users` 仅 SELECT(id,status,role)/UPDATE(id)），登录角色 `tedna_t11_lab` 只有 EXECUTE 原语 + 四张 T11 表 DML + `resource_versions` INSERT + 检索缓存删除 + 普通应用读/引用写（因 `cmd/t11-lab` 单进程共用一个 DSN 而合并 app+main 两角色；因它自行播种两个合成账号而多给 `users` INSERT），**对 `users` 无 UPDATE、非 owner、无 DDL**；运行前探测记录登录角色 `SELECT … FROM users FOR UPDATE` 被拒。`go build -race` **未修改的** T11 `cmd/t11-lab`，用 Identity 仓库**原样**的 `dev/i03/current-triad/provider_test.go.txt`（overlay 进 `internal/artifacthandoff`）与 `error_probe.cjs` 驱动八场景；`--rehearsal` 只用于调试驱动、结果标 `rehearsal_*`，`--target-role=broad`（单角色全表 DML）只作功能预演，均不构成候选证据。
- `scenarios.py`：逐场景驱动，由 Identity overlay 经 `I03_TRIAD_DRIVER` 调用。源 = 本仓 MySQL worker（`wallClock` 墙钟、native-draft、受限实验角色）；目标 = `cmd/t11-lab` stdin 命令（`drop_commit`/`packet`/`adopt`/`delete`/`restore`）；仅在 `target_disabled`/`error_envelope` 前置一个字节透传的回环 relay 做观测/停用注入。八场景与 Identity 原驱动同名同义，差别：`duplicates` 四次同时点击允许出现有界等待答复 `operation_busy`（503 可重试，GET_LOCK 2 s）再由调用方重试，最终全部 succeeded、同一 `resource_ref`、目标一份；`deleted_restore` 在墓碑检查后增加**观察项**：目标 owner 经 t11-lab 真实 `Store.Restore` 恢复副本，草案 wire 源侧对复活回执必须 `receipt_invalid`（不构成任一端失败）。

**固定运行结果（18:18，`storage/private/p03-handoff-validation/triad-20260921-t11-refresh-rebase/result.json` SHA `1df28e83…`）**：`pinned_candidate` / `passed`——八场景全部通过（duplicates、revoke、version、attachment、lost_commit_restart、deleted_restore、target_disabled、error_envelope），Go 含父测试 9 通过 / 0 失败 / 0 跳过、`-race` 无告警；1955 项输入 SHA 运行前后一致；候选逐文件 SHA 与 manifest 一致；Identity 提供方路径自固定包未变（运行时 HEAD 5f5e5d1）；目标事实 `lock_primitive_present=true`、`users_update_granted=false`、登录角色 `FOR UPDATE users` 被拒。Identity overlay 核过的对端事实：每场景 Identity 操作数 1（deleted_restore 为 2）、lost_commit_restart 相位恰为 `prepare,commit,status`、legacy 路径 0 次调用、原生认证与 32 位请求 ID 齐全。同一候选、同一 Identity 提供方、同一本仓客户端字节（`i03Client.js` `b0a799d6…`）下，Identity 自己的 current-triad 重绑（`runs/20260921T101414Z`，事件 `identity-i03-triad-rebind-passed-20260921T101655Z`，源为单进程 DraftStore 合成 spool）亦八场景通过；本运行的差别是源侧为 **MySQL 8 受限角色持久账本**，且多了两项观察（并发点击有界等待、草案 wire 上真实 `Store.Restore` 后的源侧拒绝）。此前三次预演（7/8 → 修正后 8/8 broad 角色 → 8/8 split 角色）留在 `triad-rehearsal/`，标 `rehearsal_unpinned`，不计入。

预演中发现的两项：

1. **源侧真实缺陷（本轮修正）**：`deleted_restore` 的观察项暴露 `i03Source.send()` 在任何相位前都把状态写成 `unknown`，失败时也写 `unknown`——于是一次只读 `status` 查询失败（回执矛盾 `receipt_invalid`，或目标瞬时不可用）会把已经结算的 `deleted`/`succeeded` 抹成 `unknown`；矛盾若持续，账本永远停在 `unknown`。修正为：**只读 status 查询永不改写已有回执支撑的状态**（prepared/succeeded/recycled/deleted…），只记 `last_error`/`retry_at`；写相位（prepare/commit/cancel）在途与失败仍为 `unknown`。V16 相应改为墓碑保持 `deleted`+`error_code`，新增 V17（succeeded 上 status 瞬时失败后仍 succeeded、不重发 commit）。P03 10 套 145 项通过。同时把 `i03Source.js` 里对账依据校验正则中的字面控制字节（NUL/US/DEL）改为 `\x00-\x1f\x7f` 转义，行为不变，文件不再被 grep/file 视为二进制。
2. **T11 中间树的错误信封**：预演时（17:4x 的原地修改树）403 `subject_disabled` 信封一度不带 `schema_version`；共同草案明文"错误信封沿通用规则不强加 schema_version；成功才必填版本"，本仓客户端两种都接受，驱动因此改为按草案断言（缺省或 1）。最终 33 源候选恢复了第一包的 `schema_version:1`（固定运行记录 `target_error_envelope_schema_version=1`），无契约差异。

**过程事实**：TE 在 17:24 的 manifest（`871d171e…`）之后原地继续修改源树（17:44 起），第 2/3 次预演分别遇到 4 个和 10 个文件与 manifest 不符（第 3 次八场景 `storage_unavailable`，store 与迁移中途不一致）；17:47 门控候选（`aa1f53de…`）被 Identity 重绑发现丢失锁原语与角色模型（`identity-i03-triad-rebind-blocked-20260921T095459Z`）；18:12 TE 以第一包为基重整为 33 源（`0eff21a1…`），本仓随即固定运行通过。运行器的逐文件 SHA 核对（`candidate_files_changed`）正是为此。

边界：仍是 `i03-draft-0.1` 隔离联验——未证明正式 wire/W/R/`recycled`/pairs、TLS、真实教师/实机、生产迁移与生产角色（目标角色为实验库内按 Identity 模型建的角色；源角色为实验创建的受限角色）；不是冻结、启用或发布授权。三端时钟：源与 Identity 用墙钟；`cmd/t11-lab` 按其设计把时钟钉在场景起始秒（仅 `clock` 命令推进），三端相差 <100 s，在 ±300 s 新鲜度之内；本联验不含 2 天原生期限断言。复现：更新 `dev/p03-triad/candidate.json` 后 `python3 dev/p03-triad/check.py`（需本地 mysql:8.0 / postgres:16 / postgres:18 镜像与 Go；自建随机容器并清理；不写 Identity/TE 仓库）。

### 2026-09-21 18:5x：影子账号谓词落到 schema 事实；分支已推送

- 用户授权后分支 `codex/p03-handoff-adapter` 已推送到 GitHub（未合并、未发布；与 origin/main `c4a6e86` merge-tree 干跑无冲突）。
- `handoffAuthority.js` 默认谓词由"占位不排除"改为真实事实：`users.uuid_source='sso'`（edu SSO 自动建的影子账号，决-9 / docs/02 §3）不能发起交接；注入谓词只能叠加。学生组映射列（决-12）仍未入库。这是 Identity rc3 §3 资格装配一直等的源侧事实。
- 新增 `dev/p03-prod-readonly-facts.sh` 供用户本人运行双站只读事实核对（HEAD、白名单非密变量、DB 授权布尔、`users`/`user_groups` 列、影子账号计数、P03 表计数），替代会话内被拦截的生产读取。**用户 18:55/19:2x 两轮运行结果**（记入 `p03-instance-binding-candidate.json` `read_only_facts_20260921`）：两站 HEAD `c4a6e86` 干净；北大运行容器 `IDENTITY_DEPLOYMENT_INSTANCE_KEY` 为空、`IDENTITY_CLIENT_ID=ai-platform-client`；星云为 `xingyun-ai-platform-test` 测试实例；两站应用账号仍 ALL PRIVILEGES（星云全局 `ON *.*`）；`users.uuid_source` 两站均在（影子账号 439 / 11）；无决-12 映射列；无 `p03_handoff_*` 表。首轮脚本两个缺陷（非交互 shell 无 nvm、`docker compose exec` 吞脚本 stdin）已修。

### 2026-09-21 19:5x：正式 wire 三端运行器就绪；对 TE fc1 目标候选的首次运行暴露一项真实接口差异（清单 `protocol_version`）

TE 正式 wire 目标候选（`/home/hanying/tedna-sync/releases/20260921-t11-formal/source`，父 `5089cb6`，36 源，manifest `af8adec3…`、closure `bc131491…`，`cmd/t11-lab` stdin `formal:true`；事件 `tedna-t11-formal-wire-candidate-20260921T111553Z`）到达后，运行器改为按候选文件选 overlay/驱动：`dev/p03-triad/candidate-formal.json` + 本仓 Go overlay `formal_overlay.go`（真实提供方 `14b9852` 上 `EnableFormalCandidate` + formal policy 行 + `formal_pairs`，Identity 实验时钟经回环控制端点交给驱动）+ `formal_scenarios.py`（源 MySQL worker 走 `teacher-artifact-handoff/1`、逐命令注入时钟；t11-lab `formal:true`、`clock` 命令；三端时钟同步推进，个别步骤按场景有意偏斜并记录）。八场景：formal_success、duplicates、w_target_check（W−1 签出的 commit 票在目标 W 时被其锁后核 W 拒绝）、replay_after_w（W 后 status 重放原资源、R 起源侧不再申请授权）、recycled_restore_purge（recycled/restore/purge/墓碑/410）、wire_gate_off、target_disabled、lost_commit_restart（两天后重启只查状态，W 持久）。

**首次固定运行（`storage/private/p03-handoff-validation/triad-20260921-t11-formal-fc1/result.json` SHA `60de83a4…`）：1/8 通过（wire_gate_off——未开 `TEDNA_T11_FORMAL` 的接收方在 Identity 兑换前就以 400 `unsupported_schema` 拒绝正式 wire，与 TE 回执一致），其余 7 场景全部在 prepare 卡在同一处**：Identity 正式签发与兑换成功（`redeemed=1`），随后目标 400 `unsupported_schema`。原因是 **包清单（manifest）的 `protocol_version`**：本仓源按 rc1"改消息版本须重出清单/请求/摘要向量、不混用新旧消息"把清单 `protocol_version` 写成该 operation 的 wire（`teacher-artifact-handoff/1`，`i03Draft.js`）；TE fc1 的 `artifactimport/package.go:146` 仍要求清单 `protocol_version == 'i03-draft-0.1'`（其正式 wire 测试用 `testdata/i03-package.json` 的 draft 清单），只把请求/回执的 `protocol_version` 换成正式 wire。Identity 的黄金向量（`dev/i03/fixtures.json`）只有 draft 清单，正式清单向量尚未出——即 fc1 冻结对象里没有任何一层固定过正式 wire 下清单 `protocol_version` 的取值。这是真实接口差异，已按共同边报 Identity 裁定（建议：清单版本随 operation wire，并出正式清单/请求/摘要向量；若裁定清单保持 draft 版本，本仓只需改 `i03Draft.js` 一处并重出向量）。裁定前正式 wire 三端不能继续；draft 三端结论不受影响。

### 候选参数与限制（明示，非协议值）

- 首次 issue 结算窗 = 客户端超时 + 30 s；无 W 的可重试失败上限 5 次；本地元数据在 R 之后再保留 1 天供展示，R 起不再申请授权。生产接线时须与 Identity/T11 的实际请求上界对齐。
- 到 L 未 release 的操作在源侧记 expired，未向目标补发 cancel 释放暂存（目标按 W 自行过期）。
- owner 级串行：每笔事务读取该 owner 全部留存行；适合每人 ≤50 在途的规模，不是高并发通用存储。
- 正式接入仍待：正式 profile 冻结与提供方实现（W 字段、票截断）、真实教师与逐附件持久复制事实及撤权来源、生产受限角色实际创建与业务侧锚锁接线、北大站显式实例键经 enrollment 流程写入、T11 受控同版联验、D03。

## 2026-09-19 源侧 MySQL 持久化与 I03 提供方实验

本轮接续用户“继续吧”，保留分支 `codex/p03-handoff-adapter` / HEAD `c0087d0` 及此前全部在途改动。新增**未挂生产路由的 MySQL 源操作实验层**，实际 Node 源编排/HTTP 客户端接 I03 `a444415` 的 Go/PostgreSQL 实验提供方，目标仍为 SQLite 假 TE-DNA。共同协议仍为 `i03-draft-0.1`，未代 I03/T11 定稿或修改共同文件；未提交、推送、执行生产迁移或发布。

### 本轮实现与验证范围

- `mysqlStore.js`：注入 mysql2 pool，绑定一个 owner，只允许 development/test 和专用 `p03_lab_<随机值>` 数据库名。操作、快照、请求键分别落行，操作 UUID 主键、`owner+choice` 唯一键、`owner+key摘要` 主键及外键共同约束；包原字节、操作绑定与绝对期限不随重试变更。没有加载应用 `.env`、调用现有数据库或自动执行 DDL。
- 用 MySQL `GET_LOCK` 在独立连接上串行同一操作的跨进程请求，进程退出释放锁；短事务前后检查持锁连接，连接丢失时拒绝继续写 release/结果。已发往对端的请求仍可能完成，所以恢复必须先 status，不能把锁丢失当未接收。release 后取消使用另一把操作锁，可与在途 commit 竞争。
- `dev/p03-mysql-fixture.cjs` 显式加载实验 DDL，合成来源与 active/eligible/copy 事实保存在独立 MySQL 行。来源读取继续使用现有 `createSourceAdapter` / `prepareSelection`；检查源权限/内容/附件和持久化 release 共用同一事务连接、同一来源事实行锁。两个 Node 进程的撤权、修改、删除与 release 确实争用该锁。**这不是把生产 users/messages/files/权限变更入口接上了锁，也不证明真实教师资格。**
- 24h 后删除临时包和请求键，30天后删除操作/回执；访问清理外增加可启动/停止的周期清理。测试推进时钟后不发业务请求，也能物理删掉到期行。当前周期任务仅清理实例绑定的 owner；正式全账户调度、分页及负载治理尚未接入。
- 修复实测发现的竞争：迟到 commit 错误不再覆盖已经确认的并行 cancel/status 回执。每次在途请求保存独立尝试标识，只有仍属当前尝试的失败才能写 unknown/重试时间。源实例和目标实例同时进入本地选择去重及请求键作用域，避免两个实例的相同选择被合并。

MySQL 层保留 draft service 的有界状态回调 API，短事务内读取该 owner 留存的行；不是正式高并发生产存储设计。本轮实验表只在临时库建立，没有加入 `backend/migrations`。正式实现需按定稿契约建立加法迁移、原生权限/来源事务适配和部署调度，不能把测试 facts 表搬入生产作为教师事实。

### 验证结果

| 层次 | 本轮证据 |
|---|---|
| 本地回归 | 后端7套130项通过；新增迟到提交错误与实例隔离回归，原有 ZIP、选择、编码、认证及文件权限继续通过。`durable-backend-tests.log` |
| 实际 Node/MySQL + Go/PG + 假目标 | 12场景通过：两个进程重复冻结/发送、同键冲突、数据库唯一约束、真正 SQL 部分写入失败后的整笔回滚；prepared后撤权/版本变化/附件缺失；目标事务回滚后先查询再重试；撤权先锁行和release先发生两种顺序；cancel先于commit票兑换；目标成功丢响应；目标已提交但还未响应时kill源进程；持锁连接被kill；24h/30天周期清理 |
| I03 现有实际源流程 | 只读复跑其6个 Node源/文件暂存→Go/PG→假目标场景。合计18个业务场景、2个Go主测试、20个通过事件，race通过，无skip。`durable-source-tests.log` / `durable-source-result.json` |
| 原操作恢复 | 丢响应和kill场景均在两天后重建Node源进程及假目标，旧包已过期，只发status恢复同一 `resource_ref/resource_version`；没有再次发送正文、创建新资源或自动开始备课 |
| 内容与身份边界 | 目标包逐字节等于冻结包，只含原14个UTF-16单元片段和一份显式Markdown附件；无完整会话、提问、thinking、未选回答。Identity操作表没有正文/清单/附件名；源账本不含票、Basic、目标教师ID或全局人ID |
| 真实使用 | 本轮没有新增真实教师账号或手机实机证据，继续待验。此前合成浏览器下载检查保留，不计入本轮新通过数 |
| 真实三方联调 | 未做；I03仍是合成Registry/关联事实，T11真实接收尚未就绪，未接正式两端会话/CSRF或目标资源存储 |
| 发布 | 两站本轮无新发布。2026-09-19 20:10（Asia/Singapore）只读核验各自HEAD为 `c0087d0d2216a713c69aa71d4be642831b5ed3c1`、跟踪文件干净；health/login各200、匿名成果预览401/no-store、开发交接404 |

以上私有证据位于 `storage/private/p03-handoff-validation/`；双站分别为 `practice-durable-lab-baseline.json`、`pkuailab-durable-lab-baseline.json`。输入SHA绑定实际工作树，不以HEAD冒充新增文件已提交或部署。新实验没有UI改动，未重复浏览器/前端构建。生产 ZIP 路由、选择器和界面保持原实现。

复现：

```bash
cd /home/hanying/ai-platform
python3 dev/p03-durable-check.py /home/hanying/pkuailab-id
```

要求本地已有 `mysql:8.0`、`postgres:18` 镜像、Go及后端既有依赖。脚本使用 `--pull=never`，自动建独立容器、随机回环端口与随机数据库/schema；结束删除本次容器和卷。Go overlay把本项目测试临时映射进I03测试包，**不写Identity仓库及其结果文件**，不改共同草案。随机凭据只经环境或stdin，不进入argv/日志/结果。实验不证明MySQL/PostgreSQL断电恢复、原生身份策略、生产负载、备份销毁或目标真实文件耐久性。

### 正式交接的下一步与具体等待项

源侧清单样例继续使用 `p03-handoff-examples.json`，ZIP仍只是来源依据。成功仍须服务端持久回执绑定本次operation；`open_target:{kind:"import_result",operation_id}` 映射目标固定入口，目标按当前owner复核，`continuation.status=not_started`。页面跳转、prepared和票兑换均不算入库，更不算资源已采用或已生成教案。

等待 I03：J1持久副本/release后撤权与隐私删除责任；J2两站真实client、instance、数据关系、当前教师判据及变更通知；J4正式profile/endpoint、阶段授权和允许动作登记、原生Registry测试环境。源侧已经补出SQL唯一约束、跨进程排队、原子release与撤权的可运行实验证据，仍需把它们接到正式来源/权限模型及会话/CSRF边界。

等待 T11：J3文本/附件真实资源类型、私有文件与资源事务、prepare/commit/status/cancel、回执与deleted tombstone、固定import_result及当前owner校验、T02按不可变资源版本采用接口及测试环境。就绪后同一测试教师/同一成果做真实三方联调，补两站真实下载和手机操作，再按既有顺序发布并分别留证，源保存入口最后开放。

本轮独立回执：`/home/hanying/pkuailab-ws/docs/progress/20260919-P03-durable-source-lab.md`。未改总表、INDEX或其他项目回执。下文为以前轮次的历史证据，不代表本轮重复发布。

## 2026-09-19 Node 源侧分阶段交接（上一轮交接）

在用户确认接手开发后，沿 `codex/p03-handoff-adapter` / HEAD `c0087d0` 继续实现。保留上一轮全部在途改动，本轮增加实际 Node 应用服务的草案编排与 HTTP 客户端；**没有挂载正式 API、修改生产下载或开放保存入口，没有提交、推送、迁移或发布**。这是可运行的开发/测试适配，不能当成正式三方联调。

### 当前实现

- `backend/src/services/artifactHandoff/i03Source.js`：复用 `prepareSelection` 和 `i03Draft`，冻结明确选定的回答范围及附件。先持久保存 operation/binding/原字节包；重复点击与不同请求键复用同一选择的操作，标题/用途保留首次选择。同键改请求拒绝。
- `prepare → 回源复核 → release → commit`：收到 prepared 后，再查当前账号资格、本人内容、源版本、每个附件的版本/实际文件和持久副本权限；复核与 release 存储放在注入的来源锁内，与修改/撤权共用锁。release 持久化后才允许申请 commit 票。测试 authority 显式声明 active/eligible/copy，**不把 user 角色、本人访问或开发名单当教师资格**。
- `status/cancel/resume`：恢复首先向目标查询原操作，再决定是否续发；写失败保持 unknown，遵守 Retry-After，并要求显式重试。初次签票结果丢失用新发行键/票继续原 operation，不创建新资源。初次 issue 根本未形成操作时，须由 Identity 明确返回 not_prepared 才能回到 ready 或完成本地取消。
- 取消先在来源锁内写不可逆意图。release 前等待在途 issue/prepare 结束再清理，避免把在途签票期间的“尚不存在”误当取消完成；release 后 revoke 可与在途 commit 并行，目标决定 cancelled 或 already_succeeded。取消已确认后恢复改查 status，目标删除只返回 deleted；不会把取消当删除或重建目标资源。
- 源临时包逻辑有效期24h，操作/回执元数据30天，重试不续期；快照过期后仍可查询之前成功结果。`resume` 遇恢复窗口外的旧操作拒绝，不自动创建替代操作。元数据留存不代表源侧另建资源库。

`i03Client.js` 只支持 `development/test` 和显式 `http://127.0.0.1:端口` 两个假对端地址，不读正式凭据或自动发现目标。Identity 收绑定元数据和源本地账号，目标收到所选包；不借 C06 传正文。原生 HTTP 不跟随跳转、不读取代理设置、不自动重试写操作；每跳新 UUID key/nonce，票仅留内存，Basic 只发 Identity。响应限16KiB、要求 no-store，复用现有严格 JSON 解码器拒绝重复键、异常数值、孤立代理及尾随内容；远端错误正文不进入本地错误。路径 `/identity/*`、`/tedna/*` 是 I03 假模型路径，**不是正式 endpoint**。

目标成功必须来自服务端响应：校验协议、operation_id、目标新 resource_ref/不可变 resource_version、固定 `open_target:{kind:"import_result",operation_id}`。后续状态不得退回未接收或换资源身份；其他状态不返回资源字段。向调用方只返回安全状态及 `continuation:{status:"not_started",landing}`，没有把前端跳转、票兑换或 prepared 当入库成功；备课采用、加载、生成仍未发生。T11 的固定结果页面还须按当前目标账号重新验权。

### 本轮验证和发布基线

| 类别 | 结果与证据 |
|---|---|
| 本地源码 | 新增源编排16项、HTTP传输12项；联合原有下载/快照/编码/认证/文件权限回归共7套128项通过，`storage/private/p03-handoff-validation/i03-source-backend-tests.log` |
| 实际 Node + 假 HTTP | `dev/p03-i03-source-check.py` 11个场景通过，调用实际 Node 服务与客户端、I03 假 Identity 和持久 SQLite 假目标，非 Python Source 替身。证据 `i03-node-http-result.json` 记录对端文件摘要 |
| 故障与内容 | 并发重复只有一资源；源正文/权限/附件在 prepared 后变化不 commit；签票失响应、接收503、资源事务回滚、旧票过期后的新 status 票；commit已成功但响应丢失两天后重启源与目标，只有status请求且恢复原资源；取消后成功资源不删除、目标deleted不重导 |
| 来源范围 | 假目标实际字节等于冻结包，正文仅14个UTF-16单元所选片段，附件仅一份显式选定Markdown；无未选回答、用户提示或thinking。Identity状态无正文/附件名称/会话ID，源盘上无票/Basic |
| 真实使用 | 本轮未新增真实账号/手机证据。上一轮合成浏览器下载验收仍有效；真实教师使用、手机原生选段/软键盘/系统文件打开继续待验 |
| 真实联调 | 未做。共同稿仍为 `i03-draft-0.1`，未发现T11就绪回执，未连接真实Identity或TE-DNA |
| 双站发布 | 2026-09-19 19:50（Asia/Singapore）分别重新核对：两站HEAD仍为 `c0087d0d2216a713c69aa71d4be642831b5ed3c1`、跟踪文件干净；health/login各200，匿名成果预览401/no-store，开发交接404。本轮无新发布 |

双站独立证据为 `practice-source-flow-baseline.json` 与 `pkuailab-source-flow-baseline.json`，与上一轮基线文件并存。新增模块未被生产 app 或前端引用，本轮没有UI修改，未重复构建或浏览器测试。先前原有下载的8个浏览器场景、应用模拟交接的14个浏览器检查仍见下方历史，不并入本轮新测试数。

复现本轮（不启动真实应用、不连接数据库）：

```bash
python3 dev/p03-i03-source-check.py /home/hanying/pkuailab-id/dev/i03
cd backend
./node_modules/.bin/jest --runInBand src/__tests__/unit/services/artifactHandoffI03Source.test.js src/__tests__/unit/services/artifactHandoffI03Client.test.js
```

Python runner 只读取 I03 `dev/i03`，不改共同文件；随机测试凭据仅经子进程 stdin，临时文件退出清理。`p03-i03-source-worker.cjs` 是测试驱动，不是部署服务。可注入 source/store/authority/client 的 Node 服务供后续接测试环境；来源锁必须同时覆盖消息修改、文件删除、权限改变和取消，不能只给本服务加互斥锁就声称生产原子授权。

### 正式接入仍需完成

当前 `DraftStore` 为单进程原子文件替换/fsync，清理是访问触发；**没有生产数据库唯一约束/跨进程锁、定时清理、正式教师及持久副本判据、正式源端会话/CSRF接口，也没有把撤权通知接入本地操作取消**。这些是上线前的工作，不能由假 authority 或本次并发测试代替。保留已有应用 mock UI，未把它冒充本轮 Node/I03 时序界面。

等待 I03：确认J1持久副本与撤权/学校隐私责任、J2两站client/instance及教师判据、J4正式profile/版本/地址/动作登记；提供分阶段票、status/cancel/revoke测试环境。源侧采纳当前长度帧摘要和release时序，实际实现意见已写本文件，未覆盖共同主稿。

等待 T11：确认J3正文/附件资源类型、私有耐久文件与资源事务、prepared/commit/status/cancel及tombstone、固定import_result入口与当前owner校验，提供T02按resource_ref/resource_version采用的接口。就绪后先接上述生产持久层和权限锁，在隔离测试环境真实三方联调；再按既有顺序两站分别发布留证。已有清单样例 `p03-handoff-examples.json` 不变，仍为合成来源依据，ZIP仍不是正式跨端协议。

本轮工作区独立回执：`/home/hanying/pkuailab-ws/docs/progress/20260919-P03-source-flow.md`；未改总表、INDEX或其他项目回执。

## 2026-09-19 适配准备续单（上一轮交接）

本轮从双站正在运行的 `c0087d0d2216a713c69aa71d4be642831b5ed3c1` 接续，分支 `codex/p03-handoff-adapter`。入口工作树原为干净的 `32a3378`，先 fetch 并 fast-forward 到生产父版再开发；其他 worktree 未动。`7b651c9` 下载发布和 `458201c` 界面修复均为两站当前版本的祖先，后续中文及 Monaco 修复保留。**本轮未发布、未迁移**；线上继续使用原有 ZIP 下载，没有跨端保存成功提示。

2026-09-19 15:59（Asia/Singapore）分别核对：

| 站点 | 当前发布证据 | 本轮公开边界检查 |
|---|---|---|
| ai.xingyuncl.com / practice | HEAD `c0087d0`，跟踪文件干净 | /health 与 /login 200；未登录下载预览 401 且 no-store；开发交接 404 |
| ai.pkuailab.com / pkuailab | HEAD `c0087d0`，跟踪文件干净；镜像 `v-c0087d0-20260919_115224`，四容器 healthy；current 指向对应 release 目录 | 同上，各自留证 |

私有证据目录：`storage/private/p03-handoff-validation/`，分别为 `practice-baseline.json`、`pkuailab-baseline.json`。既有下载上线回执仍见工作区 `docs/progress/20260919-P03-selected-download-release.md`；本轮独立回执为 `20260919-P03-handoff-adapter.md`，不把基线核对写成一次新发布。

### 源侧材料与可运行适配

生产 `ArtifactExport`、`artifactExportService`、`selection.js`、`source.js` 均未改写。继续共用本人已完成回答、去 thinking 后的准确范围、显式附件、来源版本和实时权限检查。

新样例 `p03-handoff-examples.json` 是**纯合成内容**，包含整条回答无附件、14 个 UTF-16 单元/42 UTF-8 字节的片段、58 字节 Markdown 附件、未选/缺失/不支持附件盘点、来源版、原文节选摘要、私有/未审核状态及源侧权限检查结果。`source_checks` 是本地检查时点，`simulated_only` 明确不证明教师资格或持久副本授权；缺失/无权附件不暴露名字和路径。旧 `p03-synthetic-packet.json` 留作首单历史样例。

开发假接收改为独立私有文件暂存 `mock-receiver/state.json`，不再把源操作记录当接收方入库证明。`receiver.js` 提供 `accept/lookup` 接口，`service.js` 可注入替代接收器；当前无网络客户端或 TE-DNA 配置。一次操作稳定绑定 `operation_id + snapshot_id + receiver + packet_sha256`，后者对实际 `{manifest,payload}` UTF-8 交付字节计算，包含清单及所选正文。重复点击/不同 HTTP key 复用原快照和操作；同进程内按操作排队，跨进程持久化生产唯一约束尚未实现。

接收成功回执经白名单校验，必须同操作/快照/目标/字节摘要，含 `receipt_id`、新建的目标 `resource_id`、`resource_version`、接收时间、durable/private/simulated。响应丢失前已在接收文件中 fsync；源先记 `outcome_unknown`，随后 status 查询可恢复已持久化回执，即使源服务重启或模拟授权已过期。查询不可达保持未知，不因网络故障直接再发；已确认回执后来消失或目标资源身份改变时拒绝报告成功或重建。当前只模拟文件耐久保存，不代表真正 TE-DNA 数据库/文件事务。

回执生成 `continuation:{state:"not_started",action:"select_resource",receiver,resource_id,resource_version,purpose}`，只引用该次接收结果，不使用接收方任意 URL，不触发采用、模型调用、共识、生成或扣费。开发 UI 失败后先查状态，查到回执即显示“模拟接收完成，未写入 TE-DNA”；刷新/恢复仍是同一资源。正式产品须用 I03 草案的受信 `open_target` 固定句柄和目标当前 owner 校验，不能直接采用此模拟 continuation 作为正式协议。

### 对 Identity 新草案的源侧评审

开工时共同主稿未形成；收尾前已读取 Identity 主笔的 `/home/hanying/pkuailab-ws/docs/integration-drafts/teacher-artifact-handoff.md` **`i03-draft-0.1`**，以及其 `dev/i03` 校验模型和摘要向量。本文件记录 P03 评审意见，未改共同主稿、正式 contracts、总表、INDEX 或他项目回执；草案仍待三方定稿。

`i03Draft.js` 新增显式的、未挂 HTTP 路由的载荷编码器：消费经回源校验的选定快照，产出 Base64 固定原字节清单和逐 blob 字节/摘要；`selection_sha256` 与 `binding_sha256` 使用草案规定的域前缀和 4 字节大端长度帧，避免 Node/Go/Python 默认 JSON 排序差异。样例的 `i03_draft.binding` 只含元数据，正文/标题/原文摘要/附件名称只给假目标，不给 Identity；不接入 C06。该函数不授予持久副本权，不签票、不 release、不发网络请求。范围、UTF-8、NUL/孤立代理、格式、字节数、文件名和上限不符即拒绝编码；不为迎合协议而静默改写已选正文。

10 个单测包括 Identity 已公布的独立摘要向量；本仓实际生成包通过 Identity Python `validate_package` 和 `binding_hash`。`dev/p03-i03-check.py` 进一步把同一 P03 包送入本机 I03 假 HTTP 身份/目标，验证 prepared 不产生资源、重复提交只有一资源、过期拒绝、撤权取消、缺附件整包拒绝、503 后查询再重试、成功断连接后旧票过期/重建目标连接/新 status 票恢复原资源。凭据仅测试进程随机内存值；临时 SQLite 清理，不读真实库/凭据、不修改 I03 文件。

| 草案事项 | P03 评审及剩余实现 |
|---|---|
| J1 持久私有副本、release 线性化 | 方向可作为实施基础，但三方须确认可保存材料和撤回责任。当前开发快照允许源编辑后保留旧版且每次检查源访问；**不等于**草案 release 前再次核对当前源版本、与撤权串行 CAS，生产锁/事务未实现 |
| J2 教师资格、双站实例 | 下载的本人访问可复用；普通 user、测试 allowlist 和合成 owner 都不证明教师。两站注册 client/instance/origin、数据集关系及教师判据待 I03/P01 适用证据确认，编码器只用 synthetic 实例 |
| J3 目标资源与后续备课 | 采用目标新 UUID/不可变版，源 UUID 仅来源。T11 须给文本/附件真实类型、私有持久层、原子回执、结果入口与 T02 采用映射；准备、接收、selected、loaded、生成分开验收 |
| J4 字节与分阶段协议 | 本轮编码与向量已对齐草案；支持 prepare 独立 512KiB/解码 320KiB 例外，其他控制包继续16KiB。正式 endpoint/profile、动作允许行、票阶段授权和登记仍未就绪，不启用生产入口 |

两个测试层必须区分：`p03-mock-receipt/1` 是现有应用开发 seam 的接收/恢复证据，只有24h逻辑有效期、单进程文件存储；`i03-draft-0.1` 是新增清单编码及独立协议模型兼容性。应用 seam **尚未实现** prepare→release→commit、独立 status/cancel 票、30天状态恢复、删除 tombstone、生产多实例事务或正式教师身份。不能用旧 mock 的短期恢复替代草案生命周期，也不能把旧 JSON/ZIP 自动升级成正式协议。

### 验证与真实使用待验

| 层次 | 本轮结果 |
|---|---|
| 本地源码/单测 | 后端5套100项、前端4套18项通过；覆盖下载、身份停用/有效期、文件所有权、严格输入、假回执绑定和恢复；无新依赖/数据库迁移 |
| 本地构建 | `VITE_P03_DEV_ENABLED=true make build` 通过；旧 node_modules 曾缺已上线 Monaco NLS，按现有锁文件 npm ci 后恢复，无依赖清单变更；产物有下载路径，无 `/dev/p03`/回执组件 |
| 下载浏览器 | Chromium 合成来源：整条与片段预览=ZIP原文、显式附件预览=文件字节、来源/附件摘要一致、无提问/thinking/未选内容、断网保留选择重试、注入409后显式重载通过；390×844、320×568、844×390触摸模拟附件/预览/下载通过，无页面异常/横向溢出 |
| 应用假对端 | HTTP 7场景通过；浏览器失响应自动查询及刷新恢复同一资源通过；另有无效回执、查询故障、接收记录消失的单测 |
| I03 假协议对端 | P03真实编码包+I03合成HTTP/state模型6场景通过；不代表生产 source release 或真实身份联调 |
| 真实使用 | **待验**：没有可确认的真实教师会话。Windows computer-use 启动被 `sandboxCwd is not a local file URI` 错误阻断；未获取/假设任何登录态。手机系统原生选段柄、软键盘、系统下载/文件管理及真实附件质量未实机验收 |
| 真实三方联调/发布 | **未做**；I03草案未定稿，T11真实接收和资源入口未确认。两站本轮各自只读核验，没有新发布 |

真实教师补验清单：在各站本人 completed 回答分别选整条/中文和emoji片段；对照原文、source.json、显式附件；中断网络再重试；源编辑/附件删除后拒绝旧下载并可重载；手机长按选段、开关附件预览、横竖屏、键盘和系统文件打开。需确认学生/其他账号不能越权，但不以无关学生通道开发阻塞本轮合成教师成果准备。真实跨端再加入另一目标登录账号、撤权竞争、重复点击/过期票、响应丢失与真实资源版/后续采用核验。

复现新增检查（其他基线命令见下方历史）：

```bash
node dev/p03-handoff-check.cjs                 # 实际dev路由+假接收，证据落storage/private
node dev/p03-handoff-check.cjs --write-examples # 明确重生成本项目合成样例
python3 dev/p03-i03-check.py /home/hanying/pkuailab-id/dev/i03
node dev/p03-demo.mjs --fresh
# 另一个终端，Playwright可由PLAYWRIGHT_MODULE定位；Linux须具备浏览器运行库
P03_EVIDENCE_DIR="$PWD/storage/private/p03-handoff-validation" node dev/p03-download-e2e.cjs
P03_EVIDENCE_DIR="$PWD/storage/private/p03-handoff-validation" node dev/p03-e2e.cjs
```

等待 I03：共同接受J1/J2/J4、正式契约/profile及字段冻结、教师与双站实例证据、分阶段票/查询撤销测试环境。等待 T11/S06：J3资源类型/不可变版/原子回执、prepare/commit/status/cancel、持久文件/删除策略、固定结果入口和资源选择采用。就绪后接生产持久操作与权限release，再以本样例做隔离环境真实三方联调，最后依既有流程双站分别发布留证。**下一单不要从旧下载树重做，也不要直接打开开发保存入口。**

## 历史交接与既有下载契约

## 2026-09-19 续单：先开放选中内容下载

用户明确选择先开放本机下载，TE-DNA 保存后续接入。真实聊天的助手回答下增加“下载成果”，可选整条或原文片段，并显式勾选可读 TXT/Markdown 附件。ZIP 包含 `answer.md`、`source.json` 与选定附件；来源清单固定对象、内容版本、所选范围、生成时间和内容摘要，不调用模型总结、不抓取链接、不导出其他消息或 thinking。

生产接口为 `GET /api/artifact-exports/messages/:id` 和 `POST /api/artifact-exports/messages/:id/download`。POST 仅接受 `schema_version:1`、`expected_version`、`selection:{start,end}`、`attachments:[{source_id,expected_version}]`；每次重新检查当前登录账号、会话归属、完成状态、版本与附件访问。源变化返回 409，需显式重新加载；无权访问返回 404。严格 JSON、未知字段拒绝、16 KiB 请求上限、no-store、安全错误信封与 request_id；不接 query，不记录正文。

每次请求即时生成下载包，不在服务器留存成果，不建资源库或数据库表。固定 ZIP 元数据使同版同范围重试字节一致；前端锁阻止连点，失败可重试。复用 `artifactHandoff/selection.js` 的范围与清单准备，开发快照服务仍单独保留草案标记和持久化。`practice-selected-export/v1` 仅是本机归档格式，不是 I03/T11 正式接收契约。

本次无数据库迁移、无新增依赖。跨端保存及假接收方仍只在开发门禁内，线上没有 TE-DNA 保存入口或成功提示。登录者只能下载本人内容；这不等于教师跨端身份已验证，也不替代 P01 学生边界验收。

可重复验证：后端 `artifactExport.test.js` + `artifactHandoff.test.js`，前端 `ArtifactExport.test.jsx` + `MessageContentExport.test.jsx` + `ArtifactHandoffDev.test.jsx`；合成浏览器用 `P03_DEMO_PORT=3005 node dev/p03-demo.mjs --export-only`，检查真实 ZIP、准确片段、勾选附件、来源变化错误及手机显示。以下章节为首单的历史验证和待联调贡献；发布结果以工作区独立回执为准。

日期：2026-09-18。基线：`4a2b00e`（保留该导航改动及之前已完成的发布）。本次是源侧开发/模拟验证，没有发布到两个生产站点，没有数据库迁移。

## 规划与交付边界

依据 `/home/hanying/pkuailab-ws/CLAUDE.md`、docs/00、docs/06 §8、docs/05 适用前提、docs/14 P01/P03、docs/15、docs/20 §5/§7、contracts/00。未发现本仓独立旧 HANDOFF 文件；以当前用户派单和 docs/20 为交接。

P03 → I03 → T11 将教师选中的实践成果转入 TE-DNA 个人资料，再供备课/课件使用，已纳入北极星 R1。TE-DNA → 实践聊天选用资源也在 docs/15，属于后续反向接入。本次不建设实践侧资源库、共识库或备课工坊，不实施反向检索。

北极星五问：

1. 助手回答成为有来源、版本和准确范围的参考资料候选，尚非正式 C/E 认知条目。
2. 改善材料选择和来源核对；明确选中内容与未选内容。
3. 守住本人访问、附件权限、来源版本、私有默认值及正文边界。
4. 只做确定性范围选择和快照，不新增模型总结，不把 AI 原文变成已核实事实或教师共识。
5. 为老师省去跨平台复制、下载再上传的重复工作；真正一键入库需后续 I03/T11 联调。

## 已有能力与复用盘点

| 对象 | 当前身份与版本 | 当前导出与本单处理 |
|---|---|---|
| 聊天消息 | `messages.id` UUID、`conversation_id`、角色、状态、`created_at`、可有 `model_name`；原文可更新，没有不可变修订号 | 现有 Chat 的导出遍历全部消息；P03 仅复用 Message/Conversation 读取和下载工具，不调用全会话导出。仅选择本人未清空会话的 completed 助手回答 |
| 回答中的方案、代码/画布源码 | 来源是消息与内容位置；浏览器画布块不是额外稳定的后端作品 ID | 现有 htmlBlockParser、HtmlCanvasPanel 可导出 HTML、打印 PDF、生成 PPTX/DOCX。首单保存选中原文及围栏代码；不运行 HTML，不声称已生成并取得 PPTX/PDF 文件 |
| 聊天上传附件 | `files.id` UUID、`user_id`、状态、磁盘路径；`file_ids` 兼容 `file_id`；无不可变修订号 | 首批只认本条消息关联、本人所有、ready、可读的 UTF-8 TXT/Markdown。内容摘要按实际字节计算；不得用 URL 或 `extracted_content` 替代真实文件 |
| HTML 作品 | `html_pages.id`、`user_id`；更新时 `version = version + 1` | 已有独立编辑、发布和导出能力；本单没有接入独立 HTML 作品。后续单独适配版本与隔离预览 |
| 独立导图 | `user_mindmaps.id`、`user_id`，更新 `updated_at`；Markdown/Mermaid/SVG 内容 | 已有保存、分享与按导出类型计费；本单不改权限或计费，不通过聊天入口绕过独立作品规则 |
| 图片/视频生成 | 各自记录 ID、`user_id`、状态、文件/URL，图像可带 parent_id；记录可更新 | 本单不抓取远程媒体，不把公开 URL 当授权证明。后续按文件归属、持久保存权限、版本和真实格式逐种适配 |
| 普通网页链接 | 仅链接字符串 | 作为所选原文中的文字保留；不请求网页，不宣称已取得正文，不在快照预览中加载外部图片 |

文件权限与支持格式分开判断：非本人/不存在/已失效只显示不可访问，不泄漏他人文件名或路径；本人 HTML/图片/PDF/Office 等目前显示不支持。TXT/Markdown 最多 3 个、各 64 KiB，回答最多 128 KiB；清单预览只检查前 20 个关联文件，超出明确提示且不导出。远程路径、逃逸上传目录、非 UTF-8、超限文件拒绝。

## 源侧行为

- 聊天回答下的开发入口打开准确原文，可选整条或连续片段；先预览文本及勾选附件，确认一次固定快照。thinking/think 段不进入回答正文；未闭合段拒绝处理。HTML/Markdown 均以纯文字核对，不执行脚本。
- 服务端重新取源，不接受客户端提交的正文、身份或会话历史。预览版本及所选附件版本变化时返回 `source_changed`；不会偷偷改成最新内容。
- 消息内容版本为 SHA-256 指纹，不能当数据库修订计数。冻结后的字节不随源编辑改变；读取、下载、授权、发送仍校验本人源权限、清空状态及所选附件可用性。
- 本地冻结是待交接缓存，不等于 TE-DNA 的持久副本授权。源删除/撤权/附件失效后不再从源侧读取或交接；不能承诺收回已下载副本。真实接收后的保存/删除/派生撤回规则由三方定稿。
- 同一人、来源版本、选择位置、内容和模拟目标共用快照/逻辑操作；更换 HTTP 幂等键或重复点击不新建副本。仅用途改变保留首次用途，并提示复用；不自动生成教案。显式“另存为新对象”尚未实现。
- 私有开发暂存 `storage/private/p03-dev/state.json`，0700 目录/0600 文件、原子替换/fsync、同进程串行事务。24 小时逻辑有效期，每次访问清理过期项；服务停止时不承诺物理定时删除。每账号最多 50 个快照。该单进程文件存储仅为可重启的开发证据，不是多实例生产持久层。
- 复用 `utils/canvas/download.js` 导出所选 `.md`，或含清单与勾选文本附件的 `.json`。下载前重新验证权限；JSON 不含源账号 ID、他平台账号 ID、JWT、凭据或磁盘路径。

## 开发入口与本地运行

无需真实数据库、账号或 Identity 的合成演示：

```bash
cd /home/hanying/ai-platform
node dev/p03-demo.mjs
# 打开 http://localhost:3004/dev/p03.html
```

普通演示页复用主站 ThemeProvider 和平台样式，只展示成果选择、准备与下载。来源哈希、范围偏移、不可用附件诊断、JSON 清单及模拟授权/收发仅在显式测试地址 `http://localhost:3004/dev/p03.html?p03Debug=1` 的开发详情区提供；普通界面没有调试入口。此参数仅控制开发界面展示，不代替任何服务端权限检查。

此演示复用实际 MessageContent、P03 界面、源适配器和快照服务；只将模型读取与认证替换为固定合成来源/模拟账号，监听 loopback。合成状态位于 `storage/private/p03-demo`，与真实本地应用的开发暂存分开。`node dev/p03-demo.mjs --fresh` 只清除这份合成接收状态，便于重复浏览器测试；没有访问真实教师数据库。

接入本地已有聊天时，后端启动环境设置 `NODE_ENV=development P03_DEV_ENABLED=true P03_DEV_USER_IDS=<本地测试账号ID列表>`，沿 `dev/README.md` 启动 `backend/src/server.js`；前端启动时设置 `VITE_P03_DEV_ENABLED=true`。这些是本机测试开关，不是教师资格、跨平台身份或正式协议。

两端默认均关闭。生产构建以 `import.meta.env.DEV` 硬隔离懒加载入口；即使 VITE 开关误设 true 也不包含功能代码。后端仅明确的 development/test 环境且开关 true 才挂载 `/api/dev/p03`。普通 user/admin/super_admin 都必须列入本地测试名单，并受相同的本人来源校验，不存在管理员导出别人会话的豁免。

## 内部原型接口（不作为正式线上契约）

| 本地路径 `/api/dev/p03` 下 | 作用 |
|---|---|
| `GET /messages/:id` | 读取本人单条回答的可选正文、来源版本、附件实际能力；给出本来源最近快照 ID 用于恢复 |
| `POST /snapshots` | 依据 `message_id / expected_version / selection / attachments / purpose` 冻结；请求不接正文 |
| `GET /snapshots/:id` | 核对当前权限后返回固定清单和字节，用于预览/下载 |
| `POST /snapshots/:id/authorize` | 仅签发本地模拟授权，可模拟有效/过期/撤销；不调用 Identity |
| `POST /snapshots/:id/deliver` | 向进程内假接收方发送，可模拟正常、暂不可用、已接收但丢失响应 |
| `GET /snapshots/:id/status` | 2026-09-19已改为先查询独立假接收回执，可直接恢复未知结果，无需重新发送正文 |

POST 必填 `schema_version: 1`、UUID `Idempotency-Key`，JSON 单对象/未知字段拒绝/16 KiB 上限/不带 query；每个响应有服务端 request_id、no-store、no-referrer，错误信封只给安全错误码和中文短句。测试区单独解析、限流，在常规请求日志前处理，正文、模拟授权和幂等键不进日志。真实本地应用仍复用现有 authenticate 的会话、停用、账号有效期校验；不得把请求体身份当主体验证。

假接收方只接 `{manifest,payload}`，没有网络客户端与正式 TE-DNA 接口配置。其已接收记录独立于源操作状态持久化；响应丢失后，过期/已用凭据不影响对已完成操作的同主体结果核对，仍检查源侧访问。恢复不会重建资源。界面结果始终明确“模拟接收方已接收；未写入 TE-DNA”。

## 提交给同一 I03/P03/T11 草案的内容贡献

版本：`p03-content-proposal-20260918.1`，状态：**P03 内容贡献，待 I03/T11 汇入与核对**。共同主笔是 Identity I03：`/home/hanying/pkuailab-ws/docs/integration-drafts/teacher-artifact-handoff.md`。本单不抢写共同文件、不自行编号、不将内部字段冻结为正式契约。

合成样例见同目录 `p03-synthetic-packet.json`。字段建议：

| 字段 | 意义与待对齐点 |
|---|---|
| source | practice / assistant_message / 本平台对象 UUID / conversation UUID / 内容版本；真实有记录的生成时间、模型名，未知为 null；不含账号映射 |
| locator | `answer_without_thinking_utf16` + 左闭右开 start/end；明确基于去 thinking 后的回答，不是字节偏移。正式多格式 Locator 需 T02 对齐 |
| format、byte_length | Markdown 原文字节数；不把围栏 HTML 冒充独立可执行作品 |
| content_sha256 | 本地按固定字段顺序 JSON.stringify(payload) 的 UTF-8 字节计算；正式跨语言规范化、签名/摘要绑定规则待 I03/T11 决定，不让 Go 接收方猜序列化顺序 |
| summary | `verbatim_excerpt`，所选内容前 160 个 Unicode 码点；不是模型总结或事实核验 |
| purpose | reference / lesson_preparation / courseware；仅意图，不表示已进入工坊或已生成成果 |
| visibility、material_status | private / ai_output_unreviewed；任何共享/正式共识须另有教师明确操作 |
| attachments | 勾选附件的源 ID、名称、真实格式、字节数、内容版本；payload 仅含其实际文本，不含磁盘路径/公开 URL/未选附件 |
| web_links | `references_only_not_fetched`，普通链接没有正文抓取证明 |

I03 需确认：同一教师两端关联与停用处理、实际动作允许表及目标限制；授权绑定源/版本/选择/内容摘要/用途的方式；一次性凭据与业务幂等分离；已接受结果查询、超时与撤权时序。Identity 不接正文。

T11/T02 需确认：当前个人资源接收类型及私有资源 ID/版本/派生引用落点；文本与附件格式、大小、UTF-8/摘要规范；持久保存副本授权与仅在线引用的区别；源删除、资源删除和隐私撤回语义；用途变化复用资源、打开既有工作空间、显式另存的关系。源 Locator 回源跳转路径需真实双站域名规则确认。

现状证据：只读核对了 TE-DNA `routes_teacher_resources.go`、`teacher_resource.go`；现有库主要承接 component/image/page/agent、使用 TE-DNA 本地登录会话。其正在开发的 `docs/design/T02-resource-references.md` 明确内部资源引用与版本快照，不含本次跨平台接收。未改 TE-DNA 或 Identity 仓、未使用 edu 凭据、未接生产 Identity。资源库已存在不等于本通道已可调用。

收尾时核对了 T02 新回写的 `/home/hanying/pkuailab-ws/docs/integration-drafts/t02-resource-evidence-examples.md`：内部引用使用原生资源 UUID、内容版和文档 Locator，区分 selected/loaded/模型引用；与本单的来源版和用途方向一致。但它尚不提供外部成果接收，不能将 practice UUID 直接当 tedna 资源 ID，也不能把模拟接收当已选入或已被模型读取。共同人级交接主稿此时仍未创建，待 I03 汇入双方贡献。

## P01 前提与验证记录

本单适用：现有会话主体、账号停用/有效期、本人消息及文件访问、默认私有、生产关闭。实际人级教师关联和导出持久副本授权尚未接通，由 I03 定稿后验证。本地 allowlist 只允许测试者，不把 role=user 当已确认教师。

学生 P0/C05/C06/C08、学生论坛/画廊/独立作品域、校籍变更验收不在本单完成声明内。本次未改这些通道，没有把学生消息作为样例，也没有向 C06 传正文；学生接入必要门槛仍沿 P01 原任务核对和补齐。

可重复验证命令：

```bash
cd /home/hanying/ai-platform/backend
npx jest --runInBand --runTestsByPath src/__tests__/unit/services/artifactHandoff.test.js src/__tests__/unit/middleware/authMiddleware.test.js src/__tests__/unit/models/File.test.js
cd /home/hanying/ai-platform/frontend
npx vitest run src/__tests__/unit/components/ArtifactHandoffDev.test.jsx src/__tests__/unit/utils/canvasExport.test.js src/__tests__/unit/utils/htmlBlockParser.test.js src/__tests__/unit/utils/apiFailureCleanup.test.js
cd /home/hanying/ai-platform
VITE_P03_DEV_ENABLED=true make build
# 启动 --fresh 合成演示后，使用本机安装的 Playwright（可通过 PLAYWRIGHT_MODULE 指定模块路径）
node dev/p03-e2e.cjs
```

后端 69 项、前端 32 项通过，其中 P03 定向 25+4 项、公共 API 回归 2 项。覆盖精确内容、源修改/旧版固定、未选内容隔离、并发重复、跨主体/错目标、过期/撤销、附件失效/路径逃逸/实际字节、接收失败、响应丢失与重启恢复、严格请求、生产关门、下载前权限复核。浏览器发现并修正公共 api.js 的未消费 finally 派生拒绝：改为成功/失败均清理控制器，不产生额外未处理 Promise；P03 使用 skipDebugLogging，开发调试也不打印其完整请求体。浏览器及构建证据见本次工作区独立回执。

未验：真实教师/真实作品质量、真实 I03/T11 联调、实际 TE-DNA 保存/资源复用、手机实机、双站部署、持久化数据库及多实例生产运行。合成通过不代表教育效果或学生边界验收。下一单按共同草案对齐后的适用身份能力 → T11 接收 → P03 真实适配/联调推进；反向聊天使用资源另开接续单。

## 2026-09-19 夜间：原生 I03 客户端已接入

Identity共同稿§17及`dev/i03/triad/p03-native-endpoints.patch`已在当前源树合入（只修改i03Client与合成worker）。服务可信配置可选择`endpointProfile: 'native-draft'`：issue/revoke使用共同稿候选backchannel路径，目标prepare/commit/status/cancel使用teacher-artifacts固定路径；默认lab不变，仍只允许development/test和loopback，production拒绝。prepare继续512KiB，控制消息16KiB；Basic仅发Identity。request_id按1–128字符ASCII字母数字/下划线/连字符校验，接受Gin的32位hex与fallback；它仅用于追踪，其余操作/资源UUID约束不变。

12项既有客户端回归及Identity契约脚本通过。P03自有`dev/p03-native-triad-check.py`将Identity驱动固定为临时只读副本，使用当前未再打补丁的源字节，调用真实Identity原生操作存储与T11接收/资源采用，六场景、7个Go通过事件、race、无skip全部通过。覆盖重复点击、prepare后撤权/版本变化/附件失效、成功丢响应后实际kill源/目标并两天后恢复、删除后查询；逐字核对选段、附件及不可变采用版本。所有自有数据库容器/卷已删除，不覆盖Identity结果文件或任何对端源。

复现：`PATH=/usr/local/go/bin:$PATH PYTHONDONTWRITEBYTECODE=1 python3 dev/p03-native-triad-check.py`。结果在`storage/private/p03-handoff-validation/native-triad/result.json`，绑定当前源、提供方、接收方和固定驱动SHA。先前驱动在另一任务更新期间的未完成收尾尝试已弃用；只引用最后status=passed结果。

证明边界仍是合成身份、源单进程文件store、目标隔离postgres owner；不证明真实教师、MySQL生产release、目标应用角色或生产TLS。J1/J2/J4、双站实例和T11主树发布集成仍待；不开放正式保存。讨论整理的独立实现/验收和夜间发布记录见`p03-discussion-summary.md`及工作区`20260919-P03-discussion-summary-release.md`；原下载持续复用，原始讨论不跨端。

## 2026-09-20：正式候选消费与 HTTPS 准备

最新源侧决定见 [P03 profile 消费回执](p03-profile-v1-review.md)：绑定 Identity 修订 `i03-review-20260920.1` 的 SHA，逐项交 ACK-P01–03。接受独立 HTTPS、可信操作截止及资格分工；未将候选晋升为正式协议。新增未装配的 `i03HttpsTransport.js`，本地真实 TLS 假对端和旧客户端兼容拒绝合计 35/35；原 draft 路径与线上整理/下载不变。

11:35 双站生产元数据只读核对：两站数据库实例不同，北大缺显式 instance key；现有标签/普通角色/文件可读不证明正式教师或持久复制许可；应用 DB 权限含 ALL PRIVILEGES，生产受限角色和 release 仍待接入。源 freeze 与 Identity 首 issue 窗口起点有差异，已给出分开正文期限与操作恢复期限的消费意见。具体证据、拒绝链、T11/I03 分工及待验项在上述回执，不再笼统等待全部授权。

未发布、未开放正式保存；真实教师/手机验收仍待。工作区独立回执 `docs/progress/20260920-P03-profile-consumer-review.md`，后续先比较候选/回执变化再展开相关检查，保持每 10 分钟；无源变不重复全树哈希和全环境探测。

### 2026-09-20 11:58：rc2 时间窗口增量已接受

Identity 已按源侧意见形成 `i03-review-20260920.2`。P03 [rc2消费确认](p03-profile-v1-rc2-review.md)绑定 rc1 与 rc2 两份 SHA，ACK-P02 接受首次持久 issue 起 W/R、正文与恢复元数据分开清理、未知首次签发先恢复/对账及票截止截断；窗口起点不再待澄清。原 rc1 回执不变。新增 V10–13 仍只是待执行规格，运行协议与生产开关未改，35项旧测试不重复计数。继续等待共同冻结/提供方、真实资格与持久复制事实、P03生产 release 和 T11主线装配；既有部署授权保持。

### 2026-09-20 14:05：消费 T11 默认关闭包并修复错误回执兼容

T11 主线在 `tedna-sync/releases/20260920-t11-integration/source` 冻结默认关闭的主应用集成包，正式父版 b548f3e；本单核对28源及closure绑定的50项证据SHA。它仍是未合主树、未发布的开发候选，运行协议为i03-draft-0.1。新增错误信封包含schema_version=1，原P03严格解析会将有效限流错误降为receipt_invalid；先复现失败，再仅对native-draft目标错误接受可选且必须等于整数1的schema_version，兼容旧原生目标。Identity/lab错误形状、未知字段和版本拒绝、成功资源及操作绑定、错误白名单、生产关闭均保留。

本次23项客户端（含9项新增）、18项源编排、21项HTTPS传输共62项通过；源编排覆盖成功丢响应后的重启恢复、撤权与并发取消。另用私有Go overlay调用当前T11真实Handler及P03当前客户端，400 invalid_request与429 rate_limited两场景通过race，保留安全分类/退避、无目标Basic、无自动重试；未用数据库或真实身份，不冒称完整主应用三端联验。私有证据在 `ai-platform-p03-summary/storage/private/p03-summary-validation/t11-envelope-native/`，独立回执为工作区 `docs/progress/20260920-P03-T11-envelope-compatibility.md`。

T11默认关闭接线/受限角色/生命周期已提供本地证据，后续需审阅合入正式父版；正式profile实现、D03、真实教师与逐附件持久复制事实、P03受限角色/持久release、生产同人验收仍待。不得用旧六组三端结果证明本次新包完整联验通过；原生驱动的旧12项计数及旧目标路径须在下次完整联验时按实际源更新。此修复未发布，原双站整理/下载不变。

### 2026-09-20：当前源与T11主应用候选的隔离联验证据已接收

Identity沿CTRL-20260920-I03-CURRENT-TRIAD-01完成独立新驱动，结果于14:33:38生成。P03在本轮读取工作区`docs/progress/20260920-I03-current-main-triad.md`、共同稿§23、驱动README及机器结果，并逐项复核2593个绑定输入SHA，全部与当前文件一致；没有复跑或改写其结果。新结果路径为`/home/hanying/pkuailab-id/dev/i03/current-triad/runs/20260920T063244Z/result.json`，SHA为`dfc636e811f7f1261b0ea803934fde150e6efd3beda24fe183a5778129ca5cc6`；复现入口为Identity仓`python3 dev/i03/current-triad/run.py`。此前六场景和本单两Handler场景均保持各自原时间/范围，不合并计数。

本次实际P03源客户端/编排、Identity原生Provider与未修改的T11候选cmd/server以受限业务角色运行，八场景（含父测试九Go通过事件）及23客户端＋18编排＋21 HTTPS共62回归通过，无失败/跳过。覆盖重复点击、prepare后撤权/版本改变/附件移除、真实commit成功丢响应后源和目标重启只查status、备课与课件API显式采用回执的同一资源版本、删除不复活、目标停用与实际限流错误。解除的是当前候选缺运行证据的工程缺口，不是正式上线条件。

限制：Identity使用Provider测试overlay而非完整应用入口；P03仍是单进程文件spool，教师/复制权为合成事实；目标也是合成开发资格。两天老化仅作用源spool，正式可信W/R和V10–13未验证。三端HTTP为隔离loopback、DB socket为合成trust，未证明生产TLS/DB鉴权；无真实教师/手机/模型质量验收。删除后历史原文仍存在但不可读，D03未物理清除。正式profile/提供方、真实资格与逐附件复制权、明确实例、P03生产受限持久release和原生撤权串行、T11受控合入及正式同版真实联调仍待，保存入口保持关闭。

Identity已用不可变事件`identity-i03-current-main-triad-20260920T064459Z`回传总控；本轮只是源侧核验及更新交接，不另发相同结果的确认事件或重复派单。后续按输入变化继续既有任务；双站e4d52d1不重复发布。
