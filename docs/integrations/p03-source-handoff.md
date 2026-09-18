# P03 教师选定成果：源侧第一单

日期：2026-09-18。基线：`4a2b00e`（保留该导航改动及之前已完成的发布）。本次是源侧开发/模拟验证，没有发布到两个生产站点，没有数据库迁移。

## 规划与交付边界

依据 `/home/hanying/pkuailab-ws/CLAUDE.md`、docs/00、docs/06 §8、docs/05 适用前提、docs/14 P01/P03、docs/15、docs/20 §5/§7、contracts/00。未发现本仓独立旧 HANDOFF 文件；以当前用户派单和 docs/20 为交接。

P03 → I03 → T11 将教师选中的实践成果转入 TE-DNA 个人资料，再供备课/课件使用，已纳入北极星 R1。TE-DNA → 实践聊天选用资源也在 docs/15，属于后续反向接入。本次不建设实践侧资源库、共识库或备课工坊，不实施反向检索。

北极星五问：

1. 助手回答成为有来源、版本和准确范围的参考资料候选，尚非正式 C/E 认知条目。
2. 改善材料选择和来源核对；明确选中内容与未选内容。
3. 守住本人访问、附件权限、来源版本、私有默认值及正文边界。
4. 只做确定性范围选择和快照，不新增模型总结，不把 AI 原文变成已核实事实或教师共识。
5. 为老师省去跨平台复制、下载再上传的重复工作；真正一键入库需后续 I03/T11 联调。

## 已有能力与复用盘点

| 对象 | 当前身份与版本 | 当前导出与本单处理 |
|---|---|---|
| 聊天消息 | `messages.id` UUID、`conversation_id`、角色、状态、`created_at`、可有 `model_name`；原文可更新，没有不可变修订号 | 现有 Chat 的导出遍历全部消息；P03 仅复用 Message/Conversation 读取和下载工具，不调用全会话导出。仅选择本人未清空会话的 completed 助手回答 |
| 回答中的方案、代码/画布源码 | 来源是消息与内容位置；浏览器画布块不是额外稳定的后端作品 ID | 现有 htmlBlockParser、HtmlCanvasPanel 可导出 HTML、打印 PDF、生成 PPTX/DOCX。首单保存选中原文及围栏代码；不运行 HTML，不声称已生成并取得 PPTX/PDF 文件 |
| 聊天上传附件 | `files.id` UUID、`user_id`、状态、磁盘路径；`file_ids` 兼容 `file_id`；无不可变修订号 | 首批只认本条消息关联、本人所有、ready、可读的 UTF-8 TXT/Markdown。内容摘要按实际字节计算；不得用 URL 或 `extracted_content` 替代真实文件 |
| HTML 作品 | `html_pages.id`、`user_id`；更新时 `version = version + 1` | 已有独立编辑、发布和导出能力；本单没有接入独立 HTML 作品。后续单独适配版本与隔离预览 |
| 独立导图 | `user_mindmaps.id`、`user_id`，更新 `updated_at`；Markdown/Mermaid/SVG 内容 | 已有保存、分享与按导出类型计费；本单不改权限或计费，不通过聊天入口绕过独立作品规则 |
| 图片/视频生成 | 各自记录 ID、`user_id`、状态、文件/URL，图像可带 parent_id；记录可更新 | 本单不抓取远程媒体，不把公开 URL 当授权证明。后续按文件归属、持久保存权限、版本和真实格式逐种适配 |
| 普通网页链接 | 仅链接字符串 | 作为所选原文中的文字保留；不请求网页，不宣称已取得正文，不在快照预览中加载外部图片 |

文件权限与支持格式分开判断：非本人/不存在/已失效只显示不可访问，不泄漏他人文件名或路径；本人 HTML/图片/PDF/Office 等目前显示不支持。TXT/Markdown 最多 3 个、各 64 KiB，回答最多 128 KiB；清单预览只检查前 20 个关联文件，超出明确提示且不导出。远程路径、逃逸上传目录、非 UTF-8、超限文件拒绝。

## 源侧行为

- 聊天回答下的开发入口打开准确原文，可选整条或连续片段；先预览文本及勾选附件，确认一次固定快照。thinking/think 段不进入回答正文；未闭合段拒绝处理。HTML/Markdown 均以纯文字核对，不执行脚本。
- 服务端重新取源，不接受客户端提交的正文、身份或会话历史。预览版本及所选附件版本变化时返回 `source_changed`；不会偷偷改成最新内容。
- 消息内容版本为 SHA-256 指纹，不能当数据库修订计数。冻结后的字节不随源编辑改变；读取、下载、授权、发送仍校验本人源权限、清空状态及所选附件可用性。
- 本地冻结是待交接缓存，不等于 TE-DNA 的持久副本授权。源删除/撤权/附件失效后不再从源侧读取或交接；不能承诺收回已下载副本。真实接收后的保存/删除/派生撤回规则由三方定稿。
- 同一人、来源版本、选择位置、内容和模拟目标共用快照/逻辑操作；更换 HTTP 幂等键或重复点击不新建副本。仅用途改变保留首次用途，并提示复用；不自动生成教案。显式“另存为新对象”尚未实现。
- 私有开发暂存 `storage/private/p03-dev/state.json`，0700 目录/0600 文件、原子替换/fsync、同进程串行事务。24 小时逻辑有效期，每次访问清理过期项；服务停止时不承诺物理定时删除。每账号最多 50 个快照。该单进程文件存储仅为可重启的开发证据，不是多实例生产持久层。
- 复用 `utils/canvas/download.js` 导出所选 `.md`，或含清单与勾选文本附件的 `.json`。下载前重新验证权限；JSON 不含源账号 ID、他平台账号 ID、JWT、凭据或磁盘路径。

