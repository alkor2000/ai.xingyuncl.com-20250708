# C05 + P09 联合候选的认知索引条目（候选；附唯一具体阻塞）

## 为什么这里只能交候选

本包已按派单要求**实际读了一次**认知服务的绑定能力，没有反复探测。结果：

```
aoci_overview → runtime_repository_root = /home/hanying/ai-platform
```

服务绑定在**主工作副本**，接口上没有任何参数可以把 repository root 指到别的仓库；
本包的独立 worktree `/home/hanying/ai-platform-c05-p09-integration-20260923` 因此不在它的作用域内。
在这种绑定下写条目，写进去的只会是**主副本的正式索引**——而派单明确要求主副本只读、
不带外改索引、不重置 baseline/scope。

**唯一具体阻塞**：认知服务没有"按给定仓库根打开/切换 volume"的能力（或本会话不具备该权限），
所以隔离副本无法按正常流程维护自己的正式条目。
需要的能力是：允许对 `runtime_repository_root` 之外的一个**指定仓库根**打开独立 volume 并写入，
且不影响主副本的 baseline 与 scope。在此之前，本文件就是完整的 source-bound 候选。

**没有为了"看起来可上线"而填任何 aligned 状态。**

## 本包新增对象（source-bound 候选）

| 仓内路径 | source_sha256 |
|---|---|
| dev/c05-p09-lab/check.py | 5ca63e55aba4ddfac52aa26f438f3ded028ee486140dd99269ba83bf6b1bd454 |
| dev/c05-p09-lab/browser.cjs | 7c73ee003f57f17411caac4195feb8fe8ec5b0c9d711dc8d213c768b7346f6ed |
| docs/integrations/c05-p09-joint-candidate.md | cd3345bbb133fcf1f616070596c3c04544965808c3693d0b9f38c4c5e03c933f |
| docs/integrations/JOINT-ENTRY-TEST.md | 36bf547796d9cb30a40e467f5995dff567be7de448ce3512c7d3cedd9100962b |

```
c05-p09-joint-candidate.md[SI6M]: F:I·C05+P09 联合候选交付文档：两份固定输入与真实交集(4 文件)、两条身份的分界、两组候选迁移的目录前缀与执行顺序、一个进程两个开关的启停、E09 的最小请求顺序、6 组衔接实测、与两份旧输入的精确差异、三条不要美化的口径与缺口清单 | R:code:docs/integrations/c05-student-entry-provider-candidate.md,code:docs/integrations/p09-website-artifact-source-candidate.md,code:dev/c05-p09-lab/check.py,code:backend/migrations-candidates/c05/20260923_002_c05_session_context.js | A:- | S:C05 是学生真实登录提供方候选、P09 任务上下文只授权关联，教师身份链与真实 edu 资格仍在 E09 接入且本包不代写共享 contracts；登录≠关联≠提交；15s 只是工程默认值不是获批运维参数；withPinnedConnection 读取/设置/恢复会话超时失败都会吞错，故不声称任何故障下都有 15s 保证；LOCK TABLES 与 ALTER 隐式提交，那层"事务"实质是固定连接，部分失败可能需要重入收尾而不是整体回滚；未接真实 edu/Identity，两组候选迁移均未晋级
JOINT-ENTRY-TEST.md[SU4S]: F:I·普通同事《从作业进入实践并关联网站作品》测试单：进来、进来不等于交作业、自己选作品关联、真实保存一次、放图片固定一版再改稿、老师那边、换学生不许串、重新进来、窄屏、原登录没坏 | R:code:docs/integrations/c05-p09-joint-candidate.md,code:docs/integrations/STUDENT-ENTRY-TEST.md,code:docs/integrations/WEBSITE-REVIEW-TEST.md | A:- | S:全程只用浏览器，不碰服务器/配置/数据库/充值/连接池；开头写明两个开关默认关闭且未接真实 edu，找不到入口不算缺陷；网页编辑器本身没有上传按钮是已知事实，图片地址由技术同事准备；真人跑过之前一律填"待验"，不预填通过
check.py[TQ5L]: F:I·C05+P09 联合隔离验收：一个 node 进程同时开两侧，自起 mysql/redis、由 knex 应用两组候选迁移、真实前端与 Chromium(桌面+390)，覆盖两开关全关的零副作用与 6 组新增衔接 | R:code:dev/c05-lab/check.py,code:dev/p09-lab/check.py,code:dev/c05-p09-lab/browser.cjs,code:docs/integrations/c05-p09-joint-candidate.md | A:python3 dev/c05-p09-lab/check.py | S:只验新增衔接，不重跑 C05 四宽度与 P09 21 场景/资产矩阵/迁移安全全套；edu 发行方、任务上下文发行方、资格名册、全部学生教师学校标识与学生项目/图片归属行都是合成的，不冒称真实 edu 已接入；D-13 只用合成实验数值，生产缺值仍按名拒绝；路径上的 :id 取 GET /links 的 link_id，artifact_ref 是对外不透明引用；评阅会话点名 revision_ref 才是固定版本，不点名是本人当前稿
browser.cjs[TQ4S]: F:I·联合验收的 Playwright worker：在 P09 worker 上加 C05 真实落地页命令，落地与编辑器共用同一个浏览器上下文 | R:code:dev/p09-lab/browser.cjs,code:dev/c05-lab/browser.cjs,code:dev/c05-p09-lab/check.py | A:consume/open(keep)/link/save/review/externals | S:落地页由真实 consume 建立会话，不再由 harness 往 localStorage 塞令牌；open 带 keep 时不新建上下文，否则就不是"同一个学生一路走下来"
```

## 受影响的既有候选条目

`docs/integrations/p09-aoci-entries-candidate.md`（本树内已随 `ff562cf` 更新 002 的 SHA 与语义）与
`docs/integrations/c05-aoci-entries-candidate.md`（`b515443` 的内容原样继承，未改）。
两份仍是各自分支上的候选，**本包没有把它们合并成一份**，也没有在任何正式索引里对齐。
