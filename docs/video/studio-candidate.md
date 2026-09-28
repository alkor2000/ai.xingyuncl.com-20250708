# 视频生成「对话式工作台」：候选包、验证到哪一步、发布前还缺什么（2026-09-28，未发布）

派单 CTRL-20260928-PRACTICE-VIDEO-STUDIO-CANDIDATE-01。独立工作树 `/home/hanying/ai-platform-video-ux-20260928`，分支 `codex/video-ux-20260928`，父版本 `cee42f7`（图像候选收口那一版，本包只读引用它的设计与组件，**没有改动图像固定件**）。

本文只陈述做了什么、在什么条件下验证过、还缺什么。**不是发布授权**：没有部署、没有迁移、没有动任何生产配置、没有发过一次真实生成。

## 1 候选包身份

| 项 | 值 |
|---|---|
| 工作树 / 分支 | `/home/hanying/ai-platform-video-ux-20260928`，`codex/video-ux-20260928` |
| 父版本 | `cee42f7`（图像候选，原样保留，未改） |
| 新依赖 | 无。`package.json` / `package-lock.json` 未改 |
| 数据库 | 未改。无新表、无新列、无迁移、不引入分对话表 |
| 构建 | vite 5.4.21 / node v22.23.2 通过 |

## 2 要随发布上线的产品文件

| 文件 | 变化 |
|---|---|
| `backend/src/routes/studioPilot.js` | 新增。`GET /api/studio-pilot/capability?capability=video_studio`，只读 |
| `backend/src/services/imagePilot/eligibility.js` | 加一个 `capability` 维度：**一个能力一个答案**，图像放行不等于视频放行 |
| `backend/src/app.js` | +2 行，挂上面那个只读路由 |
| `frontend/src/pages/video/VideoGeneration.jsx` | 开页问一次资格；本轮按真实响应 id 登记并自留一份；两套布局共用同一份数据与处理函数；参数区抽成同作用域变量供两边共用 |
| `frontend/src/pages/video/components/Studio/`（4 个） | 新增：整体布局、对话区、底部输入条、图库（卡片仍由页面渲染） |
| `frontend/src/pages/video/VideoGeneration.less` | 新增 `.video-studio` 样式与 ≤1024px 压紧变体 |
| `frontend/src/locales/{zh-CN,en-US}/video.json` | 各 +15 键（`video.studio.*`），两边一一对应 |

**不上线的本地件**：`dev/video-ux-preview/server.cjs`（假数据本地预览，默认 127.0.0.1:4401）、`dev/video-ux-preview/browser-check.cjs`（headless 隔离容器里跑那 13 项）、三个测试文件。`dev/` 本来就被认知索引 exclude、也不进镜像。

## 3 产品口径

- 主区只放**这一次打开页面以来**的每一轮：提示词 + 这一轮的状态 + 这一轮的视频。历史视频在右侧抽屉（窄屏改底部）里查找与操作。
- 状态按现行协议如实呈现：**排队中**（`pending`/`submitted`/`queued`）、**生成中**（`running`，带进度）、**完成**（`succeeded`，播放器 + 全屏）、**失败**（`failed`，照写后端给的原因）。当前协议**没有取消**这一步，所以界面上也不编一个出来。
- 视频自己的能力一个没丢：生成模式（文生视频 / 首帧 / 首尾帧）、首尾帧上传、分辨率、时长、比例、种子、水印、固定镜头，全部收在参数抽屉里。图像那边不适用的参数没有硬搬过来。
- 收藏 / 公开 / 删除只在图库里做，对话区不放这些按钮；图库里删掉的，对话区同步不再显示。
- 计费、权限、接口一律沿用原有那套（`/video/generate` + `/video/task/:id` 轮询、`base_price × 分辨率系数 × 时长系数` 向上取整）。**没有改计费规则，没有重复或偷发任何真实请求**——轮询仍然只有 store 原来那一条。

## 4 这一轮算哪一条（最要紧的一条线）

登记只认 `/video/generate` 的响应：`generationId`（必要时配 `taskId`）。**绝不拿刷新后历史的前 N 条当本轮产出**——那在部分失败或刚提交时会把上一次的旧视频算进来。响应里没有真实 id 就不登记，也不猜。

页面自己留一份 `turnItems`：图库切页签、搜索、翻页都会换掉那份列表，本轮结果不跟着走。历史里认出同一条（按 `id`，或 `task_id`）就更新状态与进度，认不出保持原样，**从不因为查不到而把这一轮丢掉**。

这条线有反面证据：把登记改成"取历史第一条"后，`VideoStudioWiring.test.jsx` 立刻红 5 项（`output/practice-video-studio-20260928/turn-binding-mutation-red.txt`）。

## 5 试点资格：缺省关闭，图像的放行不算视频的批准

```
现有认证(authenticate) → 可注入的只读资格 provider → capability 查询与页面读同一个判定
```

