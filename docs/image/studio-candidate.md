# 图像生成「对话式工作台」：候选包、验证到哪一步、发布前还缺什么（2026-09-27 起，2026-09-28 按总控核收修订，未发布）

派单 CTRL-20260927-PRACTICE-IMAGE-ACCEPTED-CANDIDATE-01，核收 NOTICE-20260927-IMAGE-CANDIDATE-TURN-DATA-REVIEW（固定评审 `image-current-turn-root-review.json` sha256 `3b30f873…`）。分支 `codex/media-ux-20260926`，父版本 `2a56c39`（两站 2026-09-26 正在跑的那一版）。

本文只陈述**做了什么、在什么条件下验证过、还缺什么**。不是发布授权：本包没有部署、没有迁移、没有动任何生产配置，也没有碰视频页。

## 1 候选包身份

| 项 | 值 |
|---|---|
| 分支 / 父版本 | `codex/media-ux-20260926`，父 `2a56c39` |
| 提交 | `eb6c59b` 功能 → `849e7d2` 图库白屏修复 → `2ec6dac` 认知索引 → `c457425`/`2a7f1ca`/`1c7847e` 候选文档 → `9e8f085` 本次生成接线修复（两处，见第 5 节） |
| 新依赖 | 无。`package.json` / `package-lock.json` 未改 |
| 数据库 | 未改。无新表、无新列、无迁移 |
| 构建 | vite 5.4.21 / node v22.23.2 通过，`dist/index.html` sha256 `ae720cd28f56f6a7…`，dist 59M |
| 认知索引 | `aoci verify` governance_aligned=true；`aoci check` ok=true findings=[]；`aoci index agent guide` stage=aligned complete=true next_action=none |

## 2 要随发布上线的产品文件（就这些）

| 文件 | 变化 |
|---|---|
| `backend/src/services/promptAssistService.js` | 新增。拼提示词、解析候选，不碰钱不碰权限 |
| `backend/src/routes/promptAssist.js` | 新增。`POST /api/prompt-assist` + `GET /capability`，`router.use(authenticate)`，先过试点资格 |
| `backend/src/services/imagePilot/eligibility.js` | 新增。只读、可注入、**默认不装配即拒绝**的试点资格判定（第 10 节） |
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
| 试点资格（最先判） | 判不过就到此为止：不查模型、不查积分、不调模型、不扣分（第 10 节） |
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
| `backend .../routes/promptAssist.test.js` | 16 项通过（原 7 项钱与权限 + 9 项试点资格拒绝/放行）。用本仓库一贯的 `app.listen(0)` + `http.request`（仓库里没有 supertest） |
| `frontend ImageStudio.test.jsx` | 11 项通过（输入条 6、图库 1、对话区 2、新能力的门 2） |
| `frontend ImageStudioWiring.test.jsx` | 9 项通过。页面接线定向反例：切公开画廊、搜索换页、大图只在本轮、部分成功不补旧图、异步完成跟上且旧图不进来；另 4 项证明新能力的门只由服务端决定（localStorage 开不了、查询失败不冒充可用） |
| 语言包 | zh 180 / en 180，单边键 0 |
| `no-undef`（eslint 10.11.0，临时配置不入仓） | Studio 五个组件 + `image/index.jsx`，6 个文件 0 错 |
| 构建 | 通过（见第 1 节） |
| 真实浏览器 12 项（2026-09-28） | 全通过，0 条控制台报错。桌面 1280×900 + 430/390/360 三个窄屏：打开工作台、生成一轮、图库抽屉带数据不白屏、切公开画廊后本轮的图还在、缺省无「帮我写」/服务端说可用才有、窄屏无横向溢出、经典视图来回切。9 张截图与 `browser-cases.json` 在 `output/coordination-audit/practice-image-browser-20260928/` |
| 人工点击 | 用户在本地预览服务（假数据）上看过新版界面并确认「这个界面可以」 |

**全程隔离打桩，没有发出任何真实付费请求。**

### 过程中真发现并修掉的问题（三处，都是先复现再修）

#### 其一：图库一有图就白屏

把图库整段从 `index.jsx` 搬进 `Studio/GallerySection.jsx` 时，`ImageCard` 上那行 `generationProgress={generation.generationProgress}` 照抄了过去；`generation` 是页面里的局部变量，新组件里没有这个名字 —— 图库**一有图就 `ReferenceError` 白屏**，而且经典视图用的是同一份组件，等于会把原有的图像页一起打坏。空图库看不出来（人工验收时历史接口还在报错，图库是空的，所以没撞上）。

先复现再修：补了"图库必须真的渲染出一张卡片"的测试，失败输出留在 `storage/private/image-gallery-crash-before-fix-20260927.txt`（不入 git），修完 9 项全过，见 `849e7d2`。同类"搬家丢作用域"的问题用 `no-undef` 全扫过一遍，没有第二处。

