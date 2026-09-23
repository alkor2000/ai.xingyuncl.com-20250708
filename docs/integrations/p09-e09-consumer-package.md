# P09 → edu E09 消费就绪包（候选，未冻结）

给 edu 侧实现 E09 的人。本文只描述**实践平台这一侧已经实现、可被独立启动和验证**的东西，以及**还不存在、必须由 edu/Identity 实现**的东西。所有接口都是**本项目候选**：`contracts/integration-clients.md` 至今不存在，本文不冒充正式协议，也不代 edu 写契约。

## 0 一句话边界

- **签名任务上下文不是 C05**。C05（学生 SSO）在本仓未实现；P09 用一条独立的签名上下文顶上，它只证明"edu 说这次操作属于这个作业/这个学生 uuid"，不是学生登录链。
- **浏览器请求头不是身份认证**。评阅会话绑定 UA+Accept-Language 的哈希，那是**防转发**；这两个头可以被复制，**把 Cookie 连同相同的头一起转发不会被这一层拒绝**。
- **没有真实资格提供方时，实践继续拒绝**。教师评阅入口在未配置提供方的部署上一律 `eligibility_unavailable`(503)，不会先发一张票再说。

## 1 固定源与如何独立启动

| 项 | 值 |
|---|---|
| 仓库 | `alkor2000/ai.xingyuncl.com-20250708`，分支 `codex/p09-website-artifact` |
| 固定提交 | 见本包回执的 `practice_branch_head`（每次交付都写明） |
| 运行时开关 | `P09_WEBSITE_ARTIFACTS_ENABLED`（未设或 `false` = 关闭且零副作用；其他值 = 配置错误） |
| 账本 | `backend/migrations-candidates/p09/`（**候选目录**，knex 不扫描，未晋级） |
| 账本角色 | `P09_DB_USER` / `P09_DB_PASSWORD`，须与应用账号不同；授权语句由 `store.restrictedRoleGrants()` 生成 |
| 隔离预览域 | `P09_PREVIEW_ORIGIN`（https；开发/测试可 http）、`P09_PREVIEW_BIND`、`P09_PREVIEW_FRAME_ANCESTORS`、可选 `P09_PREVIEW_TLS_KEY`/`_CERT` |
| 发行方 | `P09_TASK_ISSUERS_FILE`（生产唯一入口）；`P09_LAB` 只在 `NODE_ENV=development|test` |
| 对账节奏 | `P09_SYNC_INTERVAL_MS`（默认 60000，下限 5000）、`P09_SYNC_VERIFY_MS`（默认 300000） |
| 依赖锁 | `backend/package-lock.json`、`frontend/package-lock.json`（本包未改依赖） |

**独立启动（不需要 edu）**：`python3 dev/p09-lab/check.py` 起两套实例 + 一次性 MySQL + 真实前后端 + 浏览器，自带一个实验发行方与实验资格名册；`dev/p09-lab/asset-ownership.py` 跑真实上传与固定版本资源；`dev/p09-lab/migration-replay.py` 跑账本迁移的重复/中断/回退检查。三者都只用一次性容器，结束即删。

## 2 端点（候选）

