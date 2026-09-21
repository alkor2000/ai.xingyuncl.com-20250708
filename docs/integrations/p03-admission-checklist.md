# P03 教师成果交接：实例与来源准入清单（固化，2026-09-21）

派单 CTRL-20260921-PRACTICE-I03-RUNTIME-01 第 4 项。本清单只固化**已有事实的接线与缺口**，不自行规定授权、期限或替代判据；每一项都对应正式运行时（`backend/src/services/artifactHandoff/formalRuntime.js`）或源适配器里已经存在的拒绝路径。生产执行、enrollment、开关开启均不在本仓授权范围。

## 1 实例准入

| 实例 | 事实（2026-09-21 用户只读核对） | 运行时行为 | 待办 / 归属 |
|---|---|---|---|
| 北大站 `ai.pkuailab.com` | 运行容器 `IDENTITY_DEPLOYMENT_INSTANCE_KEY` **为空**；`IDENTITY_CLIENT_ID=ai-platform-client` 与候选一致；`IDENTITY_ENABLED=true` | 开关为 true 时要求实例键 === `pku-ai-platform-prod`（`TRUST.sourceInstance`），否则 `handoff_instance_mismatch`，启动失败关闭 | 实例键须经 **enrollment 流程**写入（`identityEnrollmentRuntimeConfig` 文件模式或运维配置），**不手填生产 env、不代建实例**；归运维 + Identity 登记 |
| 星云站 `ai.xingyuncl.com` | 实例键 `xingyun-ai-platform-test`、测试 client | 用户决定 J2：不接 TE-DNA。运行时对该实例键/client 一律 `handoff_instance_mismatch`；Identity `artifact_handoff_formal_pairs` 亦不含该对 | 不建角色、不配开关；其应用账号全局 `ALL PRIVILEGES ON *.*` 记为**独立加固风险**（凭据轮换方案），不在本包顺带撤权 |
| 实例对 | 首批仅 `pku-ai-platform-prod → pku-tedna-prod` | 传输与运行时常量固定（`i03HttpsTransport.TRUST`），配置须逐项相等 | 生产 policy/pairs 行归 Identity 运维（G6） |

## 2 发起主体（源侧"能否发起"，不判教师）

| 判据 | 事实来源 | 拒绝码 | 缺口 |
|---|---|---|---|
| 账号存在、未删除、`status='active'`、未过期 | `users`（应用模型 `User.findById`） | `subject_disabled` (403) | — |
| 非影子账号 | `users.uuid_source='sso'`（edu SSO 自动建的影子账号，决-9 / docs/02 §3；建号写入一次、无编辑入口；两站分别 439 / 11 个） | `subject_not_eligible` (403) | — |
| 非学生组（决-12） | `user_groups.edu_school_id + cohort` 映射列**两站均未入库** | 入库后并入 `isStudentAccount` 叠加谓词 | **不得宣称学生组全部覆盖**；入库前仅影子谓词生效 |
| 已同人关联 | Identity 在 issue 阶段判定 | `source_link_unavailable`（Identity） | 源侧不缓存关联状态 |
| 教师身份 | TE-DNA 本地账号（J2/J3：所有教师含普通教师） | `subject_disabled` / `subject_not_eligible`（目标） | 源侧不推断、不缓存 |

## 3 内容与逐附件复制权（J1 / D04）

| 项 | 现有事实接线 | 拒绝码 | 缺口（不自行补授权） |
|---|---|---|---|
| 回答正文 | 本人会话（`conversations.user_id`）、未清空（`cleared_at`）、助手回答 `completed`、精确选段与版本 | `source_permission_revoked` / `source_not_ready` / `source_changed` | — |
| 附件 | 仅本人上传（`files.user_id`）、`status='ready'`、`.txt/.md` 文本、≤64 KiB、无 NUL、路径在上传根内 | `attachment_unavailable` (409) / `attachment_unsupported` (422) | **无逐附件"可持久复制"事实字段**；首批按 J1 只接受本人会话内本人上传的文本附件，其余全部由构造拒绝 |
| 他人材料 | 当前会话模型下附件均为会话所有者上传，不存在他人附件路径 | 非本人 → `attachment_unavailable` | 若未来引入共享附件，须先有权利事实，否则保持拒绝 |
| D04 排除项（学校撤权 / 隐私删除 / 禁止持久复制材料） | **无事实源** | 缺证即拒绝：无法证明可复制的材料不进入包（当前只有本人文本附件能进入） | 判据与数据源归总控/学校政策；本仓不以教师身份或勾选替代权利 |
| 持久副本与撤权 | `persistent_private_copy`：release 前撤权阻止 commit（源锁+复核），release 后不追回目标副本 | `source_permission_revoked` | — |

## 4 数据保留（只列待决，不自选期限）

| 项 | 现状 | 待决归属 |
|---|---|---|
| 源账本元数据 | 保留至 max(冻结+30d, R+1d)，之后清理（候选参数，非协议值） | 冻结时与 Identity/TE 请求上界对齐 |
| 正文快照 | L = 冻结+24h 后清除；release 后不重传 | — |
| 数据库备份 | 沿 `/var/backups/ai-platform/mysql/` 现有轮换；"≥R+墓碑期"为运维建议**未批准** | 总控/运维 |
| 法定保留 / 法务保全 | 未定 | 总控 |

## 5 R 之后的源侧显示

正式 wire 上 `recycle_until = 删除+30d ≥ R`，源侧在 R 后**不再申请授权、不再查询**，`recycled` 因而是常见的最后观测状态。当前**没有面向用户的交接状态页**（只有开发验证路由 `/api/dev/p03`，默认关闭）。将来若展示：写"已在目标回收站（最后同步 <时间>）"而非"已删除"，展示 `view()` 里的最后已知状态与本地记录时间，**不承诺实时、不自动续查 R 后状态**；`recovery_until` 到期后只显示最后已知结果。

## 6 运行时门（工程就绪 ≠ 产品准入）

`P03_HANDOFF_ENABLED=true` 时逐项核验并在任一缺失时启动失败关闭：Identity 配置有效且实例/issuer/client/公开 origin 与 `TRUST` 相等 → `P03_HANDOFF_*` 六项逐字相等 → 受限账本账号（非应用账号、口令 ≥16）→ 账本就绪（库名相等、MySQL 8、授权恰为四表 DML、四表列齐）→ 传输固定 origin/443/系统 CA（实验注入仅 development/test）。Ready 只代表工程条件齐备，**不代表** D04、备份、教师实机、生产 policy/pairs、发布授权已获批；公开保存入口仍未挂载。
