# 公文模板（样例即模板）开发说明

老师上传一份单位的 Word 公文当样板，系统保留它的页面设置、页眉页脚、样式表、编号、主题；老师给样板的段落贴角色，
之后对话画布里 AI 写的 Word 产物，或老师自己的草稿（.docx / 粘贴文字），按角色套进去生成同样版式的 .docx。

## 数据与文件
- 表 `doc_templates`（迁移 `backend/migrations/20260916_001_create_doc_templates.js`）：所有者/组、名称、`file_path`、`block_count`、`roles` JSON `[{index, role}]`、`summary` JSON（页面尺寸/边距、页眉页脚文字、各角色字体字号）、`scope`（private | group）、使用次数。
- 文件在 `storage/uploads/doc-templates/<uuid>.docx`（uploads 目录两站都持久化；文件名不可猜；下载走鉴权接口，不给直链）。

## 引擎 `backend/src/services/docTemplate/docxEngine.js`（纯函数）
- `inspectDocx(buffer)`：列出正文顶层块（段落/表格，序号只数这两种），每段解析对齐、首行缩进、字体、字号、加粗、颜色（run → 段落样式链 → docDefaults），加页面与页眉页脚摘要。
- `guessRoles(blocks)`：找最长的"正文区"（首行缩进或够长的连续段落，含 一、/（一）/1. 开头的标题），正文前以冒号结尾的短行是主送机关、再往前最近的居中大字段是标题，正文后日期正则命中的是成文日期、其前短行是落款、"附件："开头是附件说明；其余（红头、发文字号、版记）固定。
- `fillDocx(buffer, roles, content)`：固定块原样保留；每种角色第一个块当原型，克隆其 pPr 与首个 run 的 rPr 换上新文字（加粗/斜体按 rPr 规定顺序插入）；正文块支持 paragraph / heading(1-3，缺原型用正文加粗) / list（前缀 "1. " 或 "•"）/ table（单线表，列宽按页面内容宽平分，表头加粗）；样板里没有的角色原型时，标题/主送挂在正文前、附件/落款/日期挂在正文后并用正文格式；clone 段落去掉 w14:paraId。
- `extractDraft(buffer)`：草稿本身是完整公文时先按 guessRoles 拆（红头/版记不带进内容），否则按"首段居中或加粗是标题、冒号结尾是主送、末尾日期、日期前短行是落款"。
- 角色：fixed | title | recipient | body | h1 | h2 | h3 | attachment | signer | date | delete。

## 接口 `/api/doc-templates`（`routes/docTemplateRoutes.js`，需登录）
`GET /`、`POST /`(multipart file + name/description/scope)、`GET /:id`(带段落)、`PATCH /:id`(name/description/scope/roles)、`DELETE /:id`、`GET /:id/file`、`POST /:id/render`({content, filename} → .docx)、`POST /:id/preview`({content} → {html}，mammoth 转的正文，不含页眉页脚)、`POST /extract-draft`(file 或 text → {content})。
content 形状：`{title, recipient, blocks:[{type:'paragraph'|'heading'|'list'|'table', runs|level|items|rows}], attachments:[], signer:[], date}`；读 = 本人 / 同组且 scope=group / 超管，写 = 本人。

## 前端
- `utils/docTemplate/markdownToBlocks.js`：画布 docx Markdown → content（remark 解析，软换行拆段；字段按公文习惯猜：一级标题=标题，冒号结尾短行=主送，末尾日期，日期前短行=落款，"附件："段=附件）；`textToContent` 处理粘贴文字（无 # 时首行短句当标题）。
- `stores/docTemplateStore.js`；组件 `components/docTemplate/`：`RoleLabeler`（贴角色表）、`ApplyPanel`（选模板/字段/预览/下载）、`DocTemplateManager`（弹窗：模板库/上传样板/套用到我的草稿）、`DocTemplateApplyModal`（画布入口）。
- 入口：对话输入区"公文模板"按钮（PC 端）打开模板库；画布 Word 产物工具栏"套模板"按钮打开套用弹窗。
- 后端 `outputFormatInstructions` 的 docx 指令加了第 5 条：写公文时按标题/主送/正文/附件/落款/日期的结构输出，前端才能猜对字段。

## 验证
- `cd backend && npx jest src/__tests__/unit/services/docTemplate`（11 项，样板由 `src/__tests__/helpers/docxFixture.js` 手写 OOXML 生成）
- `cd backend && node scripts/doc-template-smoke.cjs`（37 项，真实 HTTP：上传/猜角色/改角色/权限/生成/预览/草稿/删除）
- `cd frontend && npx vitest run src/__tests__/unit/docTemplate`（6 项）
- Playwright 走查脚本在会话 scratchpad（e2e/doctpl-e2e.cjs）：上传→贴角色→保存→草稿套用→下载校验。

## 已知限制
- 预览只有正文（mammoth），页眉页脚与字体以下载的文件为准；样板里的文本框、艺术字、印章图片只能作为固定块保留。
- 生成的表格是单线表，不会沿用样板里表格的样式；列表只做前缀，不接样板的自动编号。
- 字段猜测是启发式的，猜错在套用面板里改；AI 写公文时靠输出指令保证结构。
