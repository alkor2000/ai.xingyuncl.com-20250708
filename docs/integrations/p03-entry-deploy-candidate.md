# P03「保存到备课资源库」产品入口：变更清单、隔离验收与候选部署包（2026-09-22，未发布）

派单 CTRL-20260922-PRACTICE-P03-ENTRY-01，基线 `codex/p03-handoff-adapter` @ `8c51c02`（含 051652b 正式运行时）。本文只陈述本包实际做了什么、在什么条件下验证过、发布前还缺什么；**不是发布/开启授权**，也没有改任何生产配置、迁移、角色或 enrollment。

## 1 产品流程（复用现有对话页，不另起整站 UI）

入口挂在 `MessageContent.jsx` 已完成的助手回答动作条里，与「下载成果」同一门禁（助手、`completed`、非临时、有正文）。**只有当前部署的正式运行时开启时才会出现**：组件先取一次 `GET /api/p03/handoffs/capability`（每次页面加载一次），`available:false`（默认关闭）或请求失败时不渲染任何东西。

| 步骤 | 界面 | 发送到后端的内容 |
|---|---|---|
| 1 选择内容 | 整条回答 / 选择片段（拖选原文）、勾选 ≤3 个文本附件、资料标题（≤120 字，默认取首 40 字）、用途（个人参考 / 备课 / 课件） | 只有 `GET /messages/:id` 预览与 `GET ?message_id=` 本地记录；**零 POST** |
| 2 预览确认 | 表格列出资料标题、用途、来源（回答 id 前 8 位 · 版本前 12 位）、保存到（`TE-DNA 备课资源库 · 我的资料（北大实例）`）、附件；下方即将发送的正文；边界说明（只导出所选回答与勾选附件，不带其他会话/提示词/思考过程，链接只保留文字） | 仍为零 POST |
| 3 明确保存 | 按「确认保存到备课资源库」后：`POST /api/p03/handoffs`（冻结所选，`Idempotency-Key` 按序列化后的选择缓存，同一选择同一键）→ `POST /:id/save`（prepare/commit）；页面进入状态卡 | 请求体只有 `schema_version, message_id, expected_version, selection{start,end}, attachments[{source_id,expected_version}], purpose, title`；**不含任何教师/账号/目标身份** |
| 状态卡 | 标签 + 操作编号 / 资料编号 / 回收站保留至 / 最后同步 / 状态可查询至；按钮：重试保存（未结算且未过 R）、刷新状态（未过 R）、取消（仅 `ready`）、重新选择、关闭 | 重试 = 同一操作 `POST /:id/save`；刷新 = `POST /:id/refresh`；不产生第二份副本 |
| 页面刷新恢复 | 再次点入口时先 `GET ?message_id=`，有未终态（或最新）记录就直接进状态卡，不取预览、不调对端 | 只读本地账本 |

状态映射（沿 fc1+e1，不自创）：`ready` 已选定尚未发送 / `unknown` 结果待确认（可重试） / `prepared` 已送达等待确认 / `succeeded` 已保存 / `recycled` 已在目标回收站（显示 `recycle_until`，无重试） / `deleted` 目标已清除 / `cancelled`·`expired`·`rejected` 终态。过 R（`recovery_until`）后隐藏刷新与重试，只显示最后一次同步结果；`status` 查询失败不改写已有终态（运行时规则，路由测试与 V16/V17 覆盖）。错误提示按固定码翻译（`chat.handoff.error.*`）并附请求编号；这些请求关闭 API 客户端的通用 toast（`skipErrorMessage`，新增的按请求选项，默认行为不变）。

## 2 后端入口 `/api/p03/handoffs`（`backend/src/routes/artifactHandoffEntry.js`）

- 全部在 `authenticate` 之后；教师身份只来自登录会话（`req.user.id`），请求体/查询串里的任何身份字段都不被读取。`app.locals.p03Handoff` 不是 enabled 时，除 `capability`（回 `available:false`）外一律 `503 handoff_disabled`——**不建池、不读凭据、不调对端**。
- 端点：`GET /capability`（wire、目标实例、用途、限额）、`GET /messages/:id`（预览：`checkExport` + `inspect`，先做资格预检）、`GET /?message_id=`（本账号该回答的本地记录）、`POST /`（冻结；`Idempotency-Key` 必须为 UUID；`schema_version:1`；标题 ≤120 字无控制字符；用途白名单）、`POST /:id/save`（resume）、`GET /:id`（本地视图，不调对端）、`POST /:id/refresh`（status）、`POST /:id/cancel`。
- 门禁全部由运行时/Identity/目标决定：活跃、未过期、非影子（`users.uuid_source='sso'`）、本人未清空会话、本人文本附件、实例/policy/pairs、关联（Identity `source_link_unavailable`）。没有新增任何默认 true 的特性位。
- 错误信封 `{error:{code,message,retryable,peer?},request_id}`，`Retry-After` 随可重试错误；16 KiB 严格 JSON；60 次/分钟；除列表的 `message_id` 外拒绝查询串；`X-Request-ID`、`no-store`、`no-referrer`。

