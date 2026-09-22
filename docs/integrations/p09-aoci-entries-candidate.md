# P09 认知索引条目候选（待合入主工作副本后由 aoci_maintain/aoci_update_entry 正式写入）

本分支在独立 worktree `~/ai-platform-p09-20260922` 开发，而本会话的 AOCI MCP 服务绑定在主工作副本
`~/ai-platform`（Volumes v1 只能经 MCP 写入，CLI 的 `index agent plan/update-entry` 对 v1 返回
`该命令或兼容写入路径不支持修改Volumes v1正式认知`）。因此 **本包没有、也不能在本会话把这些条目写进正式索引**：
下面是按当前 Meta 字典（`aoci.meta.txt`）预先创作好的完整条目与绑定摘要，合入主副本后调用一次
`aoci_maintain` → `aoci_update_entry`（批次内逐条带 `source_sha256`）即可对齐，届时以机器签发的候选身份为准。

`aoci check`（在本 worktree 运行）当前报告：15 条 missing、7 条 stale、observed_pending（测试目录只 observe）。
接续单 CTRL-20260922-PRACTICE-P09-RELIABILITY-01 在同一 worktree 继续，因此下表的正文与摘要是**接续后的最终状态**（新增 `assets.js`、`eligibility.js`，并重写了 service/snapshot/store/previewServer/runtime/sourceHook/面板/交付文档六条以上条目的语义与约束位）。

## 新增对象（missing）

| 仓内路径 | source_sha256 |
|---|---|
| backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js | ec84f6773d43d654cf72da6c8f2ce090f92cac75fa1e4ea7532ca4c6bbab4fdb |
| backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js | 41fd6d3d5a5754c09395726258b03ef8496420fc3d856c154f71fc33fc71f29f |
| backend/src/routes/websiteArtifacts.js | cf0d2bcfbf8fefbf923e3de684c8ff32b808dd02aa8fada3039d28115046eb88 |
| backend/src/services/websiteArtifact/assets.js | 41c40a5e27f2b04e3319c58192b9636d308a10368b47db6d6b0c25a09236494e |
| backend/src/services/websiteArtifact/eligibility.js | c9d64e20b65b5d65eed8e289a2852b43898bcb9a73f0f7847176f2d2a68f0e11 |
| backend/src/services/websiteArtifact/errors.js | e79cc85714f34fb00df0b2216a3cf788878b9c99129f0dbd679ea4141373d82b |
| backend/src/services/websiteArtifact/previewServer.js | 81234d02987fa2cb11ebbc419d0f3f778e86c9b0706e6187dd8192c26a5309bb |
| backend/src/services/websiteArtifact/runtime.js | e3afc843c9d930ff5bee81e301b653bc63dfc5069d21dd2c22e41bed42be2b96 |
| backend/src/services/websiteArtifact/service.js | 39e1418a50fee259962854b6eee44a7f535972e3f72c98b3e902ec4bb717e8a0 |
| backend/src/services/websiteArtifact/snapshot.js | db93d230d7e989729aeb9d8efe1fe82172d3c88be4dc1ccc2217ba0d33f46a72 |
| backend/src/services/websiteArtifact/sourceHook.js | d651a041eab70dcada1ef7d16c9bf7ea48e9be18f8b2beb373142e351e26a8b9 |
| backend/src/services/websiteArtifact/store.js | ef9667c53223aa082ab3244bd11306ccf535ec14343598bf7aff619ffb115c2c |
| backend/src/services/websiteArtifact/taskGrant.js | b21c74c93c338d9aeed66b75565671ea7050f941d65a199061f5d4f953707ca5 |
| docs/integrations/p09-website-artifact-source-candidate.md | 31f2dee96d38c88deb479a362447e036af7e4bc46b5d96b9711f6943e3290a90 |
| frontend/src/components/htmlEditor/TaskArtifactPanel.jsx | d20ace9464d0e95c1dd998e124e59d0e164af48219c3f882ed0a886806bfeb58 |

