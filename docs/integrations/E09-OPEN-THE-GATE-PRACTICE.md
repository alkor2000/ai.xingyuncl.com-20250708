# E09 网站作业：实践侧开门清单（运维照做）

**这份清单不是"该不该开"的决定，只是"决定开了之后怎么开、怎么退"。** 开不开、开在哪套环境、谁签凭据，由业务与总控定。

**适用产品版本**：实践 `dc235947e66a1dee4d8eee91139d13cf4d1dcbd3`；本次只组合支持候选
`2040d05` 的发布守卫、账本实验脚本和清单，产品、依赖、运行配置与正式迁移未改。
这是**未发布的可审候选**，不能将父版或本地 HEAD 当作生产运行版本；生产情况由原发布者的逐站回执更新。

**当前组合有发布阻点**：支持脚本 `dev/deploy-docker.sh` 仍有自动 `docker image prune -f`，
与本次“不自动 prune”要求冲突。该原字节保留交原作者修正；既有 5 项假命令测试不覆盖发布后清理，
通过也不能解除这个阻点。本候选不合 main、不发布、不开放开关、不执行任何现有库的候选 DDL。

本清单沿用 `2040d05` 的独立账本实测方法，但按当前产品修正编辑器提交路径。
对端配置必须由 edu 执行者按其固定版本核对，不沿用旧 `8dd6f26` 清单摘要作为新版本证明。
已交付的合成本机环境保持原状；本文件不承担启动、停止或迁移它的动作。

---

## 零、先确认四件事，缺一件就别开始

1. **两端都要开，只开一端没有意义。** 实践这边开了、edu 那边 `E09_WEBSITE_ENABLED`／`C05_STUDENT_SSO_ENABLED` 仍关或七张表没建，学生一步也走不通。
2. **这套环境是不是合成数据。** 本清单只针对**合成学校、合成师生**。真实学生数据不在授权范围内。
3. **谁签凭据。** 见第四节的责任表：**服务凭据与 C05 密钥由实践签发给这套环境；edu 的入站资格凭据由 edu 签发给实践**。任何一方都不得复制生产密钥或自编。
4. **这套环境由谁持有。** 已有同事可点击的合成本机环境（见第八节）；新增共享主机、域名和启用窗口仍须具名确定，不能借用既有环境的端口、数据库或凭据。

---

## 一、数据库：执行候选迁移（**先做这一步，代码后到也没关系**）

候选迁移是**加法式**的（建表、加列、加唯一键，不改已有列的类型或约束）。按 `dev/RELEASE.md` 第三节，加法式**迁移先行**。

### 1.1 四个文件、执行顺序与依赖（从 `02b6184` 引入；本组合保留 `dc23594` 的候选文件原字节）

| # | 文件 | 建/改什么 | 依赖 |
|---|---|---|---|
| 1 | `backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js` | 建 **8 张表**：`p09_object_refs`、`p09_links`、`p09_revisions`、`p09_revision_files`、`p09_event_sequence`、`p09_events`、`p09_review_sessions`、`p09_idempotency`（按此顺序，外键依赖决定） | 无 |
| 2 | `backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js` | 给 `p09_links` 补 `write_seq`／`applied_write_seq` 两列（新建库由 001 自带，**这一步通常是空操作**） | 必须在 1 之后 |
| 3 | `backend/migrations-candidates/c05/20260923_001_c05_school_mapping.js` | 给**已有**表 `user_groups` 加 `edu_school_id`、`cohort` 两列与唯一键 `uk_user_groups_edu_school_cohort` | 无（与 P09 互不依赖） |
| 4 | `backend/migrations-candidates/c05/20260923_002_c05_session_context.js` | 建 1 张表 `c05_sessions` | 无 |

> **`c05_sessions` 是实践的表**，edu 库里不该出现；反过来 edu 的 7 张 `hw_website_*` 也不该出现在实践库里。
> **P03 的候选迁移 `backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js` 不在本清单内**，
> 本次开门**不要**执行它，也不要打开 `P03_HANDOFF_ENABLED`。