## 3 隔离验收（真实链路，2026-09-22 07:53，结果 `passed`）

`dev/p03-triad/check.py --candidate=candidate-entry.json`（固定 TE runtime-r2 与 Identity G7 提供方，`GOFLAGS=-mod=readonly`，输入指纹前后一致 `inputs_unchanged:true`），证据目录 `storage/private/p03-handoff-validation/triad-20260922-entry-browser-r2/`：`result.json` SHA `45cdd8efd8eb2636…`、`browser_entry.json` `d2cdb681324cae89…`、`identity-browser_entry.json` `289230cd2eae665a…`、25 张截图。

| 组件 | 本次 | 真实 / 合成 |
|---|---|---|
| 实践后端 | **真实 `backend/src/server.js`**，`P03_HANDOFF_ENABLED=true` + `P03_HANDOFF_LAB`（仅 development/test 生效的实验路由：隔离 CA 替换系统根、回环解析、实验端口、合成实例对 `practice-synthetic → tedna-synthetic`；production 直接拒绝该变量） | 真实代码；实例名与 CA 为实验事实 |
| 实践数据库 | 隔离 `mysql:8.0`：本地 practice-mysql **只取结构**（114 表，无行）+ knex 记账行；账本候选迁移 `20260921_001_p03_handoff_ledger.js` 由 knex 以应用账号执行（只此一个 pending）；受限角色按 `restrictedRoleGrants()` 建 4 条 DML 授权；运行时就绪核验通过 | 结构真实、数据合成 |
| 账号 | 合成三枚：教师 101（Identity 已关联）、影子学生 102（`uuid_source='sso'`，无口令登录，以实验 JWT 注入会话）、未关联教师 103；一段合成会话（5 条回答 + 1 个 .md 附件） | 合成；**无真实教师** |
| 前端 | 真实 `frontend/`，Vite dev server 代理到上述后端；Playwright Chromium（`/home/hanying/feedback-sync-ws/tools` 的模块与用户态浏览器依赖库） | 真实 |
| Identity | 真实 Go/PG18 提供方 `internal/artifacthandoff`（G7 固定 commit `9b6ca011`，`EnableFormalCandidate` + formal policy/pairs），本仓 `entry_overlay.go` 只读 overlay：时钟跟随墙钟（每 200 ms）、Gin 请求 ID + Basic、TLS 前端（`id.pkuailab.com` 证书由本次隔离 CA 签发）；把 fixture 的 `p-teacher` 源关联换成实践账号 `101` | 真实提供方；非完整 Identity main |
| TE 目标 | 未修改的 T11 r2 `cmd/t11-lab formal:true`（manifest `f34fc3ae…`，二进制 SHA `53e643a0…`），PG16 S05b 后像 + `20260921_03`；`formal_scenarios.py` 的 TLS 中继作 `workflow.pkuailab.com` 前端；时钟每秒跟随墙钟，仅回收场景为其自身 purge 前移 31 天 | 真实接收方；实验角色模型 |
| 隔离 CA | 每次运行临时生成（本次 `6882415a…`），只被实践传输信任，系统根被替换 | 实验 |

