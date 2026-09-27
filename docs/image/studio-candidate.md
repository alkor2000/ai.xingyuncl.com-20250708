# 图像生成「对话式工作台」：候选包、验证到哪一步、发布前还缺什么（2026-09-27，未发布）

派单 CTRL-20260927-PRACTICE-IMAGE-ACCEPTED-CANDIDATE-01。分支 `codex/media-ux-20260926`，父版本 `2a56c39`（两站 2026-09-26 正在跑的那一版）。

本文只陈述**做了什么、在什么条件下验证过、还缺什么**。不是发布授权：本包没有部署、没有迁移、没有动任何生产配置，也没有碰视频页。

## 1 候选包身份

| 项 | 值 |
|---|---|
| 分支 / 父版本 | `codex/media-ux-20260926`，父 `2a56c39` |
| 提交 | `eb6c59b` 功能 → `849e7d2` 图库白屏修复 → `2ec6dac` 认知索引（12 条） |
| 新依赖 | 无。`package.json` / `package-lock.json` 未改 |
| 数据库 | 未改。无新表、无新列、无迁移 |
| 构建 | vite 5.4.21 / node v22.23.2 通过，`dist/index.html` sha256 `030f0a1465d9c629…`，dist 59M |
| 认知索引 | `aoci verify` governance_aligned=true；`aoci check` ok=true findings=[]；`aoci index agent guide` stage=aligned complete=true next_action=none |

## 2 要随发布上线的产品文件（就这些）

| 文件 | 变化 |
|---|---|
| `backend/src/services/promptAssistService.js` | 新增。拼提示词、解析候选，不碰钱不碰权限 |
| `backend/src/routes/promptAssist.js` | 新增。`POST /api/prompt-assist`，`router.use(authenticate)` |
| `backend/src/app.js` | +3 行，挂上面这个路由 |
| `frontend/src/pages/image/index.jsx` | 新旧两套视图共用同一套生成 / 图库逻辑；记 `localStorage` 的 `image.layoutMode` |
| `frontend/src/pages/image/components/Studio/`（5 个） | 新增：整体布局、对话区、底部输入条、写提示词抽屉、图库 |
| `frontend/src/pages/image/ImageGeneration.less` | +122 行，新版样式与 ≤1024px 压紧变体 |
| `frontend/src/locales/{zh-CN,en-US}/image.json` | 各 180 键，两边键名一一对应（机器校对过，无单边键） |

**不上线、也不要部署的本地件**：`dev/media-ux-preview/server.cjs`（把已构建产物端出来、几个接口用假数据顶上的本地服务，默认 127.0.0.1，里面 `'preview-token'` 是写死的假串）、`dev/media-ux-preview/shot.cjs`（截图脚本，本机缺 `libnspr4.so` 跑不起来，假数据形状也还是旧的，文件头已注明）、三个测试文件（隔离用例，不参与运行时）。`dev/` 整个目录本来就被认知索引 exclude，也不进镜像。

## 3 界面口径（按用户当面验收的那一版）

- 结果占主位：对话区**只显示这次打开页面之后生成的**，不把历史图片并排铺在对话里。
- 图库从右侧抽屉滑出（窄屏改底部），平时收着；**收藏 / 公开 / 删除只在图库里做**，对话区不放管理动作。
- 参数收进二级抽屉，尺寸 / 数量 / 种子 / 参考图在输入条上只留一排 chip；「生成」按钮上直接写这次要花多少积分。
- 留了「经典视图」开关，记在本机 `localStorage` 的 `image.layoutMode`。
- 手机与桌面同一套信息架构，`compact`（≤1024px）只是摆得更紧。

## 4 计费与权限（沿用对话那套，没有放宽）

| 情况 | 结果 |
|---|---|
| 可用模型 | `AIModel.getUserAvailableModels(userId, groupId)`，组权限与个人限制都不放宽 |
| 不指定模型 | 取 `credits_per_chat` 最便宜的那个 |
| 点名一个不在自己名单里的模型 | 403 `model_not_allowed`，**不回退到缺省模型** |
| 一个模型都没有 | 403 `no_model_available` |
| 积分不足 | 402 `insufficient_credits`，不调模型、不扣分 |
| 模型没写出来 | 502 `assist_failed`，**一分不扣** |
| 成功 | 才扣分：`consumeCredits(price, model.id, null, 'AI 协助写提示词', 'chat_consume')` |

不建会话、不存消息、不写历史；只收两段短文本（`draft` ≤1000、`request` ≤300），不收 URL、文件或会话 id。

