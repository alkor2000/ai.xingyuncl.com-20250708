# C05 + P09 联合候选：给 E09 的一个可复现输入

分支 `codex/c05-p09-integration`，固定提交 **d0474f1**（未合 main、未发布、未晋级迁移、两个开关默认关闭）。
本文是给 edu E09 的单一固定输入：装什么、怎么起、按什么顺序请求、与你手上两份旧输入的精确差异、
哪些事实是真的、哪些仍然缺。

## 1 这份联合候选是怎么来的

| 输入 | 固定提交 | 说明 |
| --- | --- | --- |
| C05 学生入口候选 | `b515443ce48796b7d398706a51708191c106c587` | 学生真实登录提供方候选 |
| P09 网站作品候选 | `ff562cfb84b851a6254aa750d191e9c9a63eff25` | 作品关联/固定版本/私有评阅 |
| 共同祖先 | `faa9d2cfca03ce9a2645faa8c513ec9d83d23614` | 两支都从这里分出去 |

联合方式**不是合并整棵树**：从 C05 的 `b515443` 建新分支，只叠加 `ff562cf` 改动的 **4 个文件**。
叠加前逐项核过前像——三个既有文件在 C05 分支上与 `faa9d2c` **逐字节相同**（C05 从未碰过它们），
`dev/p09-lab/lock-wait.py` 是新增文件。所以这 4 个文件就是两支的**全部真实交集**，叠加无冲突。

```
backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js
backend/src/__tests__/unit/services/websiteArtifactMigration.test.js
docs/integrations/p09-aoci-entries-candidate.md
dev/p09-lab/lock-wait.py                                   （新增）
```

与 `faa9d2c` 相比，联合分支共 36 个文件不同（C05 的 30 个 + P09 的 4 个 + 本包新增的
`dev/c05-p09-lab/{check.py,browser.cjs}`）。**两份 package-lock 与 package.json 逐字节未变，未新增任何依赖。**

## 2 两条身份，不要混为一谈

- **C05 是学生真实登录的提供方候选**：edu 服务端签名断言换一次性 handoff，浏览器花掉它换本平台会话。
  会话里带着"从哪节课来"的线索（`GET /api/auth/sso/context`，载荷里写着 `is_task_association: false`）。
- **P09 的任务上下文只授权"关联"这一件事**：它由发行方签名，点名学生 uuid 与作业，单次使用。
  **教师身份链与真实 edu 资格仍然要在 E09 那边接入**——本候选里的资格名册是 development/test 的实验提供方，
  只证明候选接口存在，不是任何人的身份证明。本包**没有**代写共享 contracts。

登录**不等于**关联，关联**不等于**提交：实践从不记录"已提交"。

## 3 装：两组候选迁移，各自的目录前缀

```
backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js
backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js
backend/migrations-candidates/c05/20260923_001_c05_school_mapping.js
backend/migrations-candidates/c05/20260923_002_c05_session_context.js
```

**同号不同族**：`20260922_00x` 属 p09，`20260923_00x` 属 c05，不要当成同一条迁移的两个版本。
实测执行顺序（knex 按文件名，恰好与真实依赖一致）：先建 P09 账本，再补 write_seq，再建 C05 学校映射列，
最后建 C05 会话上下文表。**重跑是空操作**：实测第二次 `migrate:latest` 应用了 0 条，账本行与 7 比 3 的欠账原样保留。

两条工程口径必须照抄，不要美化：
- **没有任何文件被移进 `backend/migrations/`**；`migrations-candidates/p03/` 也**没有**被执行。
- 两条 `down` 都**不会**自动清空有历史的表：P09 的 `down` 先把欠账写成标记再删列；
  C05 会话表的 `down` 在表里**还有任何一行**（含已过期、已撤销）时具名拒绝。

## 4 起：一个进程，两个开关

```
C05_STUDENT_ENTRY_ENABLED=true                 # 不设/空/false = 关闭且零副作用
IDENTITY_DEPLOYMENT_INSTANCE_KEY=<实例名>       # 票据会钉住它
P09_WEBSITE_ARTIFACTS_ENABLED=true
P09_LAB=<发行方/服务凭据/资格名册的实验文件>     # 仅 development/test
P09_DB_USER / P09_DB_PASSWORD                  # P09 的受限账本角色，不能是应用账号
P09_PREVIEW_TLS_KEY / P09_PREVIEW_TLS_CERT     # 隔离预览域，不能与应用同源
```

**两个开关都关时**：C05 两个端点固定 503、Redis 一个键都没有、P09 账本零行、
历史 `POST /api/auth/sso` 的行为与响应头**完全不变**（实测对照过）。停止就是停进程；
隔离预览监听器随进程退出释放。

自有资源（隔离验收用，不占 edu/C14/TE 的任何东西）：一次性 `mysql:8.0` 与 `redis:7-alpine` 各自随机端口、
后端随机端口、Vite 随机端口、隔离预览域随机端口 + 自签证书。

