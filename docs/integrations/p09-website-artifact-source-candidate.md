# P09 网站作品源侧：关联、固定评阅版本、制作事实、私有评阅（候选，未发布）

派单 CTRL-20260922-PRACTICE-P09-WEBSITE-01 与接续单 CTRL-20260922-PRACTICE-P09-RELIABILITY-01，基线 `f737a89` → 首包 `9969b37` → 本次接续（独立 worktree `codex/p09-website-artifact`，不带主树 `dev/export-group-chats.*` 的他人 WIP）。需求与四态口径见工作区 `docs/30`，契约候选见 `contracts/C06-20260922-网站作品与制作进度增补候选.md`（未冻结）。本文只陈述实现了什么、在什么条件下验证过、以及冻结前还缺什么；**不是发布/开启/迁移授权**，也没有改动任何共享 contracts 基线。

## 1 先核的接入事实（本地定向核对，未读生产）

| 事实 | 核对结果 | 影响 |
|---|---|---|
| C05 学生 SSO | **未实现**：本仓只有旧版 `POST /api/auth/sso`（uuid+timestamp+signature，直接返回 JWT），没有 `/exchange`+handoff/consume、没有 `org`（school/班级）载荷、没有 `cohort`、没有 `context(lesson_id/assignment_id)` 落库、没有 `sso_sessions` | 学生身份只能靠 `users.uuid`（`uuid_source='sso'` 由旧 SSO 建号时写入）。P09 因此**不从任何请求体取身份**，而要求「签名任务上下文里的 uuid == 当前会话账号的 uuid 且该账号 uuid_source='sso'」。**本包用的独立签名上下文不是 C05**，见 §8 缺口 1 |
| 学校映射 | **未部署**：`user_groups` 无 `edu_school_id`、无 `cohort` 列（与 P03 只读事实一致） | 本包不按学校组推断归属；`school_ref` 只来自签名上下文，并且只用于范围隔离（事件/状态查询按 instance+school 分区），不写入 users/user_groups |
| C06 事实拉取 | **未实现**：本仓没有任何 `/api/integrations/...` 端点 | 本包新建 `/api/integrations/edu/website-artifacts/*`，沿 C06 候选的"edu 主动拉取、实践不推送"方向 |
| HTML 编辑器 | 已有项目/页面 CRUD、发布开关；`/pages/:userId/:slug` 只查已发布页并返回当前编译 HTML，**与应用同源** | 旧公开预览行为原样不动；P09 的私有预览与固定版本一律走**独立隔离域**，且只由服务端会话判权 |
| **学生保存的服务端信号** | 编辑器只有一条会写入学生正文的路径：`PUT /api/html-editor/pages/:id` 带正文字段（`handleSavePage`，按 `html_editor.credits_per_update` 扣积分）。**新建页面（`POST /pages`）一律用空白模板**——学生点"新建页面"和编辑器打开无页面项目时自动补建，正文都是 `BLANK_HTML`；改名走同一个 PUT 但只带 `title`（`isOnlyUpdatingTitle`）；`html_pages.version` 由 `HtmlPage.update` 每次 +1 | 「学生真的保存过」= 该 PUT 带正文且非纯改名，由控制器按**本次请求实际写了什么**判定，不信任请求体里的任何声明。创建（含自动模板）永远不算保存 |
| **上传归属模型** | 三个模型能证明归属：`files`（对话上传，`user_id` + `file_path`，绝对路径，`status='ready'`）、`user_files`（云盘，`user_id` + `oss_key`，本地模式下字节落在 `storage/uploads/<oss_key>`，OSS 模式下字节在远端）、`html_resources`（编辑器自带资源表，`user_id`+`project_id`+`storage_path`/`storage_type`，**本仓无写入路径，线上为空表**）。`/uploads` 静态目录本身**不证明任何归属** | 固定版本只复制"某一行能证明属于本人"的文件；只按路径存在**一律不复制**，具名拒绝 `ownership_unproven`。三种模型的真实取值形态已核（生产 `files.file_path` 是 `/var/www/.../storage/uploads/…` 绝对路径，`user_files.oss_key` 是 `users/<id>/…` 相对键） |
| 实例身份 | 两站分别 `xingyun-ai-platform-test` / 北大站为空（待 enrollment） | `P09_SOURCE_INSTANCE` 必填且与 `IDENTITY_DEPLOYMENT_INSTANCE_KEY`（若已登记）必须相等，不允许第二套实例命名 |

