# C05／P09 并入主线：一份默认关闭的技术版本

这份说清楚**已经做完什么**、**还没开什么**，以及同事现在该期待什么。

| 事项 | 状态 |
|---|---|
| 代码已集成到当前主线 | ✅ 分支 `codex/c05-p09-mainline-20260924`，父版 `91bb2c0`，两个提交（集成 + 认知对齐） |
| 技术发布 | ⏳ 已备好并通过本地发布门；**两个生产站点尚未执行**，等用户确认 |
| 学生入口开关 | ❌ 仍关闭（`C05_STUDENT_ENTRY_ENABLED` 未设） |
| 网站作品开关 | ❌ 仍关闭（`P09_WEBSITE_ARTIFACTS_ENABLED` 未设） |
| 四条候选迁移 | ❌ **未晋级、未执行**，仍在 `backend/migrations-candidates/`；本次发布对 `backend/migrations/` 零改动 |
| edu 真实资格联验 | ❌ 仍在审核 HOLD，未做；实验里的 edu 端点是线形替身 |
| 学校开通 / 凭据 / D-13 额度 / 教师身份链 | ❌ 均未决，未配置 |
| 真人老师、学生验收 | ❌ 未做 |

## 为什么可以先发代码

因为**关了就是关了**，这一条是实测的，不是推断。同一套检查在这棵树和纯 `91bb2c0` 上各跑一遍
（`dev/release-lab/default-off.py`，真实 node + 真实 Vite + 一次性 mysql/redis + Chromium；
库里只有当前已发布的 schema，脚本先证明其中没有任何 C05/P09 的表，也没有执行任何候选迁移）：

- `/health`、历史 `POST /api/auth/sso`、普通本地登录、网页编辑器一次真实保存：**两边逐项一致**
  （SSO 那条连响应体都一样：`400 缺少必要的SSO参数`）。
- 关闭态下 C05 具名拒绝 `student_entry_disabled`，能力探测明说 `available:false`；
  P09 能力探测 `available:false / disabled`，其余一律 `website_artifacts_disabled`。
- 跑完全程后：**表一张没多**（110 张，前后哈希相同）、账本零行、Redis 零键。
- 浏览器 1280 与 390 各一次：登录页**没有**学校学生登录按钮、只有原来的密码表单；
  网页编辑器**没有**教学任务作品面板。两种宽度、两棵树，四次结果相同。

## 这次带进来的是什么

77 个新文件（C05 提供方、P09 网站作品、E09 HTTP 资格、作品名、两组候选迁移、实验脚本与文档）
＋ 12 个改动文件。**P03 没有带进来**：候选分支的历史里有 P03，所以改动文件是逐块集成的——
`app.js`／`server.js` 保留主线自己的挂载，只加 C05 与 P09 那几行；`frontend/App.jsx` 保留主线的反馈路由，
只加 C05 落地页路由。另外带了一个 22 行的通用 Vite 夹具 `dev/p03-entry-web.mjs`（C05/P09 实验脚本要用它），
它只起前端开发服务器，不含 P03 业务字节。

## 跑过什么

| 项 | 结果 |
|---|---|
| C05／P09 七个套件 | 139 通过 |
| 后端单元全量 | 812 通过；6 个失败与纯 `91bb2c0` **完全相同**（`ImageService` 5 个 + `MessageService` 1 个，`dev/RELEASE.md` 已列为已知陈旧用例） |
| 主线自己的反馈用例 | `product-feedback-bridge` 与 `product-feedback-route` 两个文件通过 |
| 前端组件用例 | 19 通过（学生入口 12 + 教学任务面板 7） |
| `make build` | 通过（后端模块图加载 + `vite build`） |
| 关闭态隔离检查 | 8 条全过，且与纯主线逐项对照 |
| 认知索引 | `verify governance_aligned=true`、`check ok=true` 0 findings、`guide complete=true next_action=none`，806 条、漂移 0 |

## 发布口径（给运维）

这是**纯代码发布**（`dev/RELEASE.md` 第一节的 A 类）：本次不含任何 `backend/migrations/` 改动，
本机的线上镜像库里 10 个迁移文件对应 10 条已应用记录，**没有待执行迁移**，
所以 Docker 站点的发布流程不会顺带跑别的迁移。依赖锁与 `91bb2c0` 逐字节相同，`npm ci` 不会被触发。
