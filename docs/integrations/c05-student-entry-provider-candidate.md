# C05 学生一次性登录：实践平台提供方候选

分支 `codex/c05-student-entry`（从 `faa9d2c` 出发），**默认关闭**。开关未开时两个端点只返回固定拒绝，
不读密钥、不碰 Redis、不碰数据库；登录页也不会出现任何入口。本文是给 edu 侧与运维看的固定材料：
请求/响应/签名向量、错误码、账号与学校映射、权限需求、与契约的差异、生产缺口。

契约原文：`pkuailab-ws/contracts/C05-student-sso.md`。本候选**没有改契约**，差异在第 7 节逐条列出。

## 1 端点

| 方法 | 路径 | 谁调用 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/sso/exchange` | edu 服务端（S2S） | 签名断言换一次性 handoff |
| POST | `/api/auth/sso/consume` | 学生浏览器 | 花掉 handoff，拿本平台普通会话 |
| GET | `/api/auth/sso/capability` | 本平台登录页 | 入口开没开、launch 地址是什么 |
| GET | `/api/auth/sso/context` | 已登录的学生会话 | 本次会话的作业线索与所属学校/组（需 Bearer） |

历史 `POST /api/auth/sso`（旧自定义 SSO）**完全不动**：本路由挂在 `/api/auth/sso` 上但只声明这三个子
路径，中间件按路由挂载而不是 `router.use`，旧端点的响应体与响应头逐字节不变。挂载顺序必须在
`app.use('/api/auth', authRoutes)` **之前**——`routes/auth.js` 在公开路由之后有一个 `router.use(authenticate)`，
任何未匹配的 `/api/auth/*` 都会先被它拦成 401。

## 2 固定签名向量（edu 可直接自检）

签名 = `HMAC-SHA256(secret, timestamp + "\n" + nonce + "\n" + sha256(body 原始字节))`，hex 小写。
**签的是实际被解析的那串字节**，所以不存在"规范化后与验证对象不一致"的空隙：服务端用 `express.raw`
在全局 JSON 解析器之前把这条路径读成 Buffer。

```
secret     c05-example-secret-do-not-use-in-any-deployment
timestamp  1757750000
nonce      Zm9vYmFyMTIzNDU2Nzg5MA
body       {"schema_version":1,"platform_key":"edu","subject":{"uuid":"9f1c0a2e-7b41-4d55-8a10-0b3c2d4e5f60","cohort":"student","status":"active"},"profile":{"display_name":"王小明","username_hint":"20230101"},"org":{"school_ref":"123","grade_ref":"7","grade_name":"初一","class_ref":"701","class_name":"1班"},"landing":{"entry":"chat"},"context":{"lesson_id":"456","assignment_id":null},"issued_at":1757750000,"expires_at":1757750300}
body 字节   430（UTF-8，无 BOM，无尾随换行）
sha256(body) a39bee8439bc5dde0390f24cc4ac1fff5a2dcfc5e4dde7b70e2b4978957817f5
X-Edu-Signature ac19209b77c213fc17f649bd2276e3aba77c4f389d75fb5f71f28223a821ae3c
```

对同一份断言，`users.username` = `s_9f1c0a2e7b414d55`（契约 §4：`"s_" + uuid 去连字符前 16 位）。

请求头：`X-Edu-Timestamp`（Unix 秒）、`X-Edu-Nonce`（base64url，16–128 字符）、`X-Edu-Signature`（hex）。
请求体上限 16KB；超出、空体、非 JSON、含未知字段一律 `invalid_request`。

## 3 响应

exchange 成功（200，`Cache-Control: no-store`）：

```json
{ "schema_version": 1, "handoff": "<43 字符 base64url>", "expires_at": 1757750360000,
  "landing": { "entry": "ai-practice.chat" }, "account": { "created": true }, "request_id": "..." }
```

`handoff` 明文只在这里出现一次；Redis 里只存 `sha256(handoff)`，读存储拿不到能兑换的东西。
响应体里**没有** uuid、没有 JWT、没有姓名（实测断言：`carries_uuid=false, carries_token=false`）。

consume 成功（200，`Cache-Control: no-store`）：平台普通登录载荷 `{ user, permissions, siteConfig,
accessToken, expiresIn }`，外加 `landing.entry` 与 `context`。**本入口从不签发 refresh**（见 §7.1），
access 的有效期固定按契约 §5 的 12h 上限签发（不改其它登录方式的期限）。

兑换不是“把 60 秒前的判断照抄一遍”：票据钉住了账号、平台、部署实例、学校与当时映射到的组，
consume 在**一个事务里**重读现态并逐条核对，然后在同一个事务里签发令牌、写入会话上下文行——
要么会话连同上下文一起存在，要么什么都没有。中途任何一条不成立都是具名拒绝且不发会话：

| 60 秒内发生的事 | 拒绝 |
| --- | --- |
| 账号被提为管理员/被改成非 SSO | `subject_not_student` (403) |
| 账号被停用 | `subject_disabled` (403) |
| 账号已过期（与 authMiddleware 同一判定） | `subject_expired` (403) |
| 学校组被停用，或映射被撤下 | `school_not_provisioned` (409) |
| 映射改指别的组，或学生已被挪到别的组 | `session_scope_changed` (409) |
| 票据来自别的部署实例或别的 platform_key | `session_scope_changed` (409) |

**一次性票据不会因为被拒绝而复活**：getDel 已经花掉它，学生要从作业页重新进入（此时账号已存在，
不会重复发放额度）。

GET `/api/auth/sso/context`（Bearer，200）：
```json
{ "schema_version": 1, "context": { "lesson_id": "456", "assignment_id": "77" },
  "scope": { "school_ref": "123", "group_id": 7, "platform_key": "edu", "instance_key": null },
  "issued_at": "...", "expires_at": "...", "is_task_association": false, "request_id": "..." }
```
按令牌里的 `jti` + 账号读**自己这一次**会话：刷新页面、新开标签页读到的是同一份；别的账号读到的只会是
它自己那一份（没有就 404 `context_unavailable`）；退出登录后令牌进黑名单，`authenticate` 直接 401。
`is_task_association: false` 是写在载荷里的话：**这是“从哪节课来”，不是任何关联或提交**。

失败一律：`{ "error": { "code": "...", "message": "中文一句", "retryable": bool }, "request_id": "..." }`。

## 4 错误码（契约 §6 + 本部署自有拒绝）

| code | HTTP | 含义 |
| --- | --- | --- |
| `invalid_signature` | 401 | 签名不匹配（常量时间比对，不区分是哪一半不对） |
| `stale_timestamp` | 401 | 时间戳超窗，或 `expires_at` 已过 |
| `replay_detected` | 409 | nonce 已用过（签名校验通过之后才写 nonce） |
| `platform_disabled` | 403 | `platform_key` 不是本部署配置的那一个 |
| `ip_not_allowed` | 403 | 来源地址不在白名单（在签名校验之前，连 nonce 都不会花） |
| `subject_disabled` | 403 | 断言里不是 active，或本平台账号已停用 |
| `cohort_not_supported` | 400 | 不是 `student`（教师走 C12） |
| `school_not_provisioned` | 409 | school_ref 没映射到启用中的学生组 |
| `entry_not_allowed` | 400 | 落地页不在白名单 |
| `rate_limited` | 429 | 同一 uuid 每分钟超过 10 次（契约 §3.7） |
| `storage_unavailable` | 503 | Redis 不可用，或数据库锁竞争重试后仍未通过（retryable） |
| `handoff_invalid` | 401 | handoff 形状不对、不存在、已花、已过期 |
| `invalid_request` | 400 | 请求格式/字段不合法 |
| `student_entry_disabled` | 503 | 本部署没开这个入口 |
| `config_invalid` | 503 | 配置不完整或自相矛盾（例如要按库映射却没有候选列） |
| `issuance_policy_missing` | 503 | D-13 发放参数未定：**首登**具名关闭（老学生不受影响） |
| `group_change_refused` | 409 | 本部署把换组设成 `refuse` |
| `subject_not_student` | 403 | 该 uuid 已属于教师/管理员/本地账号，学生断言不得接管 |
| `username_conflict` | 409 | 4 次用户名尝试仍冲突 |
| `subject_expired` | 403 | 兑换时账号已过期（与平台 authMiddleware 同一判定） |
| `session_scope_changed` | 409 | 票据钉住的实例/平台/学校组与现态不一致 |
| `session_store_unavailable` | 503 | 会话上下文表缺失或不可用（候选迁移 002 未应用） |
| `context_unavailable` | 404 | 当前会话没有可读的作业线索 |
| `refresh_not_supported` | 503 | 部署把 `issue_refresh` 设成了 true（本候选不实现该半边） |

## 5 配置（`system_settings.sso_config.platforms[].c05`）

```jsonc
{ "platform_key": "edu", "secret": "≥32 字符", "algorithm": "sha256", "enabled": true,
  "ip_whitelist_enabled": true, "allowed_ips": "edu 出口 IP",
  "c05": {
    "enabled": true,
    "school_source": "config",           // 或 "database"（需候选迁移）
    "school_groups": { "123": 7 },       // school_ref → 学生组 id
    "landings": ["dashboard", "ai-practice.chat", "..."],   // 缺省=能力键全集+dashboard
    "issuance": { "mode": "from_group_pool", "amount": 100, "expire_days": 365 },  // 缺省⇒首登拒绝
    "group_change": "move_and_recycle",  // 或 "refuse"
    "user_limit": "ignore",              // 或 "auto_expand"
    "subject_rate_per_minute": 10,
    "trusted_proxy_hops": 0,             // 0 ⇒ 只信 socket 地址
    "issue_refresh": false,               // true 会被具名拒绝，见 §7.1
    "launch_url": "https://edu.example.edu/sso/practice/launch?entry=dashboard"
  } }
```

开关：环境变量 `C05_STUDENT_ENTRY_ENABLED=true`，**并且**候选迁移
`20260923_002_c05_session_context.js` 已应用（否则一律 `session_store_unavailable`：会话必须能记住
学生从哪节课来，发现得太晚就是在学生花掉一次性票之后）。部署实例名取 `IDENTITY_DEPLOYMENT_INSTANCE_KEY`，
会钉进票据。未设、空、`false` 都是关闭；写成别的值（例如 `yes`）
是 `config_invalid`，不会被当成"大概是想开"。配置每请求读一次（`system_settings` 改完不用重启，
改坏了立即拒绝而不是继续用旧规则）。

## 6 账号、学校映射与权限需求

- **学校 → 组**：`school_source: "config"` 用上面的 `school_groups`；`"database"` 用
  `user_groups(edu_school_id = school_ref, cohort = 'student', is_active = 1)`，需要候选迁移
  `backend/migrations-candidates/c05/20260923_001_c05_school_mapping.js`。两种都**不按名称/标签猜**；
  没映射、映射到停用组、映射到两条记录，都是 `school_not_provisioned`。说了 `database` 却没有那两列
  是 `config_invalid`，不会悄悄退回配置映射。
- **影子账号**：一个事务里完成——按 uuid 取用户行 `FOR UPDATE` → 按 id 升序锁组行 → 建号/更新 →
  扣组池/回收 → 覆盖写 `年级:` `班级:` 标签并同步 `users.tag_count`。锁顺序固定，并发首登不会死锁；
  真死锁（InnoDB 选中回滚）会重试 3 次，仍不通过才 `storage_unavailable`（retryable）。
- **建号字段**：`role=user`、`uuid_source=sso`、`username=s_<uuid 前16位>`（冲突加 2 位后缀，最多 4 次）、
  `email=<uuid>@sso.local`、`password_hash` 是随机 32 字节的 bcrypt（没有任何人知道的口令，只是占位）、
  `group_id`=映射学生组、`remark=[姓名]<display_name>`、`expire_at`=组 `expire_date`、初始额度见 §7。
- **绝不接管**：`role != 'user'` 或 `uuid_source != 'sso'` 的既有账号 → `subject_not_student`。
- **额度**：只从映射学生组自己的 `credits_pool` 里扣，池子不够就发 0（契约 §4），**不会**从别处借。
  账号真的建出来之后才扣池，用户名重试或并发输掉的那一次不会留下"扣了钱没有人"。
- **换校/换班**：把未花完的 `credits_quota - used_credits` 还回原组池（不低于 0），清零、跟随新组有效期。
- **权限需求**：应用账号需要对 `users / user_groups / user_tags / user_tag_relations / system_settings`
  的读写（就是平台现有应用账号已有的权限），不需要任何新权限、新角色或新库。

## 7 与契约的差异与产品缺口（逐条，没有隐藏项）

1. **refresh token（§7.1）**：契约 §5 是“不签发长效 refresh（或 refresh 24h）”的二选一。
   本候选**只实现第一半**，并对 `issue_refresh: true` **具名拒绝**（`refresh_not_supported`），
   而不是交出一个当前不能安全满足的配置：平台的 `/auth/refresh` 会走普通路径重新签发，
   那样会给出部署长度的 refresh（默认 14 天）、丢掉本次会话的上下文、也不会再核一次“这个账号还是学生”。
   要安全地把它限制在 24h，得改一条所有账号共用的登录路径，不在本包范围内。
   access 则按契约 §5 的 12h 上限签发：`TokenService.generateTokenPair` 加了**只对本次调用生效**的
   可选参数（不改全局配置、不缩短其它登录方式），隔离验收核的是真实 JWT 的 `exp-iat`（实测 43200 秒）。
2. **`user_limit`**：契约 §4 是"不生效或自动 +1"。候选默认 `ignore`（不动管理员设的数字，也不把已在
   edu 注册的学生挡在外面），可配 `auto_expand`。
3. **落地键两种写法**：契约正文说白名单是 `PORTAL_CAPABILITY_LANDINGS` 的键（形如 `ai-practice.chat`），
   §2 示例却写 `"entry": "chat"`。候选两种都收，短写法归一化成完整键，响应里回完整键。**建议 edu 发完整键。**
4. **会话上下文表**：契约 §4 提到把 context 记进 `sso_sessions(handoff_hash, user_id, context_json,
   expires_at)`。候选实现的是同一件事，表名叫 `c05_sessions`（候选迁移 002），列按本平台的既有习惯命名：
   `jti`（绑定本次 access token，**不存 token 本身**）、`user_id`、`platform_key`/`instance_key`、
   `school_ref`/`group_id`、`lesson_ref`/`assignment_ref`、`handoff_digest`（只存 sha256，且唯一——
   这是一次性的第二道、落在数据库上的保证）、`issued_at`/`expires_at`/`revoked_at`。
   **保留期限未定**：本模块不删任何行、也没有后台清理；`down` 在还有未过期会话时具名拒绝
   `c05_sessions_in_use`。令牌有效期与这份审计留存是两件事，没有被混在一起。
5. **nonce 键名**：契约写 `sso:nonce:<hash>`，候选用 `c05:nonce:<hash>`，避免与旧 SSO 的命名空间相撞。
6. **校验顺序**：契约把 nonce 写在签名之前。候选先验签再写 nonce——同样的线上行为，但没验签就写 nonce
   会让任何人都能用猜到的 nonce 占坑。这是收紧，不是放宽。
7. **换校不补发**：契约 §4 的换组语义是"回收、清零、同步有效期"，没说要在新组重新发放。候选照做，
   结果是换校后学生额度为 0，需要管理员或后续策略补。**这是业务缺口，不是实现缺口。**
8. **D-13 / 决-12**：发放参数与学生模式的业务值未定。没有 `issuance` 配置时**首登**具名拒绝
   （`issuance_policy_missing`），老学生照常登录（他们不需要这个值）。隔离演练里用的是合成策略，
   不是任何真实学校的值。
9. **C08 学校开通**：本候选只认"已经配好的映射"。学校开通流程、谁来配这份映射、配错了谁能发现，
   属于 C08，不在本包。
10. **教师**：本通道只接 `cohort=student`。教师走 C12，本包没有实现也没有假装实现。
11. **`/api/auth/sso/context` 暂时没有前端消费方**：会话上下文是给服务端与后续页面读的，
    落地页目前只用 `landing.entry` 进站，不展示也不使用作业线索。

## 8 验收

`dev/c05-lab/check.py`：自起 mysql:8.0（用本地开发库的**结构**建，无任何数据行）+ redis:7-alpine + 真实
node 后端 + 真实 Vite 前端 + Chromium 四宽度；edu 发行方与全部学生 uuid 都是合成的，**没有接真实 edu**。
覆盖：默认关闭零副作用 → 正常首登 → 14 种拒绝 → 来源地址边界 → Redis 失联与恢复 → 并发首登/并发消费
→ 用户名冲突与再次登录 → 换校回收 → 未定业务值具名关闭 → 候选迁移 up/重跑/带数据 down 拒绝/清空后 down
→ 会话边界（P09 开着也必须另外确认才能关联作业）→ 四宽度浏览器 → 日志敏感值扫描。
证据：`storage/private/c05-validation/run-*/report.json` 与同目录 17 张截图（不入库）。

第二轮 `dev/c05-lab/session-gates.py`（同样是真实 MySQL/Redis/HTTP，只跑本轮四项，不重跑四宽度）：
额度整份规则（剩 30 要 100 → 发 0 且不扣池 / 恰好够 → 发整份 / 一份半的池子两人并发 → 一个整份一个 0、
池只动一次 / 事务中途真失败 → 不建号不扣池 / 再次登录不重复扣款）；兑换时七种现态变化全部具名拒绝且不发会话；
干净票仍然通过且真实 JWT `exp-iat` = 43200 秒、无 refresh；会话上下文自己读得到、别人读不到、
退出后读不到；`issue_refresh: true` 被 `refresh_not_supported` 挡在门外；会话表候选迁移在有活会话时
`down` 具名拒绝、过期后干净删表。26 条判定全通过，修复前的失败报告保留在同目录的上一轮 `gates-*`。