## 2 信任链（没有正式提供方时一律严格拒绝）

任务上下文 = `p09g.<base64url(payload)>.<base64url(HMAC-SHA256)>`，由 edu 侧发行方签发，浏览器只是搬运者：

- 载荷字段固定，未知字段拒绝；`schema_version=1`；`audience` 必须等于本实例名（**其他实例签的上下文一律 `task_context_instance_mismatch`**）；`purpose` ∈ `website_artifact_link | website_artifact_revision | website_artifact_review`；`issued_at` ±300s、`expires_at ≤ issued_at + purpose TTL`；`grant_id` 单次使用，**幂等键按 `issuer:key_id` 分域**（两个发行方/两所学校的 id 不可能互相烧掉）。
- 学生类上下文带 `subject.uuid`+`cohort=student`；评阅类上下文带 `reviewer.ref`（落库前哈希，不保存 edu 教师本地 id）与 `artifact_ref`（可选 `revision_ref`）。
- **未配置发行方时**：端点全部存在并一律 `task_context_unavailable`(503)；这是当前部署的真实状态。实验发行方只在 `NODE_ENV=development|test` 且经 `P09_LAB` 注入时接受，production 直接拒绝该变量。
- **未配置评阅资格提供方时**：`POST /review-sessions` 一律 `eligibility_unavailable`(503)，不会先发一张票再说。实验提供方（固定名册）同样只在 development/test 经 `P09_LAB` 注入。**一张已消费的票不代表持续资格**：每一个字节都会重问一次（见 §6）。
- **交付方式固定为 URL 片段**：edu 打开实践编辑器时用 `…/html-editor#p09_task=<token>`；评阅入口是 `…/p09/preview/open#h=<handoff>`。片段不会发往任何服务器，因此不会进入访问日志、`Referer` 或代理记录。**隔离验收中先用 query 参数实现，实跑日志里发现 token 随 `Referer` 进入了后端访问日志，据此改为片段**——这条是实测发现，不是设计推演。
- edu 服务端读取另用静态服务凭据（`x-p09-client/key-id/timestamp/nonce/signature`，HMAC over 方法+路径+排序 query+体摘要），按 `actions` 与 `school_refs` 授权。`contracts/integration-clients.md` 尚不存在，这套凭据形态是**本项目候选**。

## 2b 协议向量（可复算，供 edu 对齐实现）

两条向量都由本仓代码真实算出，签名密钥只是向量用的假值：

**任务上下文（`website_artifact_link`）** — `secret = p09-vector-secret-0123456789abcdef0123456789abcdef`，载荷按下列顺序序列化（签名覆盖的是被解析的那串字节，不做任何再规范化）：

```json
{"schema_version":1,"issuer":"edu","key_id":"k1","grant_id":"6f1a7a3e-0e6d-4a70-9d6a-2b7f5a0c1e33","audience":"practice-vector","purpose":"website_artifact_link","school_ref":"school-1","assignment_ref":"assign-1","lesson_ref":null,"subject":{"uuid":"edu-uuid-0001","cohort":"student"},"issued_at":1790000000,"expires_at":1790000300}
```

