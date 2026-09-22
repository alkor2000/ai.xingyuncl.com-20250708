# P09 网站作品源侧首包：关联、固定评阅版本、制作事实（候选，未发布）

派单 CTRL-20260922-PRACTICE-P09-WEBSITE-01，基线 `f737a89`（独立 worktree `codex/p09-website-artifact`，不带主树 `dev/export-group-chats.*` 的他人 WIP）。需求与四态口径见工作区 `docs/30`，契约候选见 `contracts/C06-20260922-网站作品与制作进度增补候选.md`（未冻结）。本文只陈述本包实现了什么、在什么条件下验证过、以及冻结前还缺什么；**不是发布/开启/迁移授权**，也没有改动任何共享 contracts 基线。

## 1 先核的接入事实（本地定向核对，未读生产）

| 事实 | 核对结果 | 影响 |
|---|---|---|
| C05 学生 SSO | **未实现**：本仓只有旧版 `POST /api/auth/sso`（uuid+timestamp+signature，直接返回 JWT），没有 `/exchange`+handoff/consume、没有 `org`（school/班级）载荷、没有 `cohort`、没有 `context(lesson_id/assignment_id)` 落库、没有 `sso_sessions` | 学生身份只能靠 `users.uuid`（`uuid_source='sso'` 由旧 SSO 建号时写入）。P09 因此**不从任何请求体取身份**，而要求「签名任务上下文里的 uuid == 当前会话账号的 uuid 且该账号 uuid_source='sso'」 |
| 学校映射 | **未部署**：`user_groups` 无 `edu_school_id`、无 `cohort` 列（与 P03 只读事实一致） | 本包不按学校组推断归属；`school_ref` 只来自签名上下文，并且只用于范围隔离（事件/状态查询按 instance+school 分区），不写入 users/user_groups |
| C06 事实拉取 | **未实现**：本仓没有任何 `/api/integrations/...` 端点 | 本包新建 `/api/integrations/edu/website-artifacts/*`，沿 C06 候选的"edu 主动拉取、实践不推送"方向 |
| HTML 编辑器 | 已有项目/页面 CRUD、发布开关；`/pages/:userId/:slug` 只查已发布页并返回当前编译 HTML，**与应用同源** | 旧公开预览行为原样不动；P09 的私有预览与固定版本一律走**独立隔离域**，且只由服务端会话判权 |
| 实例身份 | 两站分别 `xingyun-ai-platform-test` / 北大站为空（待 enrollment） | `P09_SOURCE_INSTANCE` 必填且与 `IDENTITY_DEPLOYMENT_INSTANCE_KEY`（若已登记）必须相等，不允许第二套实例命名 |

## 2 信任链（没有正式发行方时严格拒绝）

任务上下文 = `p09g.<base64url(payload)>.<base64url(HMAC-SHA256)>`，由 edu 侧发行方签发，浏览器只是搬运者：

- 载荷字段固定，未知字段拒绝；`schema_version=1`；`audience` 必须等于本实例名（**其他实例签的上下文一律 `task_context_instance_mismatch`**）；`purpose` ∈ `website_artifact_link | website_artifact_revision | website_artifact_review`；`issued_at` ±300s、`expires_at ≤ issued_at + purpose TTL`；`grant_id` 单次使用（在同一事务里消费，失败回滚后仍可用）。
- 学生类上下文带 `subject.uuid`+`cohort=student`；评阅类上下文带 `reviewer.ref`（落库前哈希，不保存 edu 教师本地 id）与 `artifact_ref`（可选 `revision_ref`）。
- **未配置发行方时**：端点全部存在并一律 `task_context_unavailable`(503)；这是当前部署的真实状态。实验发行方只在 `NODE_ENV=development|test` 且经 `P09_LAB` 注入时接受，production 直接拒绝该变量。
- **交付方式固定为 URL 片段**：edu 打开实践编辑器时用 `…/html-editor#p09_task=<token>`。片段不会发往任何服务器，因此不会进入访问日志、`Referer` 或代理记录；前端在应用启动、发出任何请求之前就把它取走并从地址栏清掉，只留在内存里（不写 localStorage）。**隔离验收中先用 query 参数实现，实跑日志里发现 token 随 `Referer` 进入了后端访问日志，据此改为片段**——这条是本包的实测发现，不是设计推演。
- edu 服务端读取另用静态服务凭据（`x-p09-client/key-id/timestamp/nonce/signature`，HMAC over 方法+路径+排序 query+体摘要），按 `actions` 与 `school_refs` 授权。`contracts/integration-clients.md` 尚不存在，这套凭据形态是**本项目候选**。