### 1.2 怎么执行（这一段是实测出来的，照做）

- **`make migrate` 与 `make deploy` 都不会执行候选迁移**：knex 只扫 `backend/migrations/`，候选目录不在其中。
- **不要把候选文件移进 `backend/migrations/`**——那等于让下一次发布自动建表，属于晋级，需要单独授权。

**先说一个会直接失败的做法**（不要这么干）：把四个候选放进临时目录、用**默认账本** `knex_migrations` 指过去。
原隔离实测的基线里有 10 条已应用记录，而那些文件不在候选目录里，knex 的 `validateMigrationList` 直接抛：

```
The migration directory is corrupt, the following files are missing: 20260127032549_000_baseline.js, …
```

**正确做法：给候选一套自己的账本表。** 候选目录 + `tableName: 'knex_migrations_candidates'`：

```js
// 一次性的候选配置，不要写进 backend/knexfile.js
{ client: 'mysql2',
  connection: { host, port, user, password, database, charset: 'utf8mb4' },
  migrations: { directory: '<只含四个候选的目录>', tableName: 'knex_migrations_candidates' } }
```

- 四个文件**原样复制**，只有一处要改：文件里 `require('../../src/services/...')` 的相对路径，
  在临时目录下要指到仓库里的真实位置（换成绝对路径即可）。**不要改其它任何一行。**
- **禁止**：关闭历史校验、删改正式 `knex_migrations` 的行、把迁移手翻成「同等 SQL」——
  手翻会把 c05 002 与 p09 002 里的**独占锁与拒绝条件**丢掉，那正是这两个文件存在的理由。
- 候选账本会自带 `knex_migrations_candidates_lock`，与正式账本互不干扰。

**这套做法的历史隔离实测证据**（`dev/release-lab/candidate-ledger.py`；一次性 mysql:8.0 ＋ 本机镜像库导出的
当时的 schema 与正式 `knex_migrations` 行，5 条判定全过；本次未重跑，不代表当前生产库）：

| 问的是什么 | 实测 |
|---|---|
| 基线 | 默认账本 ＋ 正式目录：无待执行、正式行 10 条 |
| 反例 | 默认账本 ＋ 候选目录：`The migration directory is corrupt…`，**正式行一条没动** |
| 修法 | 候选账本 ＋ 候选目录：四个全执行，9 张表 ＋ `user_groups` 两列齐 |
| 重复执行 | 再跑一次：`applied: []`，候选账本仍 4 行 |
| 下一次正常发布 | 回到默认账本 ＋ 正式目录：仍「无待执行」、仍 10 条，**不认为目录损坏** |

### 1.3 执行前 / 执行后 / 重复执行

**执行前**：
- [ ] 先备份数据库（`make deploy` 的备份门只在发布时跑，别指望它）。
- [ ] 确认目标库**不是**生产库（看清 `DB_NAME`）。
- [ ] 确认这些对象当前**都不存在**：
      `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND (table_name LIKE 'p09\_%' OR table_name='c05_sessions');` → 应当 **0 行**；
      `SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='user_groups' AND column_name IN ('edu_school_id','cohort');` → 应当 **0 行**。

**执行后**：上面第一条应当正好 **9 行**（8 张 P09 表 + `c05_sessions`），第二条正好 **2 行**。

**重复执行**：四个文件都是幂等的（`CREATE TABLE IF NOT EXISTS`；加列前先查 `information_schema`）。002 在**活账本**上重跑**不会**把 7/3 改成 7/7——它只补列、只修"已应用数超前于序列"的半状态。

### 1.4 回退（有数据时的硬条件）

| 文件 | `down` 的行为 | 什么时候**不能**退 |
|---|---|---|
| c05 001 | 先删唯一键再删两列 | **任一行 `user_groups.edu_school_id` 非空即具名拒绝**（那是学校映射，删了就没人知道哪个组属于哪所学校） |
| c05 002 | 在服务器确认的 `LOCK TABLES … WRITE` 独占窗口内核过**空表**才 `DROP` | **只要 `c05_sessions` 有任何历史行（含已过期、已撤销）就具名拒绝**；令牌过期不是删历史的许可 |
| p09 001 | 按外键倒序删 8 张表 | 有关联、事件或固定版本就别删——那是学生真做出来的东西 |
| p09 002 | 保留欠账标记 | 见文件内说明 |