```
p09g.eyJzY2hlbWFfdmVyc2lvbiI6MSwiaXNzdWVyIjoiZWR1Iiwia2V5X2lkIjoiazEiLCJncmFudF9pZCI6IjZmMWE3YTNlLTBlNmQtNGE3MC05ZDZhLTJiN2Y1YTBjMWUzMyIsImF1ZGllbmNlIjoicHJhY3RpY2UtdmVjdG9yIiwicHVycG9zZSI6IndlYnNpdGVfYXJ0aWZhY3RfbGluayIsInNjaG9vbF9yZWYiOiJzY2hvb2wtMSIsImFzc2lnbm1lbnRfcmVmIjoiYXNzaWduLTEiLCJsZXNzb25fcmVmIjpudWxsLCJzdWJqZWN0Ijp7InV1aWQiOiJlZHUtdXVpZC0wMDAxIiwiY29ob3J0Ijoic3R1ZGVudCJ9LCJpc3N1ZWRfYXQiOjE3OTAwMDAwMDAsImV4cGlyZXNfYXQiOjE3OTAwMDAzMDB9.rYYeapjRlkVMgBqGfI8vKSiZ41Q7_aEfjMbrg9FAIDE
```

**服务凭据签名（`GET /state?school_ref=school-1`）** — `secret = p09-vector-client-0123456789abcdef0123456789ab`，`timestamp=1790000000`，`nonce=a1b2c3d4e5f60718293a4b5c6d7e8f90`。规范串是方法、路径、**按名排序**的 query、体摘要（GET 为空串的 sha256），用 `\n` 连接：