| 场景（宽度） | 结果 | 截图 |
|---|---|---|
| 默认关闭（1280） | 同一服务器不设开关：动作条无入口（5 条回答均只有「下载成果」）；`capability` `available:false`；直接 `POST` 冻结 → `503 handoff_disabled` | `default-off-desktop.png` |
| 桌面保存（1280） | 片段 + 1 附件 + 标题；预览显示内容/标题/来源/目标/附件；确认前 **0 个 POST**；确认后恰 1 次冻结 + 1 次 save → `已保存到备课资源库`；t11-lab 存下的包 = 精确片段（42 B，`locator` 与所选一致）+ `activity.md`，不含其他 4 条回答 | `desktop-1-select/2-preview/3-status.png` |
| 刷新恢复（1280） | 页面 reload 后再点入口：只有 `GET capability` + `GET ?message_id=`（无预览、无 POST）即回到 `succeeded`；刷新状态 = 1 次 `POST /refresh` 仍 `succeeded` | `desktop-4-after-reload.png` |
| 重复点击（360） | 确认按钮连点两次：1 次冻结 + 1 次 save，目标只多 1 份副本 | `w360-1/2/3-*.png` |
| 失败恢复（390） | 中继让第一次 commit 返回 `503 target_unavailable`（Retry-After 1）：状态 `结果待确认` + 精确错误 + 请求编号 + 「重试保存」；2.5 s 后重试同一操作 → `succeeded`，目标仍 1 份 | `w390-1/2/3-*.png`、`w390-4-retried.png` |
| 回收/清除（430） | 目标 `delete` → 刷新 `已在目标回收站`（显示回收站保留至，无重试）→ `restore` → `succeeded` → 再删 + 目标自身前移 31 天 purge → `目标已清除`（无重试、可刷新）；源侧全程不写不重发 | `w430-1/2/3-*.png`、`w430-4-recycled.png`、`w430-5-deleted.png` |
| 资格拒绝：影子账号（360） | 点入口即 `当前账号不能发起保存（学生/影子账号或未满足资格）`，无选择区、无确认、**零 POST** | `w360-eligibility-1-refused.png` |
| 资格拒绝：未关联教师（390） | 本地冻结成功，save 被 Identity 在 issue 阶段拒绝（`source_link_unavailable`，409 原样透传）；目标未收到任何请求；Identity 未创建操作 | `w390-unlinked-1/2/3-*.png` |

Identity 侧核对（overlay）：issue 相位 `prepare/commit/status` 共 16 次、redeem 14 次、legacy 路径 0、无 Basic 的调用 0、操作数 **4 = 驱动记账**（重复点击/重试/刷新未多建，拒绝账号未建）、全部 `teacher-artifact-handoff/1`。实践账本：5 条操作（3 `succeeded`、1 `deleted`、1 `unknown`（未关联教师）），owner 只有 `101`/`103`；后端/Vite/浏览器日志无凭据；页面无 JS 错误。

**不是**：真实教师/实机验收（自动浏览器不能冒充）、生产 TLS/证书链、生产 Identity policy/pairs、TE 生产目标、生产迁移与角色。

## 4 精确变更清单（相对 `8c51c02`）

新增：
- `backend/src/routes/artifactHandoffEntry.js`（入口路由）；`backend/src/__tests__/unit/routes/artifactHandoffEntry.test.js`（6 项：默认关闭、信封、冻结→保存→列表/刷新、失败可重试/回收/R、资格拒绝、挂载）
- `frontend/src/components/chat/ArtifactHandoff.jsx`（入口组件）；`frontend/src/__tests__/unit/components/ArtifactHandoff.test.jsx`（7 项：不可用即不渲染、确认前零发送与精确请求体、重复点击与同键重试、同选择同键/改选择换键、刷新恢复与回收、R 后终态不再查询、资格拒绝）
- `dev/p03-triad/entry_overlay.go`、`dev/p03-triad/entry_scenarios.py`、`dev/p03-triad/candidate-entry.json`、`dev/p03-entry-e2e.cjs`、`dev/p03-entry-web.mjs`（隔离验收运行器；`entry_scenarios.py --smoke` 只跑默认关闭阶段）
- 本文

修改：
- `backend/src/services/artifactHandoff/formalRuntime.js`：`P03_HANDOFF_LAB`（仅 development/test；production 拒绝）、实例对随实验事实、`readiness.laboratory`；`artifactHandoffFormalRuntime.test.js` 新增 1 项（生产拒绝、契约需同名、畸形文件全部配置错误）
- `backend/src/services/artifactHandoff/i03Source.js`：`list(owner, messageId)`、记录 `frozen_at`/`receipt_at`，视图增 `message_id`/`frozen_at`/`last_synced_at`
- `backend/src/app.js`（挂载 `/api/p03/handoffs`）、`backend/src/server.js`（注释）
- `frontend/src/components/chat/MessageContent.jsx`（与「下载成果」同门禁挂入口）、`frontend/src/utils/api.js`（按请求 `skipErrorMessage`，默认不变）、`frontend/src/locales/{zh-CN,en-US}/chat.json`（`chat.handoff.*` 各 71 键）
- `dev/p03-triad/check.py`（候选可指定 `go_test_timeout`/`runner_timeout_seconds`、透传 `linked_source_accounts`、随驱动复制 `formal_scenarios.py`、指纹含入口文件）

测试：P03 14 套 165 项通过（含入口路由 6 项、运行时实验注入 1 项）；后端全量 825 通过、6 项 HEAD 既有失败（ImageService/MessageService）；前端 `ArtifactHandoff` 7 项通过、全量 159 项通过（3 个既有加载失败文件与本包无关：ChatInputArea/EmptyConversation/authStore）；`vite build` 通过。

## 5 候选部署包（顺序；本包不执行任何一步）