**要让老师知道的一件事**：请 AI 写提示词是一次真实的模型调用，会按对话规则扣积分——学生可能在一张图都没生成的情况下花掉积分。界面上每次成功都会当场写出「本次消耗 N 积分」。

## 5 验证到哪一步（都是同版本本机跑的，不是历史结论）

| 验证 | 结果 |
|---|---|
| `backend .../services/promptAssist.test.js` | 7 项通过 |
| `backend .../routes/promptAssist.test.js` | 7 项通过。用本仓库一贯的 `app.listen(0)` + `http.request`（仓库里没有 supertest） |
| `frontend ImageStudio.test.jsx` | 9 项通过（输入条 6、图库 1、对话区 2） |
| 语言包 | zh 180 / en 180，单边键 0 |
| `no-undef`（eslint 10.11.0，临时配置不入仓） | Studio 五个组件 + `image/index.jsx`，6 个文件 0 错 |
| 构建 | 通过（见第 1 节） |
| 人工点击 | 用户在本地预览服务（假数据）上看过新版界面并确认「这个界面可以」 |

**全程隔离打桩，没有发出任何真实付费请求。**

### 过程中真发现并修掉的一个问题

把图库整段从 `index.jsx` 搬进 `Studio/GallerySection.jsx` 时，`ImageCard` 上那行 `generationProgress={generation.generationProgress}` 照抄了过去；`generation` 是页面里的局部变量，新组件里没有这个名字 —— 图库**一有图就 `ReferenceError` 白屏**，而且经典视图用的是同一份组件，等于会把原有的图像页一起打坏。空图库看不出来（人工验收时历史接口还在报错，图库是空的，所以没撞上）。

先复现再修：补了"图库必须真的渲染出一张卡片"的测试，失败输出留在 `storage/private/image-gallery-crash-before-fix-20260927.txt`（不入 git），修完 9 项全过，见 `849e7d2`。同类"搬家丢作用域"的问题用 `no-undef` 全扫过一遍，没有第二处。

## 6 没验证过的（发布前请当成风险看）

1. **真实付费链路一次都没跑**：真实模型返回的候选质量、真实扣分入账，都只有隔离打桩证据。
2. **真实生图链路没跑**：预览用的是假接口。也就是说"这一轮生成了哪几张"的记账（刷新后取历史前 N 条、Midjourney 按 1 条）没有在真实生成上验证过。
3. **浏览器多宽度验收没做**：本机两套 chromium 都缺 `libnspr4.so`，装系统库要 sudo，没装。只有桌面宽度的人工点击，没有 360/390/430 的真机或截图证据。
4. **图库抽屉带真实数据没人点过**：白屏是测试发现并修掉的，不是人点出来的。
5. **英文文案没有人校**：只机器校对了键名对齐。
6. **视频页没动**，「图像分对话」的表和迁移也没动。

## 7 回滚面

| 想退什么 | 怎么退 |
|---|---|
| 只想让某台设备回到老样子 | 界面右上角「经典视图」，或清掉 `localStorage` 的 `image.layoutMode` 改成 `classic`。**只影响这台设备** |
| 想让所有人默认回到老样子 | 改 `frontend/src/pages/image/index.jsx` 的 `readLayout()` 缺省值（`'studio'` → `'classic'`），重新构建 |
| 想关掉「帮我写提示词」 | 去掉 `backend/src/app.js` 里那一行 `app.use('/api/prompt-assist', …)`，重启后端。前端按钮会得到 404，抽屉里显示失败文案，其余功能不受影响 |
| 想整包退回 | 部署父版本 `2a56c39`。本包没有迁移、没有新表、没有配置项，**退回不需要任何数据动作** |

需要提前知道的一点：**这一包不是默认关闭的**。发布后所有人打开图像页看到的就是新版工作台（经典视图要自己点回去）。如果想先小范围试，就按上表第二行把缺省改成 `classic`，让愿意试的人自己切过来——这是一个字符串的改动。

## 8 发布前还缺什么，谁来做

| 事 | 谁 |
|---|---|
| 决定要不要默认新版（第 7 节最后一段） | 用户 |
| 真实站点上用真账号试一次「帮我写提示词」与一次真实生图，确认扣分与记账 | 用户（生产环境，我这边被拒绝执行生产命令） |
| `make deploy`（xingyuncl）→ `make deploy-docker`（pkuailab，需本地分支 `main` 且两站同 SHA） | 用户执行；发布前需要把本分支并入 `main` |
| 窄屏真机看一眼（手机打开图像页） | 用户 |
| 视频页照搬、「图像分对话」建表与迁移 | 待另行派单；动数据库前我会先把回滚脚本给用户看 |
