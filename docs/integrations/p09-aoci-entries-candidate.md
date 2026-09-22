# P09 认知索引条目候选（待合入主工作副本后由 aoci_maintain/aoci_update_entry 正式写入）

本分支在独立 worktree `~/ai-platform-p09-20260922` 开发，而本会话的 AOCI MCP 服务绑定在主工作副本
`~/ai-platform`（Volumes v1 只能经 MCP 写入，CLI 的 `index agent plan/update-entry` 对 v1 返回
`该命令或兼容写入路径不支持修改Volumes v1正式认知`）。因此 **本包没有、也不能在本会话把这些条目写进正式索引**：
下面是按当前 Meta 字典（`aoci.meta.txt`）预先创作好的完整条目与绑定摘要，合入主副本后调用一次
`aoci_maintain` → `aoci_update_entry`（批次内逐条带 `source_sha256`）即可对齐，届时以机器签发的候选身份为准。

`aoci check`（在本 worktree 运行）当前报告：12 条 missing、7 条 stale、observed_pending（测试目录只 observe）。

## 新增对象（missing）

| 仓内路径 | source_sha256 |
|---|---|
| backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js | ec84f6773d43d654cf72da6c8f2ce090f92cac75fa1e4ea7532ca4c6bbab4fdb |
| backend/src/routes/websiteArtifacts.js | 93b5c0735853a29a2117926b922ab70247d92bf2d5dc8b03d3a08b4ee1ffc2c6 |
| backend/src/services/websiteArtifact/errors.js | 5b07aec7d2ac323e3936570cbaf76331578ece5d26986bd5a72bc1aa2a63818d |
| backend/src/services/websiteArtifact/previewServer.js | e3ee4084b39ba456e2fffb9939c77eb374f630396d33dadbb097a6be65b0a282 |
| backend/src/services/websiteArtifact/runtime.js | 019ee6672e62450130e4a61b4b3c2ce357a33d31808d231b933ef759bf150c09 |
| backend/src/services/websiteArtifact/service.js | 2808b9b493610ea827e6e609a6283f3ba0e3c42a9d1f7585e231c94a28253d39 |
| backend/src/services/websiteArtifact/snapshot.js | 6e8dd567c1513f64a4f1b21ec176a53be40fca7c29b423e431672d46e7502943 |
| backend/src/services/websiteArtifact/sourceHook.js | bfe9ecead1d4b545268ca3105ffd6f2f4dc7c7f58e2dc69443823ef13513b20c |
| backend/src/services/websiteArtifact/store.js | 4514748bf6ed7197e80fb3e77c3690ff9180dc462f1553cf52996beb07ce64b0 |
| backend/src/services/websiteArtifact/taskGrant.js | b21c74c93c338d9aeed66b75565671ea7050f941d65a199061f5d4f953707ca5 |
| docs/integrations/p09-website-artifact-source-candidate.md | ea24e405ea1f16d46e72e763d68aa80813183f7ea964a55c7d40269c832aac8d |
| frontend/src/components/htmlEditor/TaskArtifactPanel.jsx | 66696eeaf346b2c3700d99edd8d2572ad4c8ec76455a74748ab0de2cfdeb15ba |