#### 其二：本轮的图跟着图库切片走

对话区原来按 id 去图库当前切片（`galleryProps.getCurrentData()`）里回查。那是**图库当前 Tab / 搜索 / 分页**的数据：切到公开画廊或收藏、搜一个不相干的词、翻到第二页，本轮刚生成的图就被过滤掉、在对话区凭空消失；点开大图也混进了图库当前页。改成页面自己留一份 `turnItems`，对话区只从这份取，历史里认出同一个 id 的新状态就更新、认不出保持原样（从不因为查不到而丢图），图库里删掉的显式从轮次里摘掉；大图分两条路，图库点开在图库页里翻、对话区点开只在这一轮里翻。

#### 其三：拿"历史最前面 N 条"当本轮产出

原来生成后刷新历史，取前 N 条当这一轮的结果。要 2 张只成功 1 张时，第二条就是**上一次的旧图**；Midjourney 刚提交、那条还没进历史列表时，最前面躺着的整个是旧图。改成按生成响应登记：同步认成功的 `results`（单张时响应即那条记录），异步认 `generationId` + `taskId` 先挂"还在生成"，一张都没成功就不留轮次，**失败位置不补旧图**。

其二其三的修复前失败输出在 `storage/private/image-turn-wiring-before-fix-20260928.txt`（同一份最终测试文件对修复前代码跑，5 项全红），修复后 5 项全绿，见 `9e8f085`。

#### 顺带：浏览器这一跑把演示桩的三处形状错揪了出来

演示服务原来对不上真实响应的形状，三处都会让人在验收时看到假象，已按真实源码改正（都只在 `dev/media-ux-preview/`，不上线）：

| 原来 | 真实形状 | 不改会怎样 |
|---|---|---|
| `/auth/me` 直接把用户对象当 `data` 回 | `authStore.getCurrentUser` 解的是 `data.user` / `data.permissions` | 已登录的 user 被覆盖成 `undefined`，点生成直接抛错、什么都不发 |
| 模型价钱写成 `credits_per_image` | `ImageModel` 回的是 `price_per_image` | 按钮显示「生成（0 积分）」，看着像不要钱 |
| `/image/generate` 回 `{id, images:[...]}` | 单张是那条记录本身，多张是 `{requested,succeeded,failed,results,errors}` | 页面现在按响应登记本轮结果，形状不对就测不出真东西 |

另外记一条**本包没有改**的既有小隐患：`useImageGeneration.js` 的 `validateGeneration()` 对 `user.credits_stats` 做了判空，却没有对 `user` 本身判空——真实用户由 `User.toSafeJSON` 一定带上 `credits_stats`，所以线上不会触发；但只要 `user` 是 `undefined`（例如 `/auth/me` 返回形状变了），点生成就是一个未捕获的 TypeError，而不是一句提示。属于既有代码，另行决定。

## 6 没验证过的（发布前请当成风险看）

1. **真实付费链路一次都没跑**：真实模型返回的候选质量、真实扣分入账，都只有隔离打桩证据。
2. **真实生图链路没跑**：预览用的是假接口。"这一轮生成了哪几张"现在按生成响应登记，并有定向反例（含部分成功与异步完成），但**没有在真实生成上跑过**——真实响应的字段形状只核到源码（`imageService.generateImages` 的 `results`/`succeeded`、`midjourneyService.submitImagine` 的 `taskId`/`generationId`），没有实测。
3. **浏览器跑过了，但仍是假接口**：2026-09-28 用总控给的 `tedna-ppt-browser-probe:local` 镜像（只读挂本机 playwright 浏览器缓存，宿主没装任何系统库）跑了真实 Chromium，桌面加 360/390/430 共 12 项全通过、0 控制台报错、9 张截图。**但连的是本地演示服务的假接口**，而且是 headless，不等于真机、不等于真实生成。
4. **图库抽屉只在假数据上点过**：白屏回归先由测试发现，再在真实浏览器里点开确认（7 张卡片、不白屏）；**真实数据下没有人点过**。
5. **英文文案没有人校**：只机器校对了键名对齐。
6. **视频页没动**，「图像分对话」的表和迁移也没动。
7. **试点资格只有本地这一片**：provider 接口、capability 与 POST 共用判定、六类拒绝都有用例，但**没有接任何真实对端**——真实学校来源与批次消费的契约还在 edu/Identity 与 M0 主责手里（第 10.2 节）。没有注册任何真实批次，也没有装配过任何 provider。

## 7 回滚面