```
GET\n/api/integrations/edu/website-artifacts/state\nschool_ref=school-1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

`signature = sha256(secret + "\n" + timestamp + "\n" + nonce + "\n" + sha256(规范串))` = `d39709ccecbaa53454ab1fe3d04bfc04304215e60cf6eacc69a37f5591b190c7`。POST 的体摘要是 `JSON.stringify(已解析的体)` 的 sha256（无空格、按插入顺序）。

## 3 制作事实：只从观察到的保存来

三值，永不猜：

| `save_evidence` | `work_state` | `has_effective_save` | 何时出现 |
|---|---|---|---|
| `observed` | `working` / `preview_ready` | `true` | 编辑器的保存路径带正文写成功，账本在**同一次请求里**记下 `real_save_count+1`、`last_real_save_at` |
| `none` | `linked` | `false` | 项目里每一页都从未被写过（`html_pages.version = 1`，且 `updated_at` 与 `created_at` 相差不到一秒）。空默认项目、编辑器自动建的空白页都落在这里，edu 据此显示未开始 |
| `legacy_unknown` | `unknown` | `null` | 关联时就发现行被写过、但 P09 没看见那次写（`history_before_observation`），或正文在没有任何观察的情况下变了（`change_without_observed_save`）。**答未知并给原因，绝不猜未开始，也不冒称制作中** |

- 判据不再有任何字节数或时间差：31 字节的合法短页面、创建后一秒内保存都算数；纯改名、发布开关、删页都不算（它们会经过同一个钩子，但不带正文）。
- `real_save_count` / `last_real_save_at` / `change_no` 随状态和事件一起给 edu，`saved_at` 只在 `observed` 时有值；来源行的最后改动时间另给 `source_touched_at`（**保存时间与同步时间分离**：事件的 `occurred_at` 是来源时间，`recorded_at` 是账本提交时间，`synced_at` 是投影时间）。
- 候选字段与迁移只在本项目候选目录（`backend/migrations-candidates/p09/`）与本项目文档里；**没有改动任何共享 contracts 基线**。

## 4 关联约束：一项目一当前作业

- 两个 STORED 生成列 + 唯一键：`one_active_work(source_instance|assignment_ref|owner_user_id)` 与 `one_active_project(source_instance|project_id)`，都只在 `state='active'` 时非空。**首包的 `one_project(source_instance,assignment_ref,project_id)` 允许同一个项目同时应付两个作业，这是本次修掉的缺口。**
- 关联前先按项目查当前活跃关联（`FOR UPDATE`），并发下由唯一键兜底；撤销后可以显式重新关联到另一个作业，**历史固定版本原样保留**（验收里逐字节比对过）。
- 跨校同号作业互不影响（`school_ref` 只作用域隔离），幂等键按发行方分域，验收里两所学校用同一个 `assign-1` 各自成立。

## 5 固定版本：能完整重开

- 范围 `frozen_scope: pages_and_owned_local_assets`：项目内**全部页面** + **能证明归属于本人**的本地资源（图片、CSS、JS、字体、文本，单文件 ≤2 MiB、单版本 ≤40 个、整包 ≤12 MiB）。
- 每个冻结资源在 manifest 里记 `path / reference / byte_length / media_type / sha256 / owned_by`（哪个模型证明的归属），与不可变版本绑定；页面文件平铺（入口 `index.html`，其余 `p-<slug>-<id>.html`），**项目内页面链接与 `/uploads/...` 引用被改写成版本内路径**，所以改稿、删页、删原图之后旧版本仍然整份打开（多页导航、图片、样式表都验过）。
- 拒绝一律**具名**进 manifest 的 `refused_assets`：`ownership_unproven`（只按路径存在，没有任何行能证明是本人的）、`other_project_resource`、`remote_object_storage`（字节在对象存储，不下载）、`symlink_refused`、`path_rejected`、`outside_upload_root`、`file_missing`、`unsupported_type`、`asset_too_large`、`asset_limit_reached`。
- 外部依赖（http(s)/协议相对 URL）只登记在 `external_dependencies`，**明确未冻结**；任何 URL 都不会被拉取。读取只在上传根内、不跟随符号链接（`O_NOFOLLOW`）、realpath 包含性校验、拒绝 `..` 与 NUL。**没有 SSRF 面：整条路径里没有出网请求。**
- 没有留存期决定，所以**不自动清理任何证据**：撤销关联不删已固定版本，本包也不自选删除周期（§8 缺口 4）。

## 6 增量、补齐与私有评阅

**变化身份**：`change_no` 是每个作品自己的单调变化号，事件事实 id = `updated:<change_no>:<内容摘要>`。同一次变化重复上报还是同一条事实（重试不重复），**A→B→A 是三次变化三条事实**（首包按内容永久去重，回到旧内容会丢事件，这是本次修掉的缺口）。

**可恢复的投影**：编辑器保存的那次请求里先**等待写入**耐久标记（`sync_pending_at`，正文保存同时记 `real_save_count`），之后才异步对账。所以：进程崩溃、账本短断、重启都只会留下"待对账"，不会留下永远陈旧的投影。三层补齐——(1) 每次 edu 读 `state`/`events` 先做一次**有界**清扫，(2) 后台定时清扫（`P09_SYNC_INTERVAL_MS`，默认 60s，下限 5s），(3) 标记本身丢了也能自愈：最久未核对的活跃作品会被重新与来源比对（`P09_SYNC_VERIFY_MS`，默认 5 分钟）。对账失败保留标记并计数，不吞错。
`state` 只有在**没被截断且没有待对账**时才 `complete:true`，另给 `pending_reconcile` 与 `item_limit`；`events` 同样带 `pending_reconcile`。**负载只给测量、不自定课堂轮询周期**：`service.syncStatus()` 报 `sweeps/reconciled/events/failures/last_duration_ms/max_duration_ms` 与当前预算（单次 ≤25 个作品、≤400ms、自愈批 ≤5）。

**私有评阅的受众**：
- 会话记 `audience_kind`（reviewer/owner）、受众哈希、`issuer_key`，一次性 handoff **60 秒内**必须兑换，兑换后会话 **10 分钟**；会话寿命与 grant 到期**无关**（grant 只授权"这一次打开"，不是租约，不能续期，过期只能由 edu 重新签发）。
- 兑换是**条件更新**：先到者赢，handoff 立刻消失；兑换时把会话**绑定到兑换它的浏览器**（UA+Accept-Language 指纹哈希），之后每个字节都要求同一浏览器。**这是防转发/防盗用 Cookie 的措施，不是身份认证**（同一台机器上的同一浏览器仍然可以被本人之外的人使用——见 §7 缺口 1）。
- 每个字节都重核：会话（未撤销/未过期/绑定一致）、关联状态、**作品所有者账号仍可用**（停用即拒 `owner_unavailable` 并吊销该学生全部会话）、**签发方密钥仍在配置里**（撤下即 `issuer_revoked`）、**评阅资格提供方仍然说 yes**（`not_eligible`）。**固定版本的静态字节走同一条检查，不存在"快照绕过资格"**。
- 学生本人的预览不问 edu：他的资格就是自己的登录会话 + 账号状态 + 关联归属（`eligibility: owner_session`）。
- 隔离域：独立监听器、Host 门、`CSP: sandbox allow-scripts`（无 `allow-same-origin`，文档是不透明来源，读不到本域 Cookie/存储）、`frame-ancestors` 显式配置、`nosniff`、`no-store`。**CSP 源列表写隔离域的真名而不是 `'self'`**——不透明来源下 `'self'` 谁都不匹配，会把作品自己的图片和样式表也挡掉（实测发现）。隔离域用 HTTPS 时 Cookie 是 `SameSite=None; Secure`，这也是不透明来源文档能把 Cookie 带给自己子资源的唯一方式。

## 7 隔离验收（真实后端 + 真实前端 + 自有 MySQL + 四宽度浏览器 + HTTPS 隔离域）

`python3 dev/p09-lab/check.py`。两套实例（各自数据库、实例名、端口；**实例 B 故意不配评阅资格提供方**）+ 一次性 `mysql:8.0`（本地 schema 结构前像 + knex 执行账本候选迁移 + 受限账本角色）+ 真实 `node src/server.js` + 真实前端 Vite + Playwright（1280/360/390/430）+ 自签证书的 HTTPS 隔离预览域。真实与合成分列见 `result.json` 的 `real`/`synthetic`/`not_covered`；**失败运行的日志与截图一并保留在证据目录**（本次共三次失败运行，见进度文档）。运行编号与 `result.json` 摘要写在工作区进度文档里。

首包 13 条之外新增覆盖：真实 UI 点"保存"之后才 `制作中`｜改名不算保存｜31 字节短页面算保存｜旧项目报未知及原因｜A→B→A 三条事实、重试零条｜崩溃后重启按耐久标记补齐｜标记丢失由自愈通道补齐｜四路并发保存序号不倒退且投影与最后一次变化一致｜全量与增量水位交接、`limit>500` 拒绝、分页续读｜固定版本冻结本人图片与样式表并改写链接，多页导航与资源在改稿+删原图后仍工作，证明不了归属的文件具名拒绝且在评阅里是可见的缺图｜无资格提供方的实例一律拒绝｜非本作业教师被拒｜一次性入口被先用者烧掉｜Cookie 换浏览器即拒、同浏览器仍可用｜撤下发行方密钥与停用学生账号都立即停字节。

单元测试：后端 P09 43 项（28 服务 + 5 路由含真实 socket 与预览域 + 10 运行时/上下文/凭据）、前端面板 7 项。

## 8 剩余缺口（冻结前必须由两端共同决定，本包不代决）

1. **C05 未实现，独立签名上下文不是 C05**：没有可信的 school/班级/作业上下文随学生登录进入，本包用独立签名上下文顶上；教师侧同样没有真实身份链——浏览器绑定只防转发，不证明"这个人是那位老师"。正式接入需 C05 落地或明确另一条学生级/教师级通道。
2. `contracts/integration-clients.md` 缺失：服务凭据形态是本项目候选，需要与 C06 基线一起评审。
3. 词表差异需 edu 确认后才能写回共同契约：事件 `artifact.unlinked`、`artifact.revision_fixed`；状态 `linked`、`unknown`；字段 `save_evidence/save_evidence_reason/real_save_count/change_no/pending_reconcile/source_touched_at`；`has_effective_save` 现在是三值（true/false/**null=未知**）。
4. 留存期未定：固定版本、事件、会话记录的留存与删除规则由作业留存规则决定，本包不自选期限、不自动清理。
5. `html_resources` 表在本仓**没有写入路径**（线上为空），编辑器目前把图片放在别处；因此"编辑器里插入的图片"能否被证明归属，取决于它实际写进了哪个模型。**证明不了就具名拒绝**，需要产品决定是否给编辑器补一条资源归属写入。
6. 对象存储部署：`user_files` 在 OSS 模式下字节在远端，本包只具名拒绝、不下载；是否允许固定版本从对象存储取字节须由存储与合规决定。
7. 刷新负载：轮询秒数、最大延迟与重试预算未定；本包给测量与有界预算，不含调度。
8. 生产条件：实例键（北大站为空）、隔离预览域名与证书、受限账本角色与迁移晋级、开关、`frame-ancestors` 名单均未执行、未授权。
9. 未做：真实教师实机验收、与真实 edu 的联调（含其资格端点）、多实例生产部署形态。
10. AOCI：本包在独立 worktree 开发，本会话的认知服务绑定主工作副本，Volumes v1 只能经 MCP 写入，因此新增/受影响条目**尚未写入正式索引**；条目正文与逐文件 SHA 见 `p09-aoci-entries-candidate.md`，合入主副本后一次 `aoci_maintain`→`aoci_update_entry` 即可对齐。**本包不声称已与正式 AOCI 对齐。**

## 9 edu 侧消费输入（E09 用）

两个只读端点 + 两个动作端点，全部要静态服务凭据签名；只读端点另按 `school_ref` 授权。

- `GET /state?school_ref=&assignment_ref=&student_uuid=` → `{items[], complete, pending_reconcile, item_limit, watermark, synced_at}`。`complete=false` 意味着**被截断或仍有待对账**，此时不得据此推断任何学生"未开始"。每个 item：`artifact_ref/project_ref/entry_ref/source_instance/assignment_ref/lesson_ref/student_uuid/title/state/work_state/save_evidence/save_evidence_reason/has_effective_save(三值)/real_save_count/last_real_save_at/change_no/preview_available/saved_at/source_touched_at/synced_at/pending_reconcile/linked_at/revoked_at/revoked_reason/revisions[]`。
- `GET /events?school_ref=&cursor=&limit=` → `{facts[], next_cursor, cursor, watermark, pending_reconcile, synced_at}`；`limit ≤ 500`，超过即 `range_too_large`。`next_cursor` 为空表示追平；`cursor` 可以原样存下来续读。事实不可变：同一 `fact_id` 永远同一个 `event_sequence`，重试逐字一致。**全量→增量交接**：拿 `state.watermark` 之后用最后一页的 `cursor` 续读，不会漏也不会重。
- `POST /revisions`（`artifact_ref` + `website_artifact_revision` 上下文 + `Idempotency-Key`）→ 固定一版并返回 manifest 摘要；同键重放返回同一版。
- `POST /review-sessions`（`website_artifact_review` 上下文）→ `{session_id, open_url, expires_at, handoff_expires_at, eligibility, target, artifact_ref}`；`open_url` 的 handoff 在**片段**里，必须整串交给教师浏览器打开，**不能落进服务端日志、消息记录或转发**。
- edu 必须自己保留的判断：`未开始`（用名单 + 完整查询结果推导，`save_evidence=none` 才是未开始，`unknown` 不是）、`已提交`（只来自 edu 自己的提交事务，实践永不记录）。

错误信封固定为 `{error:{code,message,retryable}, request_id}`，无 `schema_version`；成功信封带 `schema_version` 与 `request_id`。本包用到的码见 `backend/src/services/websiteArtifact/errors.js`（42 个，全部是固定中文运营语，不回显请求字节）。