- 沿用图像那一片的 provider 模式（`app.locals.imagePilotEligibility`），但**加了能力维度**：`check({ capability, userId, groupId, role })`，`capability` 取 `image_studio` / `video_studio`。provider 若在回答里写了 `capability`，必须与所问的一致，否则按没资格——**不允许把图像的成员资格挪来开视频**。
- 新增只读端点 `GET /api/studio-pilot/capability?capability=video_studio`。为什么不复用图像那个：那个挂在 `/api/prompt-assist/capability` 下面是历史原因（当时只有「帮我写」一个新能力），视频工作台跟写提示词没关系。**判定仍是同一个 `decide()`**，没有第二套逻辑、第二份缺省。
- 拒绝清单与图像一致：未装配（**缺省就是这个**）/ 非试点学校 / 身份过期 / 未登记 / 暂停 / 换批 → 403；抛错、2s 超时、答复不成样子、放行没带批次 → 503 可重试。**绝不因为问不到就放行。** 那 2 秒只是停止等待，不是取消底层 I/O，真实 provider 必须自己有界。
- 前端：没拿到明确「可用」之前两套都不渲染（转圈，2 秒兜底走经典）；没资格时连「试试新版布局」入口都没有；`video.layoutMode` 只在有资格的人之间记偏好，**本机塞什么都开不了门**。
- **没有装配任何真实或临时放行 provider**，产品源码里没有装配者，也没有默认放行分支。合成 provider 只在隔离测试与本地演示里出现。
- **「帮我写提示词」这次没有放进视频工作台**：那条后端接口虽然支持 `target: 'video'`，但它的门是图像那一片的；把它直接摆到视频页上等于拿图像的批准开视频的新能力。要用得先有视频自己的跨能力契约或真实授权，本包不凭空放行。

## 6 验证到哪一步（同版本本机跑的）

| 验证 | 结果 |
|---|---|
| `backend studioPilot.test.js` | 6 项通过：未装配、只放图像的 provider 问视频照样拒、回答里写错能力名按没资格、放行带批次、能力名不在白名单 400 且不问 provider、查不到 503 |
| `backend promptAssist（路由 21 + 服务 7）` | 28 项通过，图像那一片加了能力维度后语义不变 |
| `frontend VideoStudioWiring.test.jsx` | 11 项通过：排队→生成中→出片、失败写原因不补旧视频、没有真实 id 不登记、切公开画廊/搜索后本轮仍在、图库真的画出卡片、没资格不进新版（含 localStorage 强设）、查询失败不冒充可用、经典与新版来回切 |
| `frontend VideoStudioComposer.test.jsx` | 5 项通过：价钱写在按钮上、首尾帧缺图不让生成、两张齐了能生成、参数收在抽屉、模型没配密钥不让点 |
| `frontend 图像两套用例` | 20 项仍通过（本包没有改图像页） |
| 真实 Chromium（**headless 隔离容器**）13 项 | 全通过、0 控制台报错、9 张截图：桌面 1280×900 与 390/360 窄屏，含没资格/强设偏好/资格撤销三种门的行为 |
| 语言包 | zh 128 / en 128，单边键 0 |

证据目录 `output/practice-video-studio-20260928/`：`backend-tests.txt`、`frontend-tests.txt`、`build.txt`、`browser-cases.json` 与 9 张截图、`turn-binding-mutation-red.txt`、`manifest.txt`。

## 7 没验证过的

1. **真实生成链路一次没跑**：预览是假接口、占位片。真实响应字段形状只核到源码（`videoStore.generateVideo` 读 `taskId`/`generationId`；`/video/task/:id` 回 `status`/`progress`/`local_path`/`error_message`）。
2. **真实扣分没验**：计费规则一行没动，但没有真实入账证据。
3. **真实播放没验**：演示的 mp4 是空占位，卡片显示的是海报图。
4. **headless 不是真机**：没有真实触摸、软键盘、系统字体与真实网络。
5. **真实资格 provider 没接**：视频的学校与批次契约和图像一样，仍在原 EDU/Identity 与 M0 主责手里。
6. **英文文案无人校**，只机器校对了键名对齐。

## 8 回滚面

| 想退什么 | 怎么退 |
|---|---|
| 关掉整套新版 | **缺省就是关的**（没装配资格 provider 即一律拒绝）。已装配后想关，撤掉 `app.locals.imagePilotEligibility`，或只让 provider 对 `video_studio` 回 false |
| 只想让某台设备回老样子 | 界面右上角「经典视图」（只影响这台设备） |
| 摘掉能力查询接口 | 去掉 `backend/src/app.js` 那一行 `/api/studio-pilot` 挂载：页面查询失败 → 按没资格 → 回经典视图，原有视频功能不受影响 |
| 整包退回 | 部署父版本 `cee42f7`（或图像候选之前的 `2a56c39`）。本包没有迁移、没有新表、没有配置项，退回不需要任何数据动作 |

## 9 怎么用（给老师看的短说明）

**先说现在会看到什么**：视频页还是原来的样子。新版工作台要**你所在的学校被开放之后**才会出现，没开放时页面一切照旧。

开放到你这里之后：写一句想要的画面与镜头 → 点右下角「生成（N 积分）」→ 下面会长出一条，先显示**排队中**，然后是**生成中**（带进度），做好了就地可以播放、点「全屏看」放大；这一条要是失败了，会写明原因，不会拿别的视频顶替。要调模式（文生视频 / 首帧 / 首尾帧）、分辨率、时长、比例，点输入框上面那排小标签。想找以前的片子点右上角「图库」，收藏、公开、删除都在那里做。想回老样子点「经典视图」。

两件要知道的：对话区只显示**这次打开页面之后**做的，刷新就空了（片子都还在图库里）；视频要渲染，慢的时候几分钟，页面会一直把进度写给你看。

## 10 发布前还缺什么，谁来做

| 事 | 谁 |
|---|---|
| 视频的可信学校身份与当前批次契约 | 原 EDU/Identity 与 M0 主责；到位后才谈装配 provider |
| 真实站点上真账号试一次生成，确认扣分与记账 | 用户（生产环境，我这边的生产命令被拒绝） |
| 真机（真手机）看一眼 | 用户 |
| `make deploy` / `make deploy-docker` | 用户执行；发布前需要把本分支并入 `main`，并与图像候选一起排先后 |
| 「帮我写提示词」要不要给视频 | 需要视频自己的跨能力契约或真实授权，本包不凭空放行 |
