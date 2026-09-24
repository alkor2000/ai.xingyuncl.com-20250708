# P03 ＋ C05／P09 组合候选：可审报告

**这不是发布，也没有合 main。** 它把两支已经各自做完的候选放在同一棵树上，让人能一次看清"三个默认关闭
的东西放在一起会不会互相碰坏"。

| 项 | 值 |
|---|---|
| 组合提交 | 分支 `codex/p03-c05-p09-compose-20260924`，本文所在提交的父是 `3d04d3d` |
| 输入 A | `1b1bd251f736c48395b63c92de9b59afcaed872f`（C05/P09/E09，**两站已发布**的技术版本） |
| 输入 B | `77a9ccfe2cab8cc7911e6637c249ee6ff192b92f`（P03 主线候选，**未发布**） |
| 共同父版 | `91bb2c05542fa636c093b20ed17c7e740a49791b` |
| 依赖锁 | 两侧都没动 `package.json`／`package-lock.json`，组合后与 `91bb2c0` 逐字节相同 |

## 一、真实交点只有六个，逐个说清取舍

`diff 91bb2c0→77a9ccf` 是 91 个文件，`diff 91bb2c0→1b1bd25` 是 95 个，实测交集恰好六个：

| 交点 | 怎么处理 |
|---|---|
| `backend/src/app.js` | 取**已发布主线**的版本，只加 P03 的一行挂载（`artifactHandoffEntry`）。C05 仍挂在 `authRoutes` 之前、SSO 原始字节解析与 P09 挂载原样、主线反馈桥原样 |
| `backend/src/server.js` | 同样取已发布版本，只加 P03 的运行时引导与关停。P09 的引导因此从 2.5 变 2.6、关停从 4.2b 变 4.2c——**只是注释编号**，代码未动 |
| `.gitignore` | 两边加的是同样两条 Python 字节码规则（注释语言不同），保留已发布那版的措辞 |
| `dev/p03-entry-web.mjs` | 两边**逐字节相同**，无需取舍 |
| `aoci.code.txt` / `.aoci/baseline.json` | **不取 P03 的**——那会把一份更旧的索引压过已经对齐的当前索引。改为在组合树上按新差异重新对齐一次 |

其余 85 个 P03 文件按其候选原字节取入；这 85 个与 C05/P09 那 95 个**零重叠**。

## 二、只验"合起来才有的风险"

三个开关都不设时（`dev/release-lab/default-off.py`，真实 node + 真实 Vite + 一次性 mysql/redis + Chromium，
库只装当前已发布 schema 且先证明其中没有任何候选表、不执行任何候选迁移）——**9 条判定全过**：

| 验的是什么 | 实测 |
|---|---|
| 旧功能没坏 | `/health` 200；历史 `POST /api/auth/sso` 仍是 400 `缺少必要的SSO参数`；普通本地登录拿到令牌；网页编辑器建项目/页面并真实保存 200 |
| P03 关着 | 能力探测 200 `available:false`；`GET /api/p03/handoffs` 与 `POST /api/p03/handoffs` 均 503 `handoff_disabled` |
| C05 关着 | 能力探测 200 `available:false`；exchange／consume／context 均 503 `student_entry_disabled` |
| P09 关着 | 能力探测 200 `available:false / disabled`；学生面与 edu 面均 503 `website_artifacts_disabled` |
| 没有副作用 | 跑完仍是 110 张表、哈希不变、无新表、账本零行、Redis 零键 |
| 浏览器 1280 / 390 | 登录页没有"学校学生登录"、只有原来的密码表单；网页编辑器没有"教学任务作品"面板 |

其它跑过的：P03 受影响套件 **165 通过**（14 个文件）、后端单元全量 **952 通过**（6 个失败与当前 main 完全相同，
是 `dev/RELEASE.md` 列的已知陈旧用例）、`make build` 通过、认知索引 `verify/check/guide` 三证齐、831 条、漂移 0。

**没有重刷**：P09 的 21 场景、四宽度全套、迁移往返、C05 全套、以及任何跨仓 Go 程序。

## 三、这份候选**不能**被读成什么

- 不是发布：没有合 main、没有 `make deploy`／`deploy-docker`、没有打 tag。
- 不是"P03 可以上线了"：P03 的准入门（Identity 正式 RC 与迁移准备包 `c99943b`）**未解除**，本包只读参照，
  没有晋级或执行任何候选迁移。
- 不是"业务可用"：三个开关仍关，学校未开通、D-13 未定、edu 真实资格联验仍在审核 HOLD。
- 真人、真机、三端同版**均待验**。
