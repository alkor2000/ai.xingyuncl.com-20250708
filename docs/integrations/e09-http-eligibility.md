# 把评阅资格接到 edu 的真实接口：mode: 'http' 适配

分支 `codex/e09-http-eligibility`，从联合候选 `ca534dc` 接续。默认仍然关闭、未部署、未启用生产。

本文按 **edu 固定提交 `d2f54c9e` 的源码逐字核对**写成，不是按说明猜的。凡是源码与
`ELIGIBILITY-ADAPTATION.md`（SHA `5d3d63c1…`）说法不一致的地方，**以源码为准**，并在第 3 节逐条列出。

## 1 practice 这边补了什么

`backend/src/services/websiteArtifact/eligibility.js` 新增 `mode: 'http'`：语义与 `static` 完全一致，
只是 `check()` 变成一次 HTTPS 调用。`static` 仍然只在 development/test 可用；**`http` 允许在正式配置形态装配**
（否则真实鉴权永远上不去），但本任务不部署、不开生产。

配置有两种来源：
- 部署形态：`P09_ELIGIBILITY_FILE` 指向一个 JSON 文件，**只接受 `mode: 'http'`**，不限 NODE_ENV；
- 实验形态：`P09_LAB` 里的 `eligibility` 块（原有路径，static 仍限 development/test）。

```jsonc
{
  "mode": "http",
  "endpoint": "https://<edu>/api/integrations/practice/e09/eligibility",  // 固定、https、无凭据、无片段
  "client_key": "practice", "key_id": "k1", "secret": "<≥32 字符>",       // 与 integration_clients 同一套
  "source_instance": "<实践实例名>",
  "timeout_ms": 2000,        // 200–10000
  "max_bytes": 8192,         // 256–65536，超出即丢弃
  "ca_file": "/etc/ssl/edu-ca.pem",   // 可选；不配就用系统信任库
  "cache_ms": 0,
  "reviewer_ref": "audience_hash",    // 或 "mapping"
  "reviewer_refs": { "<sha256(issuer\\nreviewer_ref)>": "<edu 的 reviewer_ref>" }
}
```

调用只去这一个固定端点：**师生的请求不能influence它**，不跟随任何重定向（3xx 直接当作无法理解的回答），
`rejectUnauthorized` 恒为真，主机名与证书都校验，超时与响应体上限都有界，密钥与请求体不进日志。

## 2 签名与固定向量

签名构造与 edu 的 `signRequest`（`internal/integrations/e09website/signing.go`）逐字一致：

```
canonical = METHOD \n PATH \n <query 按名排序 name=value 以 & 连接> \n hex(sha256(body))
signature = hex(sha256( secret \n timestamp \n nonce \n hex(sha256(canonical)) ))
```

**已用 edu 自己发布的向量对过**（edu `vectors_test.go` 里那条，同时也是 practice 源码 §2b 的那条）：

```
secret     p09-vector-client-0123456789abcdef0123456789ab
GET /api/integrations/edu/website-artifacts/state  query school_ref=school-1  body 空
ts 1790000000  nonce a1b2c3d4e5f60718293a4b5c6d7e8f90
=> d39709ccecbaa53454ab1fe3d04bfc04304215e60cf6eacc69a37f5591b190c7   ✓ 两边相同
```

本接口自己的固定向量（edu 可直接自检）：

```
secret     e09-vector-client-0123456789abcdef0123456789ab
POST /api/integrations/practice/e09/eligibility   query 空
body       {"schema_version":1,"school_ref":"school-1","assignment_ref":"assign-1","reviewer_ref":"4021","student_uuid":"edu-uuid-0001","purpose":"website_artifact_review","source_instance":"practice-integration"}
body 字节   202          sha256(body) 6434a5924819434827557905c829b462e0163c37bf9ca2c9b50b4a5612f03857
ts 1790000000  nonce a1b2c3d4e5f60718293a4b5c6d7e8f90
X-P09-Signature ce947e0ff32380b9745a67a22ad47df65e078ad4f9088e1beb3161aee373d32e
```

请求头：`x-p09-client` / `x-p09-key-id` / `x-p09-timestamp`（Unix 秒）/ `x-p09-nonce`（每次新鲜，16–128 字符）/
`x-p09-signature`。edu 的 `Verifier` 用 5 分钟窗口 + nonce 不重放 + 常量时间比对。

## 3 与适配说明不一致的三处（**以 edu 源码为准**）

### 3.1 请求里没有 `audience_ref`，edu 要的是 `reviewer_ref`

`services.EligibilityRequest`（`internal/services/e09_eligibility.go`）的字段是：

```
schema_version, source_instance, school_ref, assignment_ref, reviewer_ref, student_uuid, purpose
```

而且 handler 用 `d.DisallowUnknownFields()` 解码——**多一个 `audience_ref` 就是 400 `invalid_request`**。
更关键的是 `teaches()` 里 `strconv.ParseUint(req.ReviewerRef)`：edu 要的是**它自己的数字用户 id**。

这与说明里"实践平台不需要知道 reviewer_ref 明文"直接冲突，而且 practice 侧确实**只有哈希**：
`taskGrant.js` 在校验任务上下文时就把 `reviewer.ref` 换成 `sha256(issuer + "\n" + reviewer_ref)`，
会话里存的是 `reviewer:<哈希>`，明文不进账本（这是 P09 写明的不变量：不保存 edu 的内部 id）。

**本包不跨仓改产品、也不硬接放行**，所以给了两种明确配置，默认那种在今天会被 edu 拒：