1. **代码**：本分支提交（见 §4）经合并进入 main 后按 dev/RELEASE.md 走 `make deploy`（星云）→ `make deploy-docker`（北大）。入口对两站默认无害：开关未设 → `capability available:false` → 前端不渲染入口；直接调用 → `503 handoff_disabled`。星云站即便设开关也因实例键不等于 `pku-ai-platform-prod` 启动失败关闭（J2）。
2. **账本表**：`backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js` 在 G3/G4 授权后**晋级到 `backend/migrations/`**（北大站 `make deploy-docker` 自动执行；星云站不建）。加法 DDL，回退为 `down`。
3. **受限角色**：按 `p03-restricted-role-runbook.md` 建 `P03_HANDOFF_DB_USER`（只对四表 DML），`backend/scripts/p03-ledger-readiness.cjs` 只读核验。
4. **Identity**：北大站经 enrollment 写入 `IDENTITY_DEPLOYMENT_INSTANCE_KEY=pku-ai-platform-prod`（当前为空）；Identity 侧生产 policy 行 + `formal_pairs`（G6）；TE 生产目标发布。
5. **开启**：北大容器设 `P03_HANDOFF_ENABLED=true` 与 `P03_HANDOFF_*` 六项（`p03-instance-binding-candidate.json` `env_candidate_pku`）+ 角色凭据，重启；启动日志出现 `P03 formal handoff runtime ready`；用一个已关联教师会话核对 `GET /api/p03/handoffs/capability` → `available:true`。任一事实缺失时进程启动失败关闭，不会半开。
6. **回滚**：去掉开关重启即隐藏入口（本地记录保留，账本表保留）；数据库回滚沿 `/var/backups/ai-platform/mysql/`。
7. **不含**：`P03_HANDOFF_LAB` 在 production 被拒绝，不能用于生产；`dev/` 运行器只在本机实验。

## 6 剩余准入缺口（不由本包决定）

- 真实教师实机验收（桌面 + 手机）未做；本次全部为合成账号与自动浏览器。
- 北大站实例键为空（enrollment 流程）；Identity 生产 policy/pairs；TE T11 候选未发布；生产 TLS 链未在生产核验。
- 迁移候选未晋级、受限角色未建、开关默认关闭——全部需要单独授权。
- 决-12 学生组映射列未入库（只影子谓词生效）；D04 排除项无事实源；逐附件持久复制权只接受本人文本附件。
- 目标显示名（`TE-DNA 备课资源库 · 我的资料（北大实例）`）为文案常量，随 `TRUST` 实例对固定；实例对变更须同步文案。
- 429 `retry_later` 的按钮退避已在 9 月 23 日独立候选补齐（§7，尚未集成或发布）；R 后与 `reconciliation_required` 只显示不提供运维出口（对账仍走 `reconcile()`，无界面）。
- 本入口只覆盖单条回答；「一组成果」按一条一操作逐条保存（同一会话多条各自冻结），未做批量选择 UI。

## 7 2026-09-23 重试等待增量（独立候选，未发布）

基于入口包 `f737a89`，分支 `codex/p03-retry-cooldown-20260923`。只修改 `ArtifactHandoff.jsx`、其组件测试、中英文 `chat.json` 及本文；不改后端、协议、开关、数据库或原隔离联验输入。

- 等待截止取本地操作 `retry_at` 与错误响应 `Retry-After` 的较晚值，后者接受秒数或 HTTP 日期。等待期间禁用确认保存、重试和刷新；显示中英文秒数。无效或已过期的头不造成永久禁用。
- 保存或刷新失败后只读一次本地操作，恢复服务端已记下的等待时间；本地读取失败时保留原状态与响应头。重新打开或刷新页面仍从账本取 `retry_at`。响应头只在当前组件存活期间保留，不写浏览器持久存储。
- 幂等冻结若恢复出尚在等待的旧操作，只进入状态卡，不紧接着发送；等待结束仍须明确点击，保持原操作和原冻结请求键，不自动重试、轮询或产生第二份副本。
- 计时器只更新打开弹窗内的显示，到恢复期限 R 后隐藏查询与重试；事件处理也检查当前时间，避免浏览器延迟刷新时越过界面门禁。

本增量验证：`vitest run src/__tests__/unit/components/ArtifactHandoff.test.jsx` **15 项通过**（原 7 项 + 8 项等待、重开、HTTP 日期、冻结重放、终态保留与 R 边界场景）；前端生产构建通过。测试使用模拟 API 与可控时钟，仅证明本组件行为，不代替 §3 的三端验收或真实教师手机验收。未重跑无变化的后端/三端组合。原 §6 其余生产准入条件继续适用，集成由主线按固定变更清单安排。