## 3 已实现的源侧能力

| 能力 | 端点 | 要点 |
|---|---|---|
| 能力探测 | `GET /api/p09/website-artifacts/capability` | 运行时关闭时 `available:false`，前端整块不渲染 |
| 关联/补关联 | `POST /links`（登录 + 任务上下文 + Idempotency-Key） | 学生选**本人**项目与入口页面；一次作业一个主作品、一个项目只归一个作业（两条唯一键）；空项目（无页面）`project_not_ready` |
| 撤销关联 | `POST /links/:id/unlink` | 立即吊销所有会话；已生成的固定版本保留 |
| 固定评阅版本 | `POST /links/:id/revisions`（学生）/ `POST /integrations/.../revisions`（edu 提交事务，带 `website_artifact_revision` 上下文） | 按 Idempotency-Key 幂等；快照含入口页 `index.html` + 项目内全部页面；**外部依赖单列未冻结**（`external_dependencies`，`frozen_scope: pages_only`） |
| 当前状态 | `GET /integrations/.../state?school_ref=` | 每条含 `work_state/has_effective_save/preview_available/saved_at/revisions[]`，整体含 `complete` 与 `watermark`（与增量读同一水位交接）、`synced_at` |
| 增量事件 | `GET /integrations/.../events?cursor=&limit=` | 事件不可变；`event_seq` 由**同事务内加锁的计数器**发放 = 提交顺序，无空洞、无迟到可见；游标绑定 scope，非法即 `cursor_invalid` |
| 私有评阅 | `POST /integrations/.../review-sessions` | 短时（10 分钟）、单受众、单目标；一次性 handoff → 隔离域 HttpOnly Cookie；每次访问重核关联/版本/来源状态 |
| 隔离预览 | 独立监听器 `P09_PREVIEW_ORIGIN` | Host 不符即 404；`CSP: sandbox allow-scripts`（无 `allow-same-origin`，文档为不透明来源，读不到本域 Cookie/存储）、`frame-ancestors` 显式配置、`nosniff`、`no-store` |

**有效保存的判据**（候选参数，非用户已定口径）：某个页面正文 ≥64 字节，**且**该页面在创建之后至少被保存过一次（`updated_at − created_at ≥ 1s`）。第二个条件来自实测：打开一个没有页面的项目时，网页编辑器会**自动创建一个平台模板空白页**（并扣积分），它有几百字节正文却不是学生的工作；只看字节数会把「打开过默认项目」误判成制作中。因此源侧对该页报 `has_effective_save=false`，`saved_at=null`。更干净的做法是编辑器直接给出"学生保存过"的一等信号，已列入缺口。

**状态口径**：`linked`（已关联、尚无有效保存）→ `working`（有有效保存）→ `preview_ready`（教师可打开）→ `unavailable`（撤销/删除）。`未开始` 与 `已提交` 都**不由实践判定**：前者由 edu 用名单 + 完整查询结果推导（`has_effective_save=false` 即未开始），后者只来自 edu 自己的提交事务。事件类型：`artifact.created/updated/preview_ready/preview_revoked/deleted` 沿候选，另加 `artifact.unlinked` 与 `artifact.revision_fixed` 两个**本项目候选差异**（edu 必须能区分"学生撤销关联"与"预览撤回"，并知道有新的固定版本）。