| `reviewer_ref` | practice 发出去的 | 今天 edu 的反应 |
| --- | --- | --- |
| `audience_hash`（默认） | `sha256(issuer\nreviewer_ref)` | `ParseUint` 失败 → 403 `reviewer_unknown`（fail-closed） |
| `mapping` | 按部署配置的映射查明文；查不到**不发请求**直接拒 | 正常判定 |

**最小差异（建议 edu 侧补）**：`teaches()` 之前先按 `sha256("edu\n" + strconv(user.id))` 比对一次，
即说明里写的那条；这样 practice 不必持有任何 edu 的 id，`mapping` 这个过渡配置也可以撤掉。
在此之前，`mapping` 是唯一能让真实链路跑通的形态，而它要求部署方逐个登记教师，**不适合生产**。

### 3.2 拒绝不是 `{eligible:false}`，是 403 + error 信封

`handlers/e09_eligibility.go` 的实际回答：

| 情形 | 状态 | 体 |
| --- | --- | --- |
| 通过 | 200 | `{"schema_version":1,"eligible":true,"decided_at":…,"expires_at":…}` |
| 不通过 | **403** | `{"error":{"code":"not_eligible","message":"<reason>","retryable":false},"decided_at":…}` |
| 凭据不过 | 401 | `{"error":{"code":"credential_refused",…}}` |
| 请求不合法 | 400 | `{"error":{"code":"invalid_request",…}}` |

reason 出现在 **`error.message`**，不是 `reason` 字段。

### 3.3 reason 词汇比说明里多

edu 实际会答：`request_incomplete` / `purpose_unsupported` / `instance_mismatch` / `reviewer_unknown` /
`assignment_unknown` / `school_mismatch` / `assignment_closed` / `school_unmapped` /
`student_not_in_roster` / `link_revoked` / `not_eligible`。
说明里的四个（`reviewer_not_in_school` 等）是本仓实验替身的词汇。两套都在 practice 的白名单里；
**白名单之外的字符串一律归为 `not_eligible`，不回显**。

## 4 答案怎么被读（没有任何"顺手放行"）

- 200 且 `schema_version === 1` 且 `eligible === true`（**严格布尔**）才是通过。字符串 `"true"`、
  缺 schema_version、空壳、HTML 错误页，全都不是答案。
- 403 → 不通过，reason 取白名单内的 `error.message`（否则 `not_eligible`）。
- **400 / 401 / 5xx / 超时 / TLS 失败 / 重定向 / 超长 → `eligibility_unavailable`**，
  它的意思是"这次问不到"，**不是**"这位老师不能看"，更不是"学生没做"。
- 绝不回退到 `static`，绝不复用上一次成功的答案（实测：成功之后把提供方停掉，下一次就是 unavailable）。

## 5 缓存：说明写的是四元组，实际不是

适配说明写"缓存键仍是四元组"。**当前源码不是这样**：`service.js` 的 `eligibilityCache` 以
**`session.id`** 为键（`requireEligible` 里 `eligibilityCache.get(session.id)`），TTL 就是提供方的 `cacheMs`。
本包**没有**改这个范围，也没有加任何后台轮询。

- 默认 `cache_ms: 0`，本轮验收也用 0：**每一次字节读取都真的去问**。
- 若部署把它设成非零，撤资格的可见边界就是**那个会话最多再撑 cacheMs 毫秒**（≤60s），
  不能说成"每个字节都即时现读"。
- 失败**不会**被缓存成允许：`eligibility_unavailable` 只会让这次访问被拒；把缓存调长也掩盖不了断线，
  因为断线的答案本身就是拒绝。

## 6 这一轮验到了什么、**没**验到什么

`dev/e09-lab/check.py`，12 条判定全通过（证据 `storage/private/e09-validation/run-*/report.json`）：

| 衔接 | 实测 |
| --- | --- |
| 本班老师打开被点名的那一版 | 200，页面与图片都渲染（资源按内容寻址改名） |
| **撤资格后下一次字节** | 同一个**已打开**的会话：撤销前 200，撤销后 **401**，图片一并没有被放出 |
| 他班老师 / 不是本作业 / 学生离班 | 403 `not_eligible`（按 edu 的 reason 词汇） |
| 提供方离线 / 畸形回答 / 错签名 / 错 CA / 根本没提供方 | 全部 **503 `eligibility_unavailable`** |
| 部署形态 `P09_ELIGIBILITY_FILE` | 正常装配并作答 |

单测 17 条（`websiteArtifactEligibility.test.js`）：签名向量、请求字段集合、403/401/400/5xx/HTML/重定向/
超长/超时/错 CA、严格布尔、不复用上次成功、mapping 未登记不发请求、production 下 http 可装 static 不可装。

**没有验到的一件事，必须照写**：**edu 的真实 Go handler 与它的名单库没有在本轮执行**。
本轮 edu 端由 `dev/e09-lab/stub.cjs` 扮演——它按 edu 源码的**线形**回答、用 edu 的**同一套签名构造**校验
（该构造已对过 edu 自己的向量），但它**不是 edu 的判定代码**。
驱动已经写好（`cmd/e09-eligibility-lab`，装配 edu 原始的 `RegisterE09Eligibility` /
`InitWebsiteHomeworkService` / `CheckEligibility` / `Verifier`，名单库是 AutoMigrate 出来的合成库，
**不改 edu 任何产品文件**），并且**编译通过**；但在本机构建并运行 edu 仓库代码被本会话的权限分类器拒绝，
因此没有据此宣称"真实双端已接通"。授权之后跑一次即可补上这一格。

## 7 仍然缺的

真实 edu 联调与真人验收都没有做；`reviewer_ref` 的形态差异未解决（见 3.1）；
两组候选迁移仍未晋级；留存 / D-13 / 决-12 / 换校补发 / C08 / C12 / 真实账号 / 生产开关均未授权。