## 开发入口与本地运行

无需真实数据库、账号或 Identity 的合成演示：

```bash
cd /home/hanying/ai-platform
node dev/p03-demo.mjs
# 打开 http://localhost:3004/dev/p03.html
```

普通演示页复用主站 ThemeProvider 和平台样式，只展示成果选择、准备与下载。来源哈希、范围偏移、不可用附件诊断、JSON 清单及模拟授权/收发仅在显式测试地址 `http://localhost:3004/dev/p03.html?p03Debug=1` 的开发详情区提供；普通界面没有调试入口。此参数仅控制开发界面展示，不代替任何服务端权限检查。

此演示复用实际 MessageContent、P03 界面、源适配器和快照服务；只将模型读取与认证替换为固定合成来源/模拟账号，监听 loopback。合成状态位于 `storage/private/p03-demo`，与真实本地应用的开发暂存分开。`node dev/p03-demo.mjs --fresh` 只清除这份合成接收状态，便于重复浏览器测试；没有访问真实教师数据库。

接入本地已有聊天时，后端启动环境设置 `NODE_ENV=development P03_DEV_ENABLED=true P03_DEV_USER_IDS=<本地测试账号ID列表>`，沿 `dev/README.md` 启动 `backend/src/server.js`；前端启动时设置 `VITE_P03_DEV_ENABLED=true`。这些是本机测试开关，不是教师资格、跨平台身份或正式协议。

两端默认均关闭。生产构建以 `import.meta.env.DEV` 硬隔离懒加载入口；即使 VITE 开关误设 true 也不包含功能代码。后端仅明确的 development/test 环境且开关 true 才挂载 `/api/dev/p03`。普通 user/admin/super_admin 都必须列入本地测试名单，并受相同的本人来源校验，不存在管理员导出别人会话的豁免。

## 内部原型接口（不作为正式线上契约）

| 本地路径 `/api/dev/p03` 下 | 作用 |
|---|---|
| `GET /messages/:id` | 读取本人单条回答的可选正文、来源版本、附件实际能力；给出本来源最近快照 ID 用于恢复 |
| `POST /snapshots` | 依据 `message_id / expected_version / selection / attachments / purpose` 冻结；请求不接正文 |
| `GET /snapshots/:id` | 核对当前权限后返回固定清单和字节，用于预览/下载 |
| `POST /snapshots/:id/authorize` | 仅签发本地模拟授权，可模拟有效/过期/撤销；不调用 Identity |
| `POST /snapshots/:id/deliver` | 向进程内假接收方发送，可模拟正常、暂不可用、已接收但丢失响应 |
| `GET /snapshots/:id/status` | 查询源侧状态；未知结果通过重试同一操作恢复 |

POST 必填 `schema_version: 1`、UUID `Idempotency-Key`，JSON 单对象/未知字段拒绝/16 KiB 上限/不带 query；每个响应有服务端 request_id、no-store、no-referrer，错误信封只给安全错误码和中文短句。测试区单独解析、限流，在常规请求日志前处理，正文、模拟授权和幂等键不进日志。真实本地应用仍复用现有 authenticate 的会话、停用、账号有效期校验；不得把请求体身份当主体验证。

假接收方只接 `{manifest,payload}`，没有网络客户端与正式 TE-DNA 接口配置。其已接收记录独立于源操作状态持久化；响应丢失后，过期/已用凭据不影响对已完成操作的同主体结果核对，仍检查源侧访问。恢复不会重建资源。界面结果始终明确“模拟接收方已接收；未写入 TE-DNA”。

## 提交给同一 I03/P03/T11 草案的内容贡献

版本：`p03-content-proposal-20260918.1`，状态：**P03 内容贡献，待 I03/T11 汇入与核对**。共同主笔是 Identity I03：`/home/hanying/pkuailab-ws/docs/integration-drafts/teacher-artifact-handoff.md`。本单不抢写共同文件、不自行编号、不将内部字段冻结为正式契约。

合成样例见同目录 `p03-synthetic-packet.json`。字段建议：