```
20260922_001_p09_website_artifacts.js[PD6T]: F:T·P09 网站作品账本八表的 knex 迁移候选：up 逐字重放 websiteArtifact/store.js SCHEMA，down 按外键顺序删表；位于候选目录不被 knex 扫描 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/knexfile.js,code:docs/integrations/p09-website-artifact-source-candidate.md | A:exports.up/down/tables | S:进入 backend/migrations/ 即在下次 make deploy-docker 自动建表，授权前不得晋级；down 丢账本与固定版本字节须先备份
20260922_002_p09_write_sequence.js[PD4T]: F:T·P09 账本候选迁移 002：只为既有库补 write_seq/applied_write_seq，两列都在即空操作，两列都缺一条语句补齐，半状态按保守方向处理 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js,code:dev/p09-lab/migration-replay.py | A:exports.up/down/columns | S:迁移只加缺的列，绝不替业务对账宣布完成——重复执行必须保住 write_seq 与 applied_write_seq 的差值(欠账)；半状态修复先打标记后丢无法验证的声明，applied>write 是"修复被中断"的指纹，up 进来先找它并接着做完；down 先把只存在于计数里的欠账写成标记再删列；半状态修复前两次采样账本，有变动即具名拒绝 p09_ledger_busy_during_half_state_repair 且不改任何字节；从不清除已有 sync_pending_at；仍在候选目录，晋级是另一次授权
websiteArtifacts.js[EN8M]: F:N·P09 两个 HTTP 面：学生端关联/撤销/生成评阅版本/自建预览会话，edu 服务端当前状态、增量事件、提交冻结与评阅会话；统一请求 ID 与安全错误信封 | R:code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/services/websiteArtifact/service.js,code:backend/src/middleware/authMiddleware.js,code:frontend/src/components/htmlEditor/TaskArtifactPanel.jsx,code:backend/src/app.js | A:/api/p09/website-artifacts/{capability、links[/:id/{unlink、revisions、preview-sessions}]},/api/integrations/edu/website-artifacts/{state、events、revisions、review-sessions} | S:运行时未开启一律 503 website_artifacts_disabled；作业与学生身份只来自签名任务上下文请求头，请求体未知字段拒绝；edu 面按静态服务凭据签名(方法+路径+排序query+体摘要)与 school_refs 授权；16KiB 严格 JSON
errors.js[CN5T]: F:N·P09 固定错误分类：P09Error/fail 与面向运维的中文短句表（任务上下文、来源、评阅会话、游标、基础设施） | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/routes/websiteArtifacts.js | A:P09Error,fail,MESSAGES,message | S:message 不含请求原文、他平台标识、凭据或堆栈；码即契约面，改动须同步 edu 消费方
previewServer.js[EN8S]: F:N·隔离预览域：独立监听器(可自终结 TLS)，Host 不符即 404；引导页从 URL 片段取一次性 handoff 并 POST 兑换 HttpOnly Cookie，再按会话逐次校验后输出页面与资源字节 | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/server.js | A:GET /p09/preview/open,POST /p09/preview/exchange,GET /p09/preview/:sessionId/*,createPreviewApp,startPreviewServer,clientBinding | S:handoff 只在片段里故不进访问日志/Referer；兑换把会话绑定到该浏览器指纹(防转发，不是身份认证)；CSP sandbox 不给 allow-same-origin，源列表写隔离域真名而非 'self'(不透明来源下 'self' 谁都不匹配会挡住作品自己的图片样式)；https 用 SameSite=None+Secure，否则退回 Lax
runtime.js[AN8M]: F:N·默认关闭的 P09 运行时装配：开关解析、实例身份、任务上下文发行方、edu 服务凭据、评阅资格提供方、上传根与资源解析器、隔离预览域与受限账本就绪核验，并起有界后台清扫 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/src/services/websiteArtifact/taskGrant.js,code:backend/src/services/websiteArtifact/assets.js,code:backend/src/services/websiteArtifact/eligibility.js,code:backend/src/services/websiteArtifact/service.js | A:createWebsiteArtifactRuntime/bootstrapWebsiteArtifacts/resolveSwitch/probeLedger/verifyClient | S:P09_WEBSITE_ARTIFACTS_ENABLED 未设或 false 关闭且零副作用，其他值配置错误；无发行方或无资格提供方时端点存在并一律拒绝；P09_LAB 仅 development/test；实例名须与 IDENTITY_DEPLOYMENT_INSTANCE_KEY 一致；账本角色不得为应用账号；预览域不得与应用同源；清扫周期有界(P09_SYNC_INTERVAL_MS/P09_SYNC_VERIFY_MS)
service.js[AN9L]: F:N·P09 源侧编排：任务关联与撤销、观察到的保存与变化号、可恢复对账与有界清扫、不可变评阅版本、当前状态与增量读、短时私有评阅会话与逐字节重核 | R:code:backend/src/services/websiteArtifact/store.js,code:backend/src/services/websiteArtifact/snapshot.js,code:backend/src/services/websiteArtifact/eligibility.js,code:backend/src/services/websiteArtifact/errors.js,code:backend/src/routes/websiteArtifacts.js | A:link/unlink/freezeRevision/recordSourceWrite/reconcileLink/sweep/syncStatus/state/events/openReviewSession/consumeHandoff/resolvePreview | S:学生身份=会话账号 uuid 与上下文 uuid 相等且 uuid_source='sso'，绝不按姓名/组名/数字 id 匹配；制作事实只认编辑器保存路径写正文，证据不足报 unknown 及原因不猜未开始；变化号与内容摘要分开故 A→B→A 出三条事实而重试不重复；每个预览字节重核会话绑定/关联/所有者账号/发行方/资格，固定版本字节同样不绕过；实践不记录"已提交"
snapshot.js[DN7S]: F:N·读本人项目页面得出来源观测与不可变包：内容摘要、按编辑器同一编译器渲染、入口页固定 index.html、页面平铺并改写项目内链接与资源引用、冻结获准读取的本地资源、外部依赖只登记 | R:code:backend/src/models/HtmlPage.js,code:backend/src/services/websiteArtifact/assets.js,code:backend/src/services/websiteArtifact/service.js | A:createSourceReader(load/facts/render/renderForPreview/bundle/pageFileFor) | S:此处不判定"学生保存过"(时间戳分不出学生保存与编辑器自动建页)，只给 source_ever_updated 供服务层判未知；frozen_scope=pages_and_owned_local_assets，拒绝一律具名进 manifest，外链不冻结也不拉取
sourceHook.js[CN4T]: F:N·网页编辑器写入成功后的 P09 通知点：先等待写入耐久标记与真实保存事实，再异步对账；运行时关闭或项目未关联即空操作 | R:code:backend/src/controllers/HtmlEditorController.js,code:backend/src/services/websiteArtifact/service.js | A:noteWebsiteArtifactChange(req,{projectId,deleted,contentSave}) | S:绝不让 P09 的问题使保存失败；contentSave 由控制器按本次请求实际写了什么判定(创建与纯改名不算)，不信请求体声明；标记先落库故崩溃只会留下待对账而非永久陈旧投影
store.js[PN8L]: F:N·P09 账本候选（八表 v2）：opaque 对象引用、关联(含保存证据/变化号/待对账/受众绑定列)、不可变版本与字节、提交序事件、评阅会话与幂等记录；导出 DDL 与最小权限授权语句 | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js,code:backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js | A:WebsiteArtifactStore(transaction/read),TABLES,SCHEMA,restrictedRoleGrants,Tx(recordRealSave/pendingLinks/staleLinks/consumeSession) | S:event_seq 由同事务内加锁计数器发放=提交顺序，无空洞无迟到可见；两条 STORED 生成列唯一键保证"一学生一作业一作品"与"一项目一当前作业"，撤销后为 NULL 故可重关联且历史保留；consumeSession 是条件更新，先到者赢；驱动错误一律归一为 storage_unavailable
p09-website-artifact-source-candidate.md[SN6M]: F:N·P09 源侧交付文档：先核事实(C05/学校映射/C06/编辑器保存信号/上传归属模型/实例)、信任链与严格拒绝、制作事实三值、关联约束、固定版本范围、增量补齐与私有评阅受众、隔离验收、剩余缺口、edu 消费输入 | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/assets.js,code:backend/src/routes/websiteArtifacts.js,code:dev/p09-lab/check.py | A:- | S:候选未冻结未发布；C05 未实现且本包的独立签名上下文不是 C05；浏览器绑定只防转发不证明教师身份；留存期未定故不自动清理证据
TaskArtifactPanel.jsx[AU7S]: F:N·网页编辑器里的教学任务作品面板：能力关闭即不渲染，选入口页关联、状态与制作事实(含未知及原因)、生成评阅版本、打开隔离预览、取消关联 | R:code:frontend/src/utils/api.js,code:frontend/src/pages/htmlEditor/HtmlEditor.jsx,code:backend/src/routes/websiteArtifacts.js,code:frontend/src/main.jsx | A:TaskArtifactPanel,captureTaskContext,setTaskContext,loadCapability | S:任务上下文只从 URL 片段取、启动即清、只在内存不进 localStorage；请求体不带作业或学生身份；has_effective_save 三值故只在明确 false 时禁用生成评阅版本；面板从不显示"已提交"
assets.js[SN7S]: F:N·固定版本的本地资源：按真实归属模型(files/user_files/html_resources)证明文件属于本人，再在上传根内不跟随符号链接地读取字节，超限或证明不了一律具名拒绝 | R:code:backend/src/services/websiteArtifact/snapshot.js,code:backend/src/services/websiteArtifact/runtime.js,code:backend/src/models/UserFile.js | A:createAssetResolver(resolve/collect/classify),TYPES,MAX_ASSET_BYTES,MAX_ASSETS | S:只按路径存在一律不复制(ownership_unproven)；对象存储的字节不下载(remote_object_storage)；O_NOFOLLOW+realpath 包含性拒绝符号链接逃逸与路径穿越；不发任何网络请求故无 SSRF 面；类型白名单挡住视频/压缩包/可执行
eligibility.js[AN5T]: F:N·评阅资格提供方接口：未配置即接口存在并一律拒绝，实验静态名册仅 development/test；每次访问重问，不缓存成"已核" | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js | A:createEligibilityProvider,absentProvider,reviewerHash | S:一张已消费的票不代表持续资格；教师引用按 issuer+ref 哈希比对，不保存 edu 本地 id；cache_ms 上限 60s 且默认 0
```