```
20260922_001_p09_website_artifacts.js[PD6T]: F:T·P09 网站作品账本八表的 knex 迁移候选：up 逐字重放 websiteArtifact/store.js SCHEMA，down 按外键顺序删表；位于候选目录不被 knex 扫描 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/knexfile.js,code:docs/integrations/p09-website-artifact-source-candidate.md | A:exports.up/down/tables | S:进入 backend/migrations/ 即在下次 make deploy-docker 自动建表，授权前不得晋级；down 丢账本与固定版本字节须先备份
websiteArtifacts.js[EN8M]: F:N·P09 两个 HTTP 面：学生端关联/撤销/生成评阅版本/自建预览会话，edu 服务端当前状态、增量事件、提交冻结与评阅会话；统一请求 ID 与安全错误信封 | R:code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/services/websiteArtifact/service.js,code:backend/src/middleware/authMiddleware.js,code:frontend/src/components/htmlEditor/TaskArtifactPanel.jsx,code:backend/src/app.js | A:/api/p09/website-artifacts/{capability、links[/:id/{unlink、revisions、preview-sessions}]},/api/integrations/edu/website-artifacts/{state、events、revisions、review-sessions} | S:运行时未开启一律 503 website_artifacts_disabled；作业与学生身份只来自签名任务上下文请求头，请求体未知字段拒绝；edu 面按静态服务凭据签名(方法+路径+排序query+体摘要)与 school_refs 授权；16KiB 严格 JSON
errors.js[CN5T]: F:N·P09 固定错误分类：P09Error/fail 与面向运维的中文短句表（任务上下文、来源、评阅会话、游标、基础设施） | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/routes/websiteArtifacts.js | A:P09Error,fail,MESSAGES,message | S:message 不含请求原文、他平台标识、凭据或堆栈；码即契约面，改动须同步 edu 消费方
previewServer.js[EN8S]: F:N·隔离预览域：独立 Express 监听器，Host 与配置主机名不符即 404；一次性 handoff 换 HttpOnly Cookie，再按会话逐次校验后输出页面字节 | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/server.js | A:GET /p09/preview/open?h=,GET /p09/preview/:sessionId/*,createPreviewApp,startPreviewServer | S:CSP sandbox 不给 allow-same-origin，学生脚本读不到本域 Cookie/存储；https 部署用 SameSite=None+Secure，http 实验域退回 Lax；路径不解析出包外；不挂应用中间件、不带平台会话
runtime.js[AN8M]: F:N·默认关闭的 P09 运行时装配：开关解析、实例身份、任务上下文发行方、edu 服务凭据、隔离预览域与受限账本就绪核验，组合账本存储+来源读取+授权校验+编排 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/src/services/websiteArtifact/taskGrant.js,code:backend/src/services/websiteArtifact/snapshot.js,code:backend/src/services/websiteArtifact/service.js,code:backend/src/server.js | A:createWebsiteArtifactRuntime/bootstrapWebsiteArtifacts/resolveSwitch/probeLedger/verifyClient | S:P09_WEBSITE_ARTIFACTS_ENABLED 未设或 false 关闭且零副作用，其他值配置错误；无发行方时端点存在并一律拒绝；P09_LAB 仅 development/test，production 直接拒绝；实例名须与 IDENTITY_DEPLOYMENT_INSTANCE_KEY 一致；账本角色不得为应用账号；预览域不得与应用同源
service.js[AN9L]: F:N·P09 源侧编排：任务关联与撤销、来源变化事件、不可变评阅版本、当前状态与增量读、短时私有评阅会话与逐次重核 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/src/services/websiteArtifact/snapshot.js,code:backend/src/services/websiteArtifact/errors.js,code:backend/src/models/User.js,code:backend/src/routes/websiteArtifacts.js | A:link/unlink/freezeRevision/noteSourceChange/state/events/ownerLinks/openReviewSession/consumeHandoff/resolvePreview | S:学生身份=会话账号 uuid 与上下文 uuid 相等且 uuid_source='sso'，绝不按姓名/组名/数字 id 匹配；实践不记录"已提交"，提交是 edu 的事务；事实不可变，fact_id 含内容摘要故同字节重存重放同一事件；一次作业一个主作品、一个项目一个作业；过期/撤销/删除立即停访问
snapshot.js[DN7S]: F:N·读本人项目页面得出来源事实与不可变包：有效保存判据、内容摘要、按编辑器同一编译器渲染、入口页固定为 index.html、外部依赖只登记不冻结 | R:code:backend/src/models/HtmlPage.js,code:backend/src/models/HtmlProject.js,code:backend/src/services/websiteArtifact/service.js | A:createSourceReader(load/facts/render/bundle/effectiveSave) | S:有效保存=正文≥64字节且创建后至少保存过一次(≥1s)，否则编辑器打开空项目自动建的空白模板页会被误判成制作中；快照 frozen_scope=pages_only，/uploads 与外链只计数登记
sourceHook.js[CN4T]: F:N·网页编辑器写入成功后的 P09 通知点：运行时关闭或项目未关联即空操作，失败只记日志不影响学生保存 | R:code:backend/src/controllers/HtmlEditorController.js,code:backend/src/services/websiteArtifact/service.js | A:noteWebsiteArtifactChange(req,{projectId,deleted}) | S:绝不让 P09 的问题使保存失败；不在此判权限，一切由服务层按所有者复核
store.js[PN8L]: F:N·P09 账本候选（八表）：opaque 对象引用、关联、不可变版本与字节、提交序事件、评阅会话与幂等记录；导出 DDL 与最小权限授权语句 | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js,code:backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js | A:WebsiteArtifactStore(transaction/read),TABLES,SCHEMA,restrictedRoleGrants | S:event_seq 由同事务内加锁计数器发放=提交顺序，无空洞无迟到可见，消费方据此推进水位；对象引用按(实例,类型,本地id)一次铸造，两实例同号对象不相撞；驱动错误一律归一为 storage_unavailable，不外泄
p09-website-artifact-source-candidate.md[SN6M]: F:N·P09 源侧首包交付文档：先核的接入事实(C05/学校映射/C06/编辑器/实例)、信任链与严格拒绝、已实现能力表与状态口径、隔离验收覆盖、剩余缺口 | R:code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/routes/websiteArtifacts.js,code:frontend/src/components/htmlEditor/TaskArtifactPanel.jsx,code:dev/p09-lab/check.py | A:- | S:候选未冻结未发布；C05 未实现、学校映射列未入库是本包的前提事实；任务上下文走 URL 片段是实测发现(query 会随 Referer 进访问日志)
TaskArtifactPanel.jsx[AU7S]: F:N·网页编辑器里的教学任务作品面板：能力关闭即不渲染，选入口页关联、状态与最近保存、生成评阅版本、打开隔离预览、取消关联 | R:code:frontend/src/utils/api.js,code:frontend/src/pages/htmlEditor/HtmlEditor.jsx,code:backend/src/routes/websiteArtifacts.js,code:frontend/src/main.jsx | A:TaskArtifactPanel,captureTaskContext,setTaskContext,loadCapability | S:任务上下文只从 URL 片段取、启动即清、只在内存不进 localStorage；请求体不带作业或学生身份；面板从不显示"已提交"，提交在 edu；双击由 ref 锁防重
```

