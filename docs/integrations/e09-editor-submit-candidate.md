# E09：学生在编辑器里交作业（固定候选，默认关闭）

分支 `codex/e09-editor-submit-20260924`，父版 `02b61844fe8ec66371fb3bc72a3574eb89b73f5d`。
北极星：**学生在制作网页的同一处明确交作业，显示 edu 确定的提交版本或具名拒绝。**

**能证明什么**：实践这一侧的按钮位置、转达通道、成功/拒绝/未知三分、双击只发一次、关闭态零外调，
已用真实浏览器（1280 与 390）与真实签名通道验过。
**不能证明什么**：**真实两端提交没验**——对面的判定代码是 edu 的 Go，跨仓审核 HOLD 未解除，
本轮扮演对面的是 `dev/e09-lab/stub.cjs`（线形与签名按固定导出实现，**不是 edu 的判定代码**）。
**代码写完不等于业务开通**：两个开关仍默认关闭，正式站上不会出现这条通道。

## 一、固定输入（逐项核过）

- `/home/hanying/pkuailab-ws/output/e09-user-flow-inputs-20260924/manifest.json`：23 个文件，
  sha256 **全部一致、0 处不符**；涉及两个提交对象 `134d1d8`（edu 固定导出）与 `02b6184`（本侧父版）。
- 只读消费 edu 的 `SUBMIT-WHERE-THEY-WORK.md`、`homework_website_inbound.go`、`handlers/homework_website.go`、
  `verify.go` 与根裁定；**没有构建、没有运行任何 edu/Identity 代码**，也没有碰 18191/18192/18194。
- 接口按 edu 固定导出 §3 实现，本轮 edu 侧接口未变更。

## 二、改面（最窄产品写面）

| 文件 | 干什么 |
| --- | --- |
| `backend/src/services/websiteArtifact/eduCall.js`（新，81 行） | 签名与有界同步调用一处实现：`inner=sha256(METHOD\npath\nsorted-query\nsha256hex(body))`、`outer=sha256(secret\ntimestamp\nnonce\ninner)`；绝对截止、字节上限、不跟随跳转。资格与提交共用，防止两条通道漂移。 |
| `backend/src/services/websiteArtifact/submitRelay.js`（新，127 行） | 配置校验（https；client_key/key_id/secret≥32；超时 500–20000ms 默认 8000；字节上限默认 8192；可选 ca_file）与答复严格解读。 |
| `backend/src/services/websiteArtifact/service.js` | 新 `submitLink({ownerUserId, linkId})`：身份与事实全部取自**本人活关联的账本行**；同一 link 的在途提交去重；**不写账本**。 |
| `backend/src/routes/websiteArtifacts.js` | 新 `POST /api/p09/website-artifacts/links/:id/submissions`（学生本人登录态）；`capability` 增 `submit_configured`。 |
| `backend/src/services/websiteArtifact/runtime.js` | 提交端点来自部署自己的配置文件（`P09_ELIGIBILITY_FILE` 的可选 `submit` 块，与资格同一对凭据同一条通道）；`readiness` 增 `submit_relay/submit_endpoint/submit_timeout_ms`。 |
| `backend/src/services/websiteArtifact/errors.js` | 5 个具名出口：`submit_unconfigured`、`assignment_ref_missing`、`submit_unavailable`、`submit_answer_invalid`、`submit_refused`。 |
| `frontend/src/components/htmlEditor/TaskArtifactPanel.jsx` | 主按钮变「交作业」；成功框只在 `submitted:true` 且固定版字段齐时出现；拒绝原句照显；取消关联降为小号红字次要危险操作；"先保存后关联"提示指向"关联后再保存一次"。 |
| `frontend/src/locales/{zh-CN,en-US}/htmlEditor.json` | 两侧各 204 键、同步；新增交作业、已交、拒绝各码、三个错误码文案；`unlinkHint` 改写为"会清零本次关联保存证据、不要拿它当重试"。 |
| `backend/src/services/websiteArtifact/eligibility.js` | 只把签名/调用两个函数换成共用实现，导出与行为不变（既有 21 个测试原样通过）。 |

自有测试与实验：`backend/src/__tests__/unit/services/websiteArtifactSubmit.test.js`（新，11 例）、
`frontend/src/__tests__/unit/components/TaskArtifactPanel.test.jsx`（+6 例）、
`dev/e09-submit-lab/check.py`（新，浏览器实验）、`dev/e09-lab/stub.cjs` 与 `dev/p09-lab/browser.cjs`（实验室件）。

## 三、对 02b6184 的消费差异

- **新增一个学生路由**（上表），登录态校验与既有路由同源；请求体必须为空，多一个字段就按 `invalid_request` 拒。
- **新增一处配置键**：`P09_ELIGIBILITY_FILE` 的可选 `submit` 块（`endpoint/client_key/key_id/secret/source_instance/timeout_ms/max_bytes/ca_file`）。
  缺这块时按 `submit_unconfigured` 具名拒绝，**不外调**；`P09_LAB` 的同名内联块只在 development/test 生效。