## 受影响对象（stale，只需按下列改动重写既有条目）

| 仓内路径 | source_sha256 | 本包改动 |
|---|---|---|
| backend/src/app.js | b9b43ed57af507dbb7e79eda9ca4008c448513cfe156008183b59a88bb07d10d | 增挂 `/api/p09/website-artifacts` 与 `/api/integrations/edu/website-artifacts` |
| backend/src/server.js | a9ad729047644f71204451a0d725c97569f3e91b4a895f997eddd49e48d5ca86 | 引导默认关闭的 P09 运行时与隔离预览监听器（可自终结 TLS，Cookie 的 Secure 跟随隔离域协议），并在关闭流程释放 |
| backend/src/controllers/HtmlEditorController.js | 5c40118ea6c26a97dd2edbc746ef88e00c632076a3fb7ed242ad13f4f7eeb269 | 五处写入成功后 `await noteWebsiteArtifactChange`（更新页面另按本次请求是否真写了正文传 `contentSave`）；删除页面前取所属项目 |
| frontend/src/main.jsx | 0426dd4b2857d646658d3914ccba07596ff20721be1855b58356d141878d9b37 | 应用启动前从 URL 片段取走并清掉任务上下文 |
| frontend/src/pages/htmlEditor/HtmlEditor.jsx | 64eece44975be2b14cd4221778cc230a1202c59d54fbb2a39a6dbd483ea9918d | 在页面列表下挂 `TaskArtifactPanel` |
| frontend/src/locales/zh-CN/htmlEditor.json | 4e22f1b27ecc023e47cacdf02d66c7fb3a6c23bee5dcd8044547a6bcdadc1526 | 新增 `htmlEditor.p09.*` 62 键（含 `state.unknown` 与制作事实/资格/绑定相关文案） |
| frontend/src/locales/en-US/htmlEditor.json | 441242600a1e47dc813290a40187781a4e30e144690637e1920aa45228b55420 | 同上（键集与中文一致） |

测试与实验文件按既有 Managed Scope 只 observe：`backend/src/__tests__/**`、`dev/p09-lab/**`、`frontend/src/__tests__/**`。