**关功能用开关，不要用回退迁移**：表留着不影响任何东西（关闭态没有任何代码读它们）。

---

## 二、开关与运行时事实（缺一项就"拒绝启用"，日志会说原因，且不含密钥）

### 2.1 C05 学生入口

| 项 | 必填 | 说明 |
|---|---|---|
| `C05_STUDENT_ENTRY_ENABLED` | ✅ | 只能 `true`／`false`／不写；**不写＝关**；写别的值是 `config_invalid` |
| `system_settings.sso_config` 的 `platforms[].c05` 块 | ✅ | 见 2.2；块不在或 `enabled!==true` 即 `student_entry_disabled` |
| Redis | ✅ | 一次性票据要原子 `getDel`；Redis 不可用即 `storage_unavailable`，**不降级** |
| `c05_sessions` 表 | ✅ | 缺表在学生花掉票据**之前**就拒（`session_store_unavailable`） |
| `C05_PLATFORM_KEY` | ❌ | 默认 `edu`，要与 edu 的平台名一致 |
| `IDENTITY_DEPLOYMENT_INSTANCE_KEY` | 建议 | 钉住"这张票是发给哪套部署的"；两套站点共用同一密钥时靠它区分 |

### 2.2 `sso_config.platforms[].c05` 块（写进 `system_settings`，**每请求重读，改完不用重启**）

```jsonc
{ "platform_key": "edu", "secret": "<实践签发给 edu 的 HMAC 密钥>", "algorithm": "sha256", "enabled": true,
  "ip_whitelist_enabled": true, "allowed_ips": "<edu 服务器出口 IP>",
  "c05": {
    "enabled": true,
    "school_source": "config",              // 或 "database"（需要 1.1 的第 3 条迁移）
    "school_groups": { "<edu school_ref>": <实践学生组 id> },
    "landings": ["dashboard", "ai-practice.html"],
    "issuance": { "mode": "from_group_pool", "amount": <额度>, "expire_days": <天> },   // D-13 未决，缺它首次登录具名拒绝
    "group_change": "move_and_recycle",     // 或 "refuse"
    "trusted_proxy_hops": 0,
    "access_ttl": "12h", "issue_refresh": false   // true 会被 refresh_not_supported 拒绝
  }}
```

- **学校映射两种来源二选一**：`config` 用上面的 `school_groups`；`database` 查 `user_groups(edu_school_id, cohort='student', is_active=1)`，
  声明 `database` 却没执行第 3 条迁移是 `config_invalid`，**不会**回落到 config。
- 未映射的学校一律 `school_not_provisioned`，**不猜**。

### 2.3 P09 网站作品

| 变量 | 必填 | 说明 |
|---|---|---|
| `P09_WEBSITE_ARTIFACTS_ENABLED` | ✅ | `true` 才开；不写＝关；别的值是配置错误 |
| `P09_SOURCE_INSTANCE` | ✅ | 本实践实例标识，**edu 的 `audience` 要认这个名字**；与 `IDENTITY_DEPLOYMENT_INSTANCE_KEY` 冲突会拒 |
| `P09_DB_USER` / `P09_DB_PASSWORD` | ✅ | 受限账本角色，**不能是应用账号**（口令 ≥16 位）；授权见第三节 |
| `P09_TASK_ISSUERS_FILE` | ✅（否则端点在但一律拒） | JSON 数组，每项 `{issuer, key_id, secret, purposes}`；**这是 edu 签任务上下文的 HMAC 验证配置，含共享密钥**，缺它 `task_context_unavailable` |
| `P09_INTEGRATION_CLIENTS_FILE` | ✅ | JSON 数组（≤8 项），每项 `{client_key, key_id, secret, actions, school_refs}`；`actions` 取值只有 `artifacts:read`／`artifacts:review`／`artifacts:freeze` |
| `P09_ELIGIBILITY_FILE` | ✅（教师打开固定版要用） | 见第五节，**必须 `mode:"http"`** |
| `P09_PREVIEW_ORIGIN` | ✅（否则没有预览） | **必须 https、必须是 origin（路径只能是 `/`）、必须与应用不同源**；同源会被拒 |
| `P09_PREVIEW_BIND` / `P09_PREVIEW_TLS_KEY` / `P09_PREVIEW_TLS_CERT` / `P09_PREVIEW_FRAME_ANCESTORS` | ❌ | 绑定地址默认 `127.0.0.1`；自己终止 TLS 时给证书，走反代则不填；`frame-ancestors` 默认 `'none'` |
| `P09_SYNC_INTERVAL_MS` / `P09_SYNC_VERIFY_MS` | ❌ | 默认 60000／300000 |