**edu 服务端读取**（静态服务凭据签名：`x-p09-client / x-p09-key-id / x-p09-timestamp / x-p09-nonce / x-p09-signature`）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/integrations/edu/website-artifacts/state?school_ref=&assignment_ref=&student_uuid=` | 当前状态快照 |
| GET | `/api/integrations/edu/website-artifacts/events?school_ref=&cursor=&limit=` | 增量事实（`limit ≤ 500`） |
| POST | `/api/integrations/edu/website-artifacts/revisions` | 提交事务里固定一版（带 `website_artifact_revision` 上下文 + `Idempotency-Key`） |
| POST | `/api/integrations/edu/website-artifacts/review-sessions` | 一次性评阅入口（带 `website_artifact_review` 上下文） |

**学生端**（学生自己的登录会话）：`GET /capability`、`GET /links`、`POST /links`、`POST /links/:id/unlink`、`POST /links/:id/revisions`、`POST /links/:id/preview-sessions`，前缀 `/api/p09/website-artifacts`。

签名与令牌的**可复算向量**见 `p09-website-artifact-source-candidate.md` §2b。

## 3 词表与字段（样例）

一条 `state.items[]`：

```json
{
  "artifact_ref": "…uuid…", "project_ref": "…uuid…", "entry_ref": "…uuid…",
  "source_instance": "xingyun-ai-platform-test", "assignment_ref": "assign-1", "lesson_ref": null,
  "student_uuid": "edu-uuid-0001", "title": "校园节水网站",
  "state": "active", "work_state": "preview_ready",
  "save_evidence": "observed", "save_evidence_reason": "observed_save", "has_effective_save": true,
  "real_save_count": 3, "last_real_save_at": 1790093719384, "change_no": 5,
  "observed_writes": 5, "unprojected_writes": 0, "pending_reconcile": false,
  "preview_available": true, "saved_at": 1790093719384, "source_touched_at": 1790093719000,
  "synced_at": 1790093719500, "linked_at": 1790093700000, "revoked_at": null, "revoked_reason": null,
  "revisions": [{ "revision_ref": "…uuid…", "revision_no": 1, "content_sha256": "…", "byte_length": 5120, "created_at": 1790093719900 }]
}
```

- `title` 是**读取当时的作品名**，不是关联时的名字：`/state` 在取水位和取行的**同一个事务快照**里，按（作品所有者 + 项目）去实践自己的来源表读这件作品现在叫什么。名字只能来自服务端已经核过的来源，**没有任何请求字段能把名字送进来**。
  - 学生改名 → 下一次 `/state` 就是新名字；改名**不是保存**，第 4 节的口径不变（不产生新事件、不加保存次数）。
  - 来源已删、名字为空、或这行账本此刻证明不了名字（例如读取来源的权限被收窄）→ **`null`**，不拿旧名字顶替。`null` 的意思是"此刻无法证明"，请显示明示回退（如"未命名作品"），**不要**回事件里翻旧名字当现名。
- **事件里的 title 是"那件事发生时的名字"**，两处不一致是对的：列表显示用 `/state`，历史叙述用事件。`artifact.created / updated / preview_ready / revision_fixed` 带当时读到的名字；`artifact.deleted / preview_revoked` 分两种——项目还在、只是入口页没了（`entry_removed`）带名字，整个来源已经没了（`source_deleted`）带 **`title: null`**（那一刻已经无源可证）。账本从不留名字的副本，这是它的代价，写在这里而不是用旧值糊过去。
- `work_state` ∈ `linked | working | preview_ready | unknown | unavailable`（`unknown` 与 `linked` 是本项目候选新增）。
- `has_effective_save` 是**三值**：`true` / `false` / **`null`（未知）**。`null` 不是 `false`。
- 事件类型：`artifact.created / updated / preview_ready / preview_revoked / deleted` + 本项目候选的 `artifact.unlinked / artifact.revision_fixed`。

## 4 计数器与事件的区别（必须照这个口径读）

- **计数器**（`real_save_count`、`last_real_save_at`、`observed_writes`）记录**每一次被观察到的保存/来源写入**。
- **内容事件**（`artifact.updated`）记录**每一次被对账的变化**。若 A→B→A 三次保存在任何对账之前发生，中间字节已不存在，只会得到一条净变化事件；净内容与上次投影相同时，甚至只剩"证据从 none 变 observed"那一条。
- 因此：**要数保存次数看计数器，要看变化看事件。**"最终状态补齐了"不等于"每一次历史变化都已恢复"；保存写成功而钩子没写成的那一次，连计数器也没有。

## 5 watermark / complete 的读取语义

- `state` 与 `events` 的水位、行、未完成计数取自**同一个事务快照**，水位先取：返回的行只会**比水位新**（重放安全），不会比它旧。
- `complete: true` 只描述这份快照：**未截断**、**返回的每条都不欠对账**、且这次清扫**既没用尽预算也没读失败**。读取边界之后提交的保存不在这份快照里，由水位之后的增量事件送达。
- 另给 `scope_pending_reconcile`（整校未完成数，过滤查询时能看见被过滤掉的欠账）、`truncated`、`item_limit`、`events.sweep_incomplete`。
- **`complete:false` 时不得推断任何学生"未开始"。**

## 6 三类例子（照抄即可测）

```jsonc
// 1) 对账失败 / 还没追平：不要当完整
{ "complete": false, "pending_reconcile": 1, "scope_pending_reconcile": 1,
  "items": [{ "work_state": "working", "pending_reconcile": true, "unprojected_writes": 2 }] }