## 5 最小请求顺序（就是 E09 要接的那条链）

1. `POST /api/auth/sso/exchange`（edu 服务端，HMAC 签名，IP 白名单）→ 拿 `handoff`
2. `302` 到 `https://<实践域名>/auth/sso/consume?handoff=…` → 学生落地，会话建立
3. 学生自己在编辑器里选本人项目与入口页 → `POST /api/p09/website-artifacts/links`
   （`Authorization: Bearer`、`Idempotency-Key`、`X-P09-Task-Context: <签名任务上下文>`）
4. 学生真实保存一次（编辑器自己的写入口）→ 作品从"已关联"变成"制作中"
5. `POST /api/p09/website-artifacts/links/{link_id}/revisions` → 固定一版
   （`link_id` 取自 `GET /links` 列表里的 `link_id` 字段；`artifact_ref` 是对外的不透明作品引用，两者不同）
6. 老师：`POST /api/integrations/edu/website-artifacts/review-sessions`（服务凭据签名 + 评阅任务上下文，
   **点名 `revision_ref` 才是固定版本**，不点名拿到的是学生当前稿的私有预览）→ `open_url` 在隔离域打开

## 6 实测到的 6 组衔接（`dev/c05-p09-lab/check.py`，26 条判定全通过）

| 衔接 | 实测 |
| --- | --- |
| 登录只带线索 | `context.assignment_id` 有值、`is_task_association:false`、`GET /links` 为空；无签名上下文关联 → `task_context_required` |
| 明确关联 + 真实保存 | 关联成 `assign-1`、`state:active`；保存后 `real_save_count` 增加、`work_state` 变 `preview_ready`；载荷里没有任何"已提交" |
| 本人图片固定一版 | 冻结清单里是 `/uploads/joint/pond.png`（归属行属于 C05 刚建的影子账号），`frozen_scope: pages_and_owned_local_assets`；改稿后老师打开**同一个 revision_ref** 仍然只有第一稿、图片仍 200（资源按内容寻址改名），而不点名版本的会话看到的是第二稿 |
| 第二个学生/第二所学校 | `GET /links` 为空；关联他人项目 → `project_unavailable`；上下文点名别人 → `subject_mismatch`；同一张上下文再用 → `task_context_replayed`；学生令牌敲 edu 服务端接口 → `unauthenticated` |
| 教师资格 | 名册外的评阅人 → `not_eligible`；没有资格提供方 → **503 `eligibility_unavailable`**（端点存在并一律拒绝） |
| 重新登录 | 新会话的线索是新的（`assign-2`），而作品关联仍是原来的 `assign-1`、同一个 `artifact_ref`——关联是 P09 的耐久事实，不随会话变，也不会被静默换作业 |

浏览器（桌面 1280 与窄屏 390）：真实落地页 → 同一个浏览器进编辑器 → 面板可见 → 确认关联，
地址栏不留票据，全程没有任何外部源请求。

## 7 与你手上两份旧输入的精确差异

- 相对 **P09 `faa9d2c`**：只有 `ff562cf` 那 4 个文件，而且只改了**迁移的执行条件**——
  独占入口现在固定在一条连接上、会话级 `lock_wait_timeout=15s` 并在还池前还原、
  等待超时与拿不到锁都归为 `p09_exclusive_entry_unavailable`、拒绝附带的观察只读服务端元数据。
  **字段、wire、运行时接口一个都没动**，E09 已写的消费代码不需要改。
- 相对 **C05 `b515443`**：一个字节都没改。

## 8 必须照抄的三条"不要美化"

1. **15 秒只是工程默认值**，不是被批准的运维参数；真实发布窗口该等多久仍需运维确认。
2. `withPinnedConnection` 读取/设置会话超时失败时会 catch 后继续，恢复设置失败也吞错——
   所以**本包不声称"任何故障下都有 15 秒保证"**。联合演练没有触发过这条路径，没有实证就不补修。
3. `LOCK TABLES` 与 `ALTER TABLE` 会**隐式提交**，所以那层"事务"实质是固定连接，不是原子单元；
   部分执行失败之后可能需要**重入收尾**，不能笼统写成"整体事务回滚"。

## 9 仍然缺的（不要按"可上线"排期）

- 没有接真实 edu / Identity；全部发行方、学生、教师、学校都是合成的。
- D-13 发放参数与决-12 学生模式**仍未定**：隔离演练用的是合成数值，生产首登仍按名关闭。
- 换校后不补发额度；`c05_sessions` 保留期限未定；契约 §5 的 refresh 24h 那一半未实现。
- C08 学校开通流程、教师身份链、真实 edu 资格端点都不在本包。
- 两组候选迁移均未晋级；生产开关、出口 IP、真实密钥、launch 地址、实例键、隔离预览域证书均未配置。
- 没有真人验收。