改 `.env` **要重启服务**才生效（C05 的 `sso_config` 不用）。

---

## 三、受限账本角色（P09 专用，不能用应用账号）

用 `store.restrictedRoleGrants()` 生成，**恰好这些语句**（示例用 `ai_platform` / `p09_ledger`）：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_object_refs`   TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_links`         TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_revisions`     TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_revision_files`TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_events`        TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_event_sequence`TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_review_sessions` TO 'p09_ledger'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `ai_platform`.`p09_idempotency`   TO 'p09_ledger'@'%';
GRANT SELECT ON `ai_platform`.`users`          TO 'p09_ledger'@'%';
GRANT SELECT ON `ai_platform`.`html_projects`  TO 'p09_ledger'@'%';
GRANT SELECT ON `ai_platform`.`html_pages`     TO 'p09_ledger'@'%';
```

- 少给 `html_projects` 的 `SELECT` **不会让读取失败**：`/state` 仍 200、其它字段不变，只是每件作品的 `title` 一律 `null`（fail-soft，已实测）。
- 角色权限过宽（除这些之外还有别的）会被启动时的 `assessGrants` 具名拒绝。

---

## 四、两个方向的凭据：谁签、给谁、写在哪（**不读、不复制任何密钥值**）

| 凭据 | 签发方 | 交给谁 | 实践侧配置键 | edu 侧配置键 |
|---|---|---|---|---|
| C05 学生入口 HMAC 密钥 | **实践** | edu | `sso_config.platforms[].secret` | `C05_SECRET_FILE`（绝对路径、可读） |
| E09 服务凭据（出站：edu 调实践） | **实践** | edu | `P09_INTEGRATION_CLIENTS_FILE` 里一项 `{client_key, key_id, secret, actions, school_refs}` | `E09_CREDENTIALS_FILE` 的 `client`/`key_id`/`secret` |
| 任务上下文签名密钥 | **实践** | edu | `P09_TASK_ISSUERS_FILE` 里一项 `{issuer, key_id, secret, purposes}` | `E09_CREDENTIALS_FILE` 的 `grant_key_id`/`grant_secret` |
| 实例标识（不是密钥） | **实践** | edu | `P09_SOURCE_INSTANCE` | `E09_CREDENTIALS_FILE` 的 `audience` |
| 资格提供方入站凭据（实践调 edu） | **edu** | 实践 | `P09_ELIGIBILITY_FILE` 的 `client_key`/`key_id`/`secret` | `E09_CREDENTIALS_FILE` 的 `inbound_client`/`inbound_key_id`/`inbound_secret` |
| edu 实例标识 | **edu** | 实践（供核对） | 无（实践只认自己的 `P09_SOURCE_INSTANCE`） | `E09_SOURCE_INSTANCE` |

- **edu 的 `inbound_*` 三项不填，`/api/integrations/practice/e09/eligibility` 根本不注册**，实践就拿不到资格判定——
  这是对面清单 2.1 的原话，也是实践第五节能否工作的前提。
- 凭据文件权限：edu 侧要求正好 `0600`；实践侧同样建议 `0600`，且**不要**把密钥写进 `.env` 本身。
- 密钥 ≥32 字节；`client_key`／`issuer` 只能 `[a-z0-9_-]{2,32}`，`key_id` 只能 `[A-Za-z0-9_-]{1,32}`。