| 想退什么 | 怎么退 |
|---|---|
| 只想让某台设备回到老样子 | 界面右上角「经典视图」，或清掉 `localStorage` 的 `image.layoutMode` 改成 `classic`。**只影响这台设备** |
| 想让所有人默认回到老样子 | 改 `frontend/src/pages/image/index.jsx` 的 `readLayout()` 缺省值（`'studio'` → `'classic'`），重新构建 |
| 想关掉「帮我写提示词」 | 去掉 `backend/src/app.js` 里那一行 `app.use('/api/prompt-assist', …)`，重启后端。前端按钮会得到 404，抽屉里显示失败文案，其余功能不受影响 |
| 想整包退回 | 部署父版本 `2a56c39`。本包没有迁移、没有新表、没有配置项，**退回不需要任何数据动作** |

需要提前知道的一点：**这一包不是默认关闭的**。发布后所有人打开图像页看到的就是新版工作台（经典视图要自己点回去）。

**更正（2026-09-28，按总控核收）**：上一版这里写的"把缺省改成 `classic` 就可以先小范围试"是不准确的，已作废。`image.layoutMode` 只是**每台设备各自的显示偏好**——换台电脑、换个浏览器、清一次站点数据就没了，也拦不住任何人自己切到新版。它不是访问门，做不了试点范围控制。真要按学校/批次小范围试，那是**服务端的门**，见第 10 节；本包只交设计，没有实现、没有开启。缺省改成 `classic` 唯一的作用是"默认先给老样子"，可以降低一次性铺开的观感风险，但**不构成试点控制**。

已有的经典生图**不撤回**：两套视图共用同一套生成与图库逻辑，经典视图保持原样可用。

## 8 发布前还缺什么，谁来做

| 事 | 谁 |
|---|---|
| 决定要不要默认新版（第 7 节最后一段；这不是试点控制，只是默认看到哪一套） | 用户 |
| 真实站点上用真账号试一次「帮我写提示词」与一次真实生图，确认扣分与记账 | 用户（生产环境，我这边被拒绝执行生产命令） |
| `make deploy`（xingyuncl）→ `make deploy-docker`（pkuailab，需本地分支 `main` 且两站同 SHA） | 用户执行；发布前需要把本分支并入 `main` |
| 窄屏真机看一眼（手机打开图像页） | 用户 |
| 拿到可信学校映射与批次只读契约后接线（第 10.2 节） | edu/Identity 校籍主责 + M0 作者先给契约，之后才轮到我接 |
| 决定在拿到真实输入前要不要先装一个临时 provider（缺省是谁都不开，「帮我写」按钮不出现） | 用户与总控 |
| 视频页照搬、「图像分对话」建表与迁移 | 待另行派单；动数据库前我会先把回滚脚本给用户看 |

## 9 怎么用（给老师和学生看的短说明）

图像页打开就是新样子，中间是「本次生成」，底下是写字的地方。

1. **写一句你想要的画面**，比如「夕阳下的校园水池，暖色调，低角度」，点右下角「生成（N 积分）」——按钮上那个数就是这次要花的积分。
2. 生成好的图会**在下面接着长出一条**：上面是你写的那句话，下面是这一轮的图。点图看大图，点「再写一次」会把那句话放回输入框，改两个字再生成。
3. **不会写提示词就点「帮我写」**：把你已经写的半句留着，再说一句想要什么（例如「更适合做课件封面」「换成夜景」），AI 给你几种写法，你自己选「替换」或「追加」。这一步是真的在问 AI，会按对话的规则扣积分，界面上会当场写出扣了多少；写不出来的时候不扣分。
4. **要调尺寸、数量、种子、参考图**，点输入框上面那排小标签或「参数」，从下面滑出来调，调完自己收起。
5. **想找以前的图**，点右上角「图库」，从右边滑出来：我的图片 / 收藏 / 公开画廊三页，可以搜索、翻页。**收藏、公开、删除都在这里做**，对话里不放这些按钮，免得手滑。
6. **想回到原来的界面**，点右上角「经典视图」；想回来再点「试试新版布局」。这个选择只记在你自己这台设备上。

两件要知道的事：对话区只显示**这次打开页面之后**生成的，刷新页面就空了（图本身都还在图库里，一张都不会丢）；「帮我写」会花积分，即使最后一张图都没生成。

## 10 试点资格：本地这一片已经做实（2026-09-28 修订，未开放、未注册任何真实批次）

### 10.0 先更正上一版写错的两处事实

上一版这里写"实践侧没有任何 school 字段、C05 在别的分支未合入"——**两句都不准确，作废**。核过的同源事实：

- `backend/src/services/studentEntry/sessionContext.js` 与 `exchange.js` **就在本候选源码里**（随父版本 `2a56c39` 一起）。edu 签名带来的 `school_ref` 经映射与 consume 复核后，写进一行绑定 `jti` + `user_id` 的 `c05_sessions`；`GET /api/auth/sso/context` 只把本人这条会话的来源回给本人。
- 但它**只是会话来源证据**：不是实时校籍，不是新功能的授权，也不覆盖教师与非 C05 账号；默认关闭，建表还停在 `backend/migrations-candidates/c05/`（没进 `backend/migrations`）。**本包不启用 C05、不迁移、不造任何凭据。**
- 仍然成立的那半句：组名（`user_groups` 是管理员自建的）、`uuid_source='sso'`、实例名，**都不替代被证过的学校身份**。

