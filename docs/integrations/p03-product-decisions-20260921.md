# P03 教师成果交接：用户产品决定记录（2026-09-21）

用户于 2026-09-21 在实践平台会话中对 I03/T11 共同稿悬而未决的三个产品问题作出决定。本文只记录决定、各端后果和仍需共同稿增补的接口点；不代表实现完成或正式 profile 已冻结。决定原话保留在工作区回执 `docs/progress/20260921-P03-product-decisions.md`。

## D03 历史正文：清除，配 30 天回收站

- 教师删除资料库中的转入资料后进入**回收站，保留 30 天可恢复**；30 天到期永久清除，包括历史版本快照里的正文字节（`resource_versions`），只留版本号、摘要、来源、采用关系和去重墓碑。"存着但不可读"的正文不再作为长期状态存在。
- 回收站期间：目录/预览/下载/检索不可用（沿 T11 现状），恢复后按同一 `resource_ref` 恢复可读。
- 备份按现有轮换周期自然清除，不单独回溯擦除；法务保全另行处理。
- 建议同时实施**采用即复制**：教案/课件采用某版本时把正文落到自己的版本里，资料库条目删除不影响教师自己的教案（当前 T11 实现删除后教案中该引用不可读）。删除前提示引用数。
- 归属：T11/TE-DNA 实现；P03 源侧无改动。

## J1 复制权：自己的副本自己控制；删除只删自己的副本/引用，永不删他人原文

- 转入的是教师本人在实践平台对话中选定的 AI 回答片段及该对话中的文本附件，进入本人 TE-DNA 私有库后即为本人副本，完全自己控制；源平台事后撤权不追回（`persistent_private_copy`，rc1 D02 确认）。
- 若内容来自他人（共享附件、他人上传），复制者**不得删除他人原文**，但可以删除自己的引用/副本。任何一端的删除都只作用于本端对象：删 TE-DNA 副本不影响实践平台的原对话和附件，实践平台删附件不追回已转入的副本。
- 首批范围仍限教师本人对话中的附件（当前对话模型下附件均为会话所有者上传）；D04 的学校撤权/隐私删除/禁止持久复制材料继续排除。

## J2 资格与实例：账号未绑定或 TE-DNA 侧不是教师就不能传；星云站不介入

- **发起资格**（实践侧）：账号有效、非学生模式/影子账号、已完成 Identity 同人关联。实践平台**不推断教师身份**。
- **教师判定**（目标侧）：由 TE-DNA 本地教师账号决定；TE-DNA 侧不是教师即拒绝（现有 `subject_disabled`/停用路径），教师失效即失效。
- **同人关联**（Identity）：未绑定即 issue 阶段 `source_link_unavailable`，不能传；实践侧不缓存关联状态。
- **实例**：首批仅 `pku-ai-platform-prod → pku-tedna-prod`；**ai.xingyuncl.com 不接 TE-DNA**（候选文件 `p03-instance-binding-candidate.json` 已按此记录）。

## 仍需共同稿增补的接口点（由总控转 Identity/TE）

1. 回收站期间与恢复后的 `status` 语义：**已由 rc3 §4 解决**——新增 `recycled`（保留资源身份 + `recycle_until`），`deleted` 保持墓碑终态，恢复为 recycled→succeeded 同资源身份；源侧已按此实现（见下"rc3 消费"）。
2. 30 天到期永久清除后，`status` 仍返回 `deleted`（墓碑保留），新 operation 不复活同一选择（沿 rc2 §2.5）。
3. 采用即复制是否进入 T11 正式范围，以及删除前引用数提示。

## P03 本轮据此实施