---

## 五、真实 edu 资格提供方（`mode:"http"`）

`P09_ELIGIBILITY_FILE` 的内容（**文件形态只接受 http**）：

```jsonc
{
  "mode": "http",
  "endpoint": "https://<edu 域名>/api/integrations/practice/e09/eligibility",  // 必须 https，不能带用户名/口令/fragment
  "client_key": "<edu 签发>", "key_id": "<edu 签发>", "secret": "<edu 签发>",
  "source_instance": "<本实践实例标识>",
  "timeout_ms": 2000,        // 200–10000，**整次调用的绝对预算**，不是空闲间隔
  "max_bytes": 8192,         // 256–65536
  "cache_ms": 0,             // 0–60000，**默认 0＝每次都问**
  "ca_file": "<可选：自签 CA 的绝对路径>"
}
```

- **正式配置只接受不透明 reviewer_ref**：`reviewer_ref:"mapping"` 或任何 `reviewer_refs` 明文映射在
  非 development/test 下**直接拒绝启用**；正式路径是 `audience_hash`（`sha256(issuer + "\n" + reviewer_ref)`）。
- **fail-closed**：问不到、超时、答得不对，一律 `eligible:false` + `eligibility_unavailable`，**绝不因为超时放行**。
- 不跟随重定向；`cache_ms` 默认 0 意味着每次打开固定版都会真的问一次 edu。

### 5.1 当前编辑器的“交作业”通道

同一 `P09_ELIGIBILITY_FILE` 可增加 `submit` 块；资格判定与提交是两个不同端点。
端点由部署配置固定，浏览器不能指定：

```jsonc
"submit": {
  "endpoint": "https://<edu 域名>/<edu 执行者确认的提交端点路径>",
  "timeout_ms": 8000,
  "max_bytes": 8192
}
```

`client_key`、`key_id`、`secret`、`source_instance`、`ca_file` 未在块内指定时从资格配置继承；
正式提交端点必须 HTTPS。`timeout_ms` 有效范围 500–20000（默认 8000），
`max_bytes` 为 256–65536（默认 8192）；两者不继承资格配置的数值。
缺少该块时 `capability.submit_configured` 为 false，编辑器保留“生成评阅版本＋回 edu 提交”的路径；
直接调用提交路由则具名 `submit_unconfigured`，不向 edu 发送请求。配置块和凭据准备好后才可验编辑器提交。

实践只转交学生明确的一次点击；是否已交、截止、次数限制和固定版本由 edu 判定。
只有完整的肯定答复才能显示“已交”。超时或答复不可读是“暂时无法确认”，应先去 edu 核对记录，
不自动重试、不把“取消关联”当重试。依据：`runtime.js` 的 `submitRelaySpec`、`submitRelay.js`、
`TaskArtifactPanel.jsx`。

---

## 六、开门之后必须复验这几条（按顺序，任何一条不对就先关回去）

- [ ] **服务起来了**：`/health` 返回 `status ok`。
- [ ] **日志**：看到 P09 运行时**已装配**而不是 `P09 website artifacts disabled (default)`。
- [ ] **能力探测**：`GET /api/auth/sso/capability` → `available:true`（关闭时是 `false`）；
      `GET /api/p09/website-artifacts/capability`（学生登录态）→ `available:true`。
- [ ] **对象齐了**：9 行（8 P09 表 + `c05_sessions`）＋ `user_groups` 两列。
- [ ] **旧功能没退步**：普通账号密码登录、网页编辑器保存一次、历史 `POST /api/auth/sso` 仍是 400 `缺少必要的SSO参数`。
- [ ] **隔离预览域**：`P09_PREVIEW_ORIGIN` 与应用不同源，浏览器打开固定版时地址栏是预览域而不是主站。
- [ ] **拒绝也对**：未签名的 edu 调用拿不到状态；别校的 `school_ref` 读不到；学生 bearer 打 edu 服务端接口被拒。
- [ ] **最短链**见第七节（需要 edu 侧也已开门）。