事件载荷只含：作品引用（instance/project_ref/artifact_ref/entry_ref/title）、任务上下文引用、进度（含页数与来源保存时间）、`public_url`（未发布为 null）、固定版本摘要。**不含**正文、提示词、会话内容、私密 URL、访问凭据、教师身份。

## 4 隔离验收（真实后端 + 真实前端 + 自有 MySQL + 浏览器）

`python3 dev/p09-lab/check.py`（证据 `storage/private/p09-validation/run-*/result.json` 与截图）：两套实例（各自数据库、实例名、端口）+ 一次性 `mysql:8.0`（本地 schema 结构前像 + knex 执行账本候选迁移 + 受限账本角色）+ 真实 `node src/server.js` + 真实前端 Vite + Playwright（1280/360/390/430）。真实与合成分列见 `result.json` 的 `real`/`synthetic`/`not_covered`。

覆盖（13 项，逐条写在 `result.json` 的 `checks`）：默认关闭（两面都 `website_artifacts_disabled`、账本零行）、本人项目关联（请求体只有项目与入口页，任务上下文只在请求头）、edu 当前状态（含 complete/watermark、跨校 404、无正文）、私有预览（隔离主机名、沙箱 CSP、学生脚本读不到本域 Cookie、转发链接失效）、双击生成评阅版本只产生一版、固定版本在改稿后仍是旧字节、旧项目补关联到另一作业且同一作业第二个作品被拒、从未打开的空项目不能关联而编辑器自动建的空白页关联后仍 `has_effective_save=false`、他人项目(404)/非 SSO 账号(403)/伪造签名(401)/他实例上下文(403) 四种拒绝、两实例同号项目引用不相撞、增量游标续读与重试逐字一致且序号单调、撤销关联与源删除立刻停止访问并投影为 `unavailable`/`deleted`、一个学生多页多版本两作业仍只算一行。

桌面 1280 与 360/390/430 各有截图（14 张）；手机宽度下编辑器把项目栏折叠，面板随项目栏出现，操作与桌面一致。

## 5 剩余缺口（冻结前必须由两端共同决定，本包不代决）

1. **C05 未实现**：没有可信的 school/班级/作业上下文随学生登录进入，本包用独立签名上下文顶上；正式接入需 C05 落地或明确另一条学生级通道。
2. `contracts/integration-clients.md` 缺失：服务凭据形态是本项目候选，需要与 C06 基线一起评审。
3. 事件词表差异（`artifact.unlinked`、`artifact.revision_fixed`）与 `work_state=linked` 需要 edu 确认后才能写回共同契约。
4. 保留期：固定版本、事件、会话记录的留存与删除规则**未定**（候选代码只做"撤销不删除已固定版本"），须由作业留存规则决定；本包不自选期限。
5. 快照范围：只冻结页面字节；`/uploads` 资源与外部 URL 只登记不冻结，是否随快照复制需产品与存储决定。
5b. 有效保存的判据依赖 `html_pages.created_at/updated_at`；编辑器自动建空白页的行为（打开无页面项目即创建并扣积分）是平台既有事实，本包只做不误判，未改动它。
6. 刷新负载：轮询秒数、最大延迟与重试预算未定；本包只提供 `state`/`events` 与水位，不含调度。
7. 生产条件：实例键（北大站为空）、隔离预览域名与证书、受限账本角色与迁移晋级、开关、`frame-ancestors` 名单均未执行、未授权。
8. 未做：真实教师实机验收、与真实 edu 的联调、多实例生产部署形态。
9. AOCI：本包在独立 worktree 开发，本会话的认知服务绑定主工作副本，Volumes v1 只能经 MCP 写入，因此 12 条新增 + 7 条受影响条目**尚未写入正式索引**；条目正文与逐文件 SHA 已按字典预先创作在 `p09-aoci-entries-candidate.md`，合入主副本后一次 `aoci_maintain`→`aoci_update_entry` 即可对齐。主副本自身仍是对齐状态（本包未改它）。