- **新增 readiness 三字段**（只到主机名与超时，不含任何凭据）。
- **没有新迁移**、没有新生产 purpose、没有新凭据种类（复用 P09 服务凭据这一对）。
- **没有新后台任务**：不自动提交、不后台重试、无新定时器。
- 非 E09 路径能力保持原样；`HtmlEditorController.js` 未碰（保存 500 另属反馈单）；C05 的 `ai-practice.html` 与导航登记未重写。
- 提交**不写本侧账本**：交上与否是 edu 的事实，本侧不留一份可能跟对面不一致的"已交"。

## 四、口径（三条硬边界）

1. **只有 `submitted:true` 且固定版字段有效**（`schema_version===1`、`revision_ref` 合法、`revision_no` 为 ≥1 整数、
   `submitted_at` 为正整数）才显示"已交 · 第 N 版"；伪成功一律不算。
2. **拒绝必须同步且具名**：edu 的原句照显，认得的码走本侧翻译，不认得的按普通拒绝显示，不擅自归类。
3. **未知既不是成功也不是拒绝**：超时、断连、答复看不懂都说"还没有交上，请稍后再试"，
   并且明确"不要用取消关联来重试"。

身份只从服务器事实来：`source_instance/school_ref/assignment_ref/student_uuid/artifact_ref` 全取自本人活关联的账本行；
浏览器给的 linkID 若不属于本人，回答与"不存在"完全一样（404），**零外调**。密钥不进浏览器，端点不来自浏览器。

## 五、具名残留

- **真实两端提交未验**：需要 edu 的 Go 与真实师生同版闭环，由原 edu 持有人在其安全断点做；本侧不绕 HOLD。
- **拒绝答复里 `retryable` 的确切线形字段名未在固定导出中出现**：本侧按"未出现即按码表判定"处理
  （`assignment_closed/deadline_passed/submission_limit/...` 为终态，三个 `*_unavailable` 与 5xx 可重试）；
  若 edu 之后明确该字段，改的是解读的一行，不动通道。
- **"一次点进来就直落编辑器"不在本包**：当前学生可能仍要回 edu 点第二次（edu 侧已定位到 C05 消费时
  `history.replaceState` 清掉 `#p09_task`），另有裁定与固定源，排在下一包。
- 编辑器保存偶发 500：反馈总控另单，本包未碰。

## 六、验证证据

**受影响的服务/路由测试**（本候选树）：`websiteArtifact*` 与 `routes/websiteArtifacts` 共 7 个套件 103 例全过，
其中新增 `websiteArtifactSubmit.test.js` 11 例覆盖：事实取自账本行、他人 link 拒绝且**零外调**、
未关联/课次编号为空在外调前就拒、未配置通道按名拒绝、双击只发一次、拒绝原句透传、
逾期为终态而故障可重试、超时为未知、四种伪成功与一张 HTML 错误页都不被当成功、转达不写账本、
生产下 http 端点与短密钥被拒、默认超时 8000ms。前端面板 13 例全过。

**真实浏览器实验** `dev/e09-submit-lab/check.py`（证据 `storage/private/e09-submit/run-20260924T085535Z/`，13 张截图）：

| 场景 | 学生看到 | 本侧请求 / 对面被叫 |
| --- | --- | --- |
| 桌面 1280 按一次 | 绿框"已交 · 第 1 版 · 时间" | 1 / 1 |
| 手机 390 按一次 | 绿框"已交 · 第 1 版 · 时间" | 1 / 1 |
| 次数用完 | "提交次数已用完"（对面原句） | 1 / 1 |
| 逾期 | "已过截止时间，本次不收"（对面原句） | 1 / 1 |
| 断连 | "没有交上：这次没有拿到老师那边的答复" | 1 / 1 |
| 超时（对面挂住不答，走本侧 4s 绝对截止） | 同上未知提示 | 1 / 1 |
| 伪成功（200 但缺固定版字段） | "没有交上：收到的答复看不懂" | 1 / 1 |
| 连点两下 | 一个绿框"已交 · 第 2 版" | **1 / 1** |
| 开关关闭 | 面板整块不出现（capability `available:false`） | 0 / 0（替身流水一行未增） |

另外两条形状裁决在两种宽度都过：面板上主按钮是「交作业」；「取消关联」是 `ant-btn-text ant-btn-dangerous` 的小号次要操作。
"先保存后关联"的那一次会显示"关联之后再保存一次"的提示，保存后提示消失、可以交。

数字是两边各数一次数出来的：浏览器数 `/submissions` 请求，替身数**通过凭据校验**的 submit 流水，
所以"只发一次"不是空断言。真实件与替身件在报告 `real / synthetic / not_executed` 三段里分列。

## 七、部署时要配什么（本轮不配，也没有生产动作）

在部署自己的 `P09_ELIGIBILITY_FILE` 里加一个 `submit` 块，与资格提供方同一对服务凭据：

```json
{ "mode": "http", "endpoint": "https://<edu>/api/integrations/practice/e09/eligibility",
  "client_key": "practice", "key_id": "k1", "secret": "<不进浏览器、不进仓库>",
  "submit": { "endpoint": "https://<edu>/api/integrations/practice/e09/submit", "timeout_ms": 8000 } }
```

不配这块，按钮仍在，但按下去按名拒绝、一个字节都不外发。开关仍由 `P09_WEBSITE_ARTIFACTS` 决定。