---

## 七、合成账号下的最短浏览器链（给普通测试员照做）

> 前提：两端在获准的合成环境启用，且已配置第五节的提交通道。界面或服务尚未就绪时记录缺项，不用模拟接口冒充真实链。

1. （edu）老师建一份“网站作品”作业，指定合成班级。
2. （edu → 实践）学生从这份作业进入编辑器，应已登录；一次性票据立即从地址栏消失。
3. （实践）在“教学任务作品”面板核对本次作业，选择自己的项目与入口页，点击“确认关联”。
   若项目还关联上一次作业，会出现提示且“交作业”不可点击；保留旧关联，选择新项目继续。
4. （实践）关联后再改一次内容并保存。关联前的历史保存不代替本次关联后的保存证据。
5. （实践）点击“交作业”。收到完整成功答复后显示“已交 · 第 N 版”；这条路径不用回 edu 再交一次，
   也不需先手动点“生成评阅版本”。若显示拒绝，按原因处理；若暂时无法确认，先到 edu 核对本次作业记录。
6. （edu）老师打开这次提交的固定版，核对内容与图片。
7. （实践 → edu）学生改稿并保存，老师原先的第 N 版应保持不变；再次明确提交才可能产生下一版，是否允许仍由 edu 判定。
8. （实践）从作业 B 进入并关联 B 后，再切回已关联作业 A 的项目，仍应挡住普通提交；切回 B 可正常操作。
   核验不能只有灰按钮截图，还要确认没有向 A 发出提交请求。

**未配置提交通道的兼容路径**：实践的“生成评阅版本”只是固定版本，不等于提交。
此时需回 edu 关联作品并明确“提交当前版本”，由 edu 返回提交结果。不要把这个兼容分支写成已配置通道的必经步骤。
`/state` 会回当前来源作品名，无法证明时为 `null`，对端按明确回退显示。

**反例（必须都不通）**：
- 别班老师打开同一件作品 → 打不开；
- 把预览链接转发给第二个人 → 打不开（会话绑定当初兑换的那个浏览器）；
- 学生 A 用学生 B 的任务上下文关联 → 拒绝；
- 同一张任务上下文用第二次 → 拒绝；
- edu 侧资格服务临时停掉后再打开 → 明确提示"现在确认不了"，**不能**显示成"学生没做"。

---

## 八、已有证据与本清单的边界

- **可点击的合成本机环境已有交付**：实践产品 `dc23594` 与 edu 的固定归档，宿主五个端口仅回环；
  由原 edu 执行者持续持有。该环境及旧演示本次均不重建、不停止、不清理。最新入口、合成账号取用和身份化停止方式
  见工作区固定回执 `20260925-E09本机测试入口.md` 与更正件 `20260925-E09本机入口仅回环与身份化停止.md`。
  新共享主机及公网域名属于另外的部署决定，本清单不发明地址。
- **真实两端资格已有独立执行者的记录**：`20260925-E09同版师生联验总控收口.md` 记录真实 edu HTTP(S)、
  `cache_ms=0`、`audience_hash` 的允许／拒绝／不可达／恢复。前述本机入口更正件记录同版提交、固定版读取及 A/B 归属冒烟。
  这是引用固定证据，**不是本次重跑**；实践旧 `dev/e09-lab/stub.cjs` 的通过仍不能当作真实 edu 判定。
  本 Codex 的跨仓执行 HOLD 不变，不运行 edu／Identity 代码。
- **业务决定**：D-13 首次额度、换校补发、会话留存与学校开通须以现行具名决定为准；本候选不新增这些权利。
  缺 `issuance` 时首次登录具名拒绝，不能拿合成环境参数替代业务决定。
- **P03**：不在本清单内。不要执行 P03 候选迁移，也不要打开 `P03_HANDOFF_ENABLED`。
- **生产开通、真实学生数据、真人与实体手机验收**不由本候选证明。电脑浏览器 390 宽不等于实体手机。

上述证据文件均位于独立工作区 `docs/progress/`；应用仓中的本清单只引用其身份，不复制账号、密钥或实验数据。