// 2) 未同步（来源动过、投影还没跟上）：edu 应显示上一次已知状态 + "同步中"
{ "complete": false, "items": [{ "save_evidence": "observed", "unprojected_writes": 1, "synced_at": 1790093700000 }] }

// 3) 未知（证据不足）：绝不是未开始
{ "complete": true, "items": [{ "work_state": "unknown", "has_effective_save": null,
    "save_evidence": "legacy_unknown", "save_evidence_reason": "history_before_observation" }] }
```

## 7 错误信封与验证向量

- 成功：`{ "schema_version": 1, …, "request_id": "…" }`；失败：`{ "error": { "code", "message", "retryable" }, "request_id" }`（**错误信封没有 `schema_version`**）。
- 常用码：`website_artifacts_disabled`(503)、`task_context_unavailable`(503)、`task_context_required`(401)、`task_context_invalid`(401)、`task_context_expired`(401)、`task_context_replayed`(409)、`task_context_instance_mismatch`(403)、`subject_mismatch`(403)、`link_exists`(409)、`project_already_linked`(409)、`project_empty`(409)、`cursor_invalid`(400)、`range_too_large`(400)、`school_not_provisioned`(404)、`eligibility_unavailable`(503)、`not_eligible`(403)、`review_session_consumed`(401)、`review_session_binding`(403)、`issuer_revoked`(403)、`owner_unavailable`(403)、`storage_unavailable`(503)、`rate_limited`(429)。
- 全表在 `backend/src/services/websiteArtifact/errors.js`（42 条，固定中文运营语，不回显请求字节）。
- **固定版本里被拒绝的资源**另有一组原因码（只出现在 manifest 的 `refused_assets`，不是 HTTP 错误）：`ownership_unproven`、`other_project_resource`、`remote_object_storage`、`symlink_refused`、`path_rejected`、`outside_upload_root`、`path_anchoring_unavailable`、`file_missing`、`unsupported_type`、`asset_too_large`、`asset_limit_reached`、`asset_freezing_unavailable`。edu 可以照这组向学生/老师解释"这张图为什么没进评阅版本"。

## 8 真实身份链缺口列表

**必须由 edu / Identity 实现的接口**（实践这边已经留好拒绝位，不会假装有）：

1. **C05 学生 SSO**：学生登录时带来可信的 school/班级/作业上下文。现状：本仓只有旧 `POST /api/auth/sso`。没有它，学生身份只能靠 `users.uuid` + 签名上下文对齐。
2. **教师身份链**：谁是这位老师、他此刻还带不带这个班。现状：实践只能验证"edu 签发了这一次打开"，浏览器绑定只防转发。
3. **edu 资格提供方**：`check({ reviewer, school, assignment, student })` 这类可被**每次访问**调用的判定。现状：未配置即拒绝；实验静态名册只在 dev/test。
4. **`contracts/integration-clients.md`**：服务凭据的正式形态。现状：本项目候选。
5. **学校/班级映射**：`user_groups` 目前没有 `edu_school_id`/`cohort` 列。

**确需产品决定（不是工程缺口）**：

- 固定版本、事件、评阅会话的**留存期限**（本包不自选、不自动清理）。
- 对象存储部署下是否允许固定版本从远端取字节（当前一律具名拒绝、不下载）。
- 课堂刷新节奏（实践只给有界清扫与测量，不自定轮询周期）。
- 编辑器是否要补一条"插入图片"的资源归属写入（当前学生粘贴的 URL 若来自已记录归属的功能即可冻结，否则具名拒绝）。

## 9 不在本包里的东西

真实教师实机验收、与真实 edu 的联调、生产实例键/域名证书/受限角色/迁移晋级/开关、正式 AOCI 对齐。以上都未执行、未授权，也不由本文代为承诺。