- 源侧资格候选 `handoffAuthority.js`：按 J2 用真实用户模型判断账号有效/未过期/非影子或学生，附件仅本会话所有者的文本文件，源锁使用 `MySQLHandoffStore.withOwnerLock`；不推断教师；默认关闭、未挂路由。
- **影子账号谓词（2026-09-21 18:5x 落到真实 schema 事实）**：决-9 / docs/02 §3 规定学生只有 edu 账号、实践账号是 SSO 自动建的影子——本仓 `users.uuid_source='sso'` 正是这一标记（建号时写入一次、无编辑入口、密码登录已拒绝该来源；Identity 关联的教师账号保持 `'system'`）。`checkSubject` 默认据此拒绝（`subject_not_eligible`），调用方注入的更严谓词只能叠加不能放宽。决-12 的学生组映射列（`user_groups.edu_school_id + cohort`）尚未入库，入库后把"组为映射学生组"并入谓词即可；本地线上副本显示星云站有 438 个 `sso` 影子账号、`user_groups` 无映射列、无 P03 表。
- 候选配置：星云站 `handoff.enabled=false` 附用户决定引用。

## rc3 消费（2026-09-21 18:3x）

Identity 候选 `teacher-artifact-handoff/1-rc3`（`dev/i03/review/profile-v1-rc3.md` SHA `90c21a95…`，代码 `14b9852`，rc2 提供方 25b5ff1 保留）已在源侧消费：

- 状态模型（§4）：formal 路径接受 `recycled`（保留 `resource_ref`/`resource_version`/`open_target`，必带整数 `recycle_until`），`deleted` 保持墓碑终态；源侧转移规则 succeeded⇄recycled 同资源身份、recycled/succeeded→deleted、deleted 后任何变化拒绝、`recycle_until` 一次设定不得变化；recycled 不写不重传、不被本地 L 改写为 expired；`cancel` 在 recycled 上接受 `cancel_outcome: already_succeeded`。draft wire 继续拒绝 `recycled` 与 `recycle_until`。V14–V16 源侧测试通过。
- 仅北大实例对（§2）：真实提供方 V10–13 九场景在 rc3 提供方（含 `artifact_handoff_formal_pairs` 白名单）上重跑通过；源侧不感知 pairs 表，只承受 403 `action_not_allowed`。
- 资格（§3）：确认源侧学生/影子占位谓词不满足启用条件；入口保持关闭直到可信标记入库。
- **真实接口差异（已报 Identity，已解决）**：§4.2 矩阵中 succeeded 状态下的 prepare/commit 原写 `409 state_conflict`，该码不在共同稿固定安全码列表内，P03 客户端会按 `receipt_invalid` 拒绝。Identity 评审修订 `.3`（SHA `1bf29999…`）采纳本仓第二选项：不新增错误码，目标对已成功操作的 prepare/commit 幂等回放原成功（`status:succeeded, replayed:true` + 原资源身份）；源侧无改动（本仓 `remember()` 已按同资源身份接受回放）。其余字段/枚举与本仓实现一致。

### rc3 评审修订 .4（J3，2026-09-21 17:38）

Identity 固定版本更新为 `i03-review-20260921.4`（`profile-v1-rc3.md` SHA `8126f53909211a7c82725c913a784b903c2c6e6bf6edae34555a741d4fb4afdf`，作废 `1bf29999…`；提交 6969c1f；事件 `identity-i03-rc3-review4-j3-20260921T093849Z`）。差别只在 §1 新增用户决定 J3——**目标教师范围为所有教师，含普通教师**（用户原话"对，所有老师，包含普通老师"）；§3 目标谓词由 TE 提案改为已定（`users.status='active'` 且 `role ∈ {viewer, operator, senior_operator}`，在 owner 行锁后核，`subject_disabled`/`subject_not_eligible` 均在固定码表）。对源侧：**无任何改动**——教师判定在 TE 本地；源侧仍只判可信发起（账号有效、非学生/影子、已同人关联）；rc1/rc2 字节与提供方代码 `14b9852` 不变，V10–13 复跑与 rc3 消费结果继续适用。Identity 仍等本仓真实学生/影子谓词；其 current-triad 重绑已锚定本仓 `3e43420` 的客户端字节（`i03Client.js` `b0a799d6…`、客户端测试 `efec186c…`，本轮未变）。