另外，上一版 10.1 第 3 条"允许的 group_id 名单 + 批次字符串写进部署配置，现有分组管理就是唯一开通入口"——**这条替代路线已撤销**。本地组名单加一个批次字符串，既推不出"这是可信的 PKU 学校"，也推不出"admin 批准过这一批"。开放只认既定的 admin 对整批的一次确认。

### 10.1 已经做实的部分（不依赖对端，本包内可审）

```
现有认证(authenticate) → 可注入的只读资格 provider → capability 与 POST 读同一个判定
```

- `backend/src/services/imagePilot/eligibility.js`：**只读、可注入、默认不装配即拒绝**。装配契约就一个方法：
  `{ check({ userId, groupId, role }) -> { eligible, reason?, batch_ref? } }`，放在 `app.locals.imagePilotEligibility`。
  判定输入只给平台里已经有的既有身份，不多给一个字段。
- 放行的回答**必须带 `batch_ref`**（这次是按哪一批放的）。没带就按"装配没写完"拒绝——一次 admin 确认一整批，事后要能说清按的是哪一批。`batch_ref` 的取值与"当前是哪一批"由装配方从批次主责那里取，本文件不猜、不填、不校验语义。
- `GET /api/prompt-assist/capability` 与 `POST /api/prompt-assist` **读同一个 `decide()`**，不允许两边各判一次。POST 的资格判定在最前面：判不过就到此为止，**不查模型、不查积分、不调模型、不扣分**。
- 拒绝清单（每一条都有用例）：

| 情况 | 回什么 |
|---|---|
| 没装配 provider（**缺省就是这个**） | `403 pilot_provider_not_installed` |
| 不在试点学校 | `403 school_not_in_pilot` |
| 学校身份过期 | `403 identity_expired` |
| 未登记 / 暂停 / 换批 | `403 not_registered` / `suspended` / `batch_changed` |
| provider 抛错、超时（2s）、答非所问、放行但没说批次 | `503 pilot_provider_unavailable`（可重试）——**绝不因为问不到就放行** |

- 前端：开页问一次 capability，**服务端没说可用就连按钮都不出现**；`image.layoutMode` 只决定看到哪一套布局，**本机 localStorage 塞什么都开不了这个门**（有用例按着）。能力查询自己失败时当作不可用，不冒充可用。
- **既有的生图与图库完全不受这个门影响**，经典视图照旧。被门挡住的只有「帮我写提示词」这一个新能力。
- 没有新建表、没有新增 env、没有任何真实凭据、没有注册任何真实批次、没有碰 C05 开关。

### 10.2 还缺的输入与主责（不猜字段、不伪装真实试点）

| 缺的 | 现状 | 主责 |
|---|---|---|
| **可信学校身份** | C04 规定 Identity 同人 Ticket → edu 本人 org-snapshot（含 `school.ref`），C08 规定可信学校到实践教师/学生组的映射——**都是可复用契约，但实践侧源码里找不到 C04 的消费者**，不能写成"已经在跑" | 原 edu / Identity 校籍主责，并需与本会话核定 edu `school.ref` ↔ TE 的固定 PKU UUID 的可信映射、当前会话本人绑定、教师与非 C05 账号的覆盖、失效复核 |
| **当前更新批次** | M0 已有 `BatchMemberAllowed`（读成员 gate_key、批次状态、真实发布证明）与 `/api/v1/release-adoption/batches/current`（沿 TE JWT）——**是可复用的规则与批次源，还不是实践账号能直接调的资格接口** | 原 M0 作者提供供实践消费的最窄只读判定契约：绑定实践实例/能力成员、当前批次与发布身份、状态与失效边界，并说清既有调用的认证/授权是否覆盖 |

两条硬规矩：**不借用、不挪用**。C04 的本人校籍、E09 的作品资格（有界签名 HTTP，只证明某件作品的审阅权）、P03 的实例权利（固定 `pku-ai-platform-prod → pku-tedna-prod`），都不能互相当成"这个图像用户属于 PKU 学校"，也不能借它们的 secret。**不借 TE JWT 或 P03 凭据推定自己可调。**

### 10.3 发布后的实际状态（要提前知道）

按上面的缺省，**这一版发布后「帮我写提示词」对所有人都不可用**（按钮不出现），直到有人把真实的资格 provider 装配进来。生图、图库、经典视图一切照旧。要不要在拿到上面两项可信输入之前先装一个临时 provider，是用户与总控的决定，不是我自己能定的——本包没有装配任何 provider。