| 字段 | 意义与待对齐点 |
|---|---|
| source | practice / assistant_message / 本平台对象 UUID / conversation UUID / 内容版本；真实有记录的生成时间、模型名，未知为 null；不含账号映射 |
| locator | `answer_without_thinking_utf16` + 左闭右开 start/end；明确基于去 thinking 后的回答，不是字节偏移。正式多格式 Locator 需 T02 对齐 |
| format、byte_length | Markdown 原文字节数；不把围栏 HTML 冒充独立可执行作品 |
| content_sha256 | 本地按固定字段顺序 JSON.stringify(payload) 的 UTF-8 字节计算；正式跨语言规范化、签名/摘要绑定规则待 I03/T11 决定，不让 Go 接收方猜序列化顺序 |
| summary | `verbatim_excerpt`，所选内容前 160 个 Unicode 码点；不是模型总结或事实核验 |
| purpose | reference / lesson_preparation / courseware；仅意图，不表示已进入工坊或已生成成果 |
| visibility、material_status | private / ai_output_unreviewed；任何共享/正式共识须另有教师明确操作 |
| attachments | 勾选附件的源 ID、名称、真实格式、字节数、内容版本；payload 仅含其实际文本，不含磁盘路径/公开 URL/未选附件 |
| web_links | `references_only_not_fetched`，普通链接没有正文抓取证明 |

I03 需确认：同一教师两端关联与停用处理、实际动作允许表及目标限制；授权绑定源/版本/选择/内容摘要/用途的方式；一次性凭据与业务幂等分离；已接受结果查询、超时与撤权时序。Identity 不接正文。

T11/T02 需确认：当前个人资源接收类型及私有资源 ID/版本/派生引用落点；文本与附件格式、大小、UTF-8/摘要规范；持久保存副本授权与仅在线引用的区别；源删除、资源删除和隐私撤回语义；用途变化复用资源、打开既有工作空间、显式另存的关系。源 Locator 回源跳转路径需真实双站域名规则确认。

现状证据：只读核对了 TE-DNA `routes_teacher_resources.go`、`teacher_resource.go`；现有库主要承接 component/image/page/agent、使用 TE-DNA 本地登录会话。其正在开发的 `docs/design/T02-resource-references.md` 明确内部资源引用与版本快照，不含本次跨平台接收。未改 TE-DNA 或 Identity 仓、未使用 edu 凭据、未接生产 Identity。资源库已存在不等于本通道已可调用。

收尾时核对了 T02 新回写的 `/home/hanying/pkuailab-ws/docs/integration-drafts/t02-resource-evidence-examples.md`：内部引用使用原生资源 UUID、内容版和文档 Locator，区分 selected/loaded/模型引用；与本单的来源版和用途方向一致。但它尚不提供外部成果接收，不能将 practice UUID 直接当 tedna 资源 ID，也不能把模拟接收当已选入或已被模型读取。共同人级交接主稿此时仍未创建，待 I03 汇入双方贡献。

## P01 前提与验证记录

本单适用：现有会话主体、账号停用/有效期、本人消息及文件访问、默认私有、生产关闭。实际人级教师关联和导出持久副本授权尚未接通，由 I03 定稿后验证。本地 allowlist 只允许测试者，不把 role=user 当已确认教师。

学生 P0/C05/C06/C08、学生论坛/画廊/独立作品域、校籍变更验收不在本单完成声明内。本次未改这些通道，没有把学生消息作为样例，也没有向 C06 传正文；学生接入必要门槛仍沿 P01 原任务核对和补齐。

可重复验证命令：

```bash
cd /home/hanying/ai-platform/backend
npx jest --runInBand --runTestsByPath src/__tests__/unit/services/artifactHandoff.test.js src/__tests__/unit/middleware/authMiddleware.test.js src/__tests__/unit/models/File.test.js
cd /home/hanying/ai-platform/frontend
npx vitest run src/__tests__/unit/components/ArtifactHandoffDev.test.jsx src/__tests__/unit/utils/canvasExport.test.js src/__tests__/unit/utils/htmlBlockParser.test.js src/__tests__/unit/utils/apiFailureCleanup.test.js
cd /home/hanying/ai-platform
VITE_P03_DEV_ENABLED=true make build
# 启动 --fresh 合成演示后，使用本机安装的 Playwright（可通过 PLAYWRIGHT_MODULE 指定模块路径）
node dev/p03-e2e.cjs
```

后端 69 项、前端 32 项通过，其中 P03 定向 25+4 项、公共 API 回归 2 项。覆盖精确内容、源修改/旧版固定、未选内容隔离、并发重复、跨主体/错目标、过期/撤销、附件失效/路径逃逸/实际字节、接收失败、响应丢失与重启恢复、严格请求、生产关门、下载前权限复核。浏览器发现并修正公共 api.js 的未消费 finally 派生拒绝：改为成功/失败均清理控制器，不产生额外未处理 Promise；P03 使用 skipDebugLogging，开发调试也不打印其完整请求体。浏览器及构建证据见本次工作区独立回执。

未验：真实教师/真实作品质量、真实 I03/T11 联调、实际 TE-DNA 保存/资源复用、手机实机、双站部署、持久化数据库及多实例生产运行。合成通过不代表教育效果或学生边界验收。下一单按共同草案对齐后的适用身份能力 → T11 接收 → P03 真实适配/联调推进；反向聊天使用资源另开接续单。