## 受影响对象（stale，只需按下列改动重写既有条目）

| 仓内路径 | source_sha256 | 本包改动 |
|---|---|---|
| backend/src/app.js | b9b43ed57af507dbb7e79eda9ca4008c448513cfe156008183b59a88bb07d10d | 增挂 `/api/p09/website-artifacts` 与 `/api/integrations/edu/website-artifacts` |
| backend/src/server.js | 557d3d69e48b88d816ae9f0fdd44314adf9a27f82eb244d7da08e8b4508287cb | 引导默认关闭的 P09 运行时与隔离预览监听器，并在关闭流程释放 |
| backend/src/controllers/HtmlEditorController.js | d44ac496be8f7731ba05f97b9f91b6815bd5333c72bb62bb3c615165dbfebae3 | 五处写入成功后调用 `noteWebsiteArtifactChange`；删除页面前取所属项目 |
| frontend/src/main.jsx | 0426dd4b2857d646658d3914ccba07596ff20721be1855b58356d141878d9b37 | 应用启动前从 URL 片段取走并清掉任务上下文 |
| frontend/src/pages/htmlEditor/HtmlEditor.jsx | 64eece44975be2b14cd4221778cc230a1202c59d54fbb2a39a6dbd483ea9918d | 在页面列表下挂 `TaskArtifactPanel` |
| frontend/src/locales/zh-CN/htmlEditor.json | 725acfa771b2b11349abfec62d5114a3224cc6b53eb402a13a2b61c74de9c386 | 新增 `htmlEditor.p09.*` 48 键 |
| frontend/src/locales/en-US/htmlEditor.json | 7f2ffc931964153df92b05b8cc5bbee828583d7b53708ddf8ddce89553b15674 | 同上（键集与中文一致） |

测试与实验文件按既有 Managed Scope 只 observe：`backend/src/__tests__/**`、`dev/p09-lab/**`、`frontend/src/__tests__/**`。
