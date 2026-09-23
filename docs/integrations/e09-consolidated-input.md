# 给 edu E09 的单一固定实践输入（HTTP 资格 ＋ `/state` 作品名）

edu 不需要在两个候选之间自己拼代码：这一份就是两支合起来之后的**一个固定提交**。

| 项 | 值 |
|---|---|
| 固定提交 | 分支 `codex/e09-consolidated-input` 的头，也就是**本文件所在的这一条提交**；它的父是合并提交 `49b2e3ce8aac82a5788779f095c16e8a2fea8644`（精确值见交付回执） |
| 两个前像 | `07dd196af2f33baf6f76e93691b438f9a4bcd222`（E09 HTTP 资格）、`60e6b99e4c5c681c5263ecbb140c2b8ad8d640c0`（P09 `/state` 作品名） |
| 共同祖先 | `ca534dcaf893341c91d6a332008f20534e6b01d9`（已核收的 C05＋P09 联合候选） |
| 默认状态 | C05 与 P09 **两个开关都默认关**；资格提供方缺配置仍是 `eligibility_unavailable` |
| 依赖锁 | `backend/` 与 `frontend/` 的 `package.json`/`package-lock.json` 在三处（祖先、两前像、合并）**字节相同**，没有新依赖 |

## 1 合并本身是可证的，不是"重写了一遍"

- 两支都从同一个 `ca534dc` 分出，**触及的文件零重叠**（E09 10 个、作品名 8 个）。
- `diff(ca534dc→60e6b99)` 与 `diff(07dd196→49b2e3c)` 的补丁**哈希相同**（`bc8ec330…`）；反向同理。
  也就是说：把作品名接到 E09 上、或把 E09 接到作品名上，得到的是同一棵树。
- 合并树 2645 个文件里，**每一个**都等于某一侧的字节，`matching neither side: 0`。
- 语义上也没有互相放宽：两支的单测**一起**跑 **92/92 通过**（6 个套件）。

## 2 逐文件 SHA（`sha256`，合并树内即此值）

来自 E09 HTTP 资格候选 `07dd196`：

| 仓内路径 | sha256 |
|---|---|
| backend/src/services/websiteArtifact/eligibility.js | 818e68b8f15a6546e6ad018e8126cf65aed11f5065fecb95d2031bf98b0c14c7 |
| backend/src/services/websiteArtifact/runtime.js | c3224fd18dbed1298e2b26a0f8a26b3a865247b8a9601553115aece775764e76 |
| backend/src/__tests__/unit/services/websiteArtifactEligibility.test.js | 42898ef7c92220e7f3e6b009170b178e126d6aa3b2b9c5bd715a02dcec08d44d |
| dev/e09-lab/check.py | e5333296efb5b704caafa3f8a0f67f83f2a5a37583dda26fe1102b762c347746 |
| dev/e09-lab/revocation.py | 236710a5289e1cb603d0158aa6d44acd5c73d69dbab3540b4b9bd026305c9d71 |
| dev/e09-lab/browser.cjs | e3d602fc0cfaa7f3c62aff82f16c83f6448148db27b22d3f9b3679783579e1d3 |
| dev/e09-lab/stub.cjs | a899c0b364ca74c2365b64ff00e43c58c8df734fcdb549c4ac56861ca32deba5 |
| docs/integrations/e09-http-eligibility.md | 64b0f1bf93747930b7109bad5e9ea484677d9ec8e35b0b13a69026c020d42d59 |
| docs/integrations/e09-aoci-entries-candidate.md | 2465917372e4aad633657c406b599d96fc55d6f3a3fd747f7d361cec61f19221 |
| docs/integrations/JOINT-ENTRY-TEST.md | fc35d29fac0028cc0eb8739b050173d2cba6e15b35ad250c45a8447ed4d2605c（本包在其末尾加了第十二组，见第 7 节） |

来自 P09 `/state` 作品名候选 `60e6b99`：

| 仓内路径 | sha256 |
|---|---|
| backend/src/services/websiteArtifact/service.js | 4bc2a495bae90c22e250e7065d01c71a602dd0678ff46558004f7644ba929b23 |
| backend/src/services/websiteArtifact/store.js | 9d2967eb95ca886900c6172c5a0ef9f12c86249fb016249e0c95d0f5319841b1 |
| backend/src/__tests__/helpers/p09Fixture.js | 84a34b9ac3ef91bc9ef03c9c08cedd0d967c36928fb944a91f60e56905dd8a0f |
| backend/src/__tests__/unit/services/websiteArtifactService.test.js | acfa28b7ea0b88de56bab554c5f39b17127b084157e580bde1f466841bfe3660 |
| dev/p09-lab/state-title.py | 67b5a827a886679aa4cbb118cb105d97a783fae98060cf574d8aae73934487a9 |
| docs/integrations/p09-e09-consumer-package.md | 2b89f7c67652d05db5f8040af2583b8eb5661eb5f27ec06d2307269a95695e18 |
| docs/integrations/p09-title-aoci-candidate.md | 72eb79998917f5217ae7c1c9ca2414a3074de30fb1c61e507e47ab75d099cbe5 |
| docs/integrations/WEBSITE-REVIEW-TEST.md | 7ccc0acc15e97ef0824f5f4222507617a81483eaa541d60ee44f563a388d9305 |

## 3 相对两个旧输入的精确差异

- **对 E09 `07dd196` 而言多了什么**：`/state` 的每件作品带 `title`（当前来源名，证明不了给 `null`），
  以及它的单测/实验脚本与字段说明。资格语义、拒绝词汇、绝对超时、正式配置门**一个字节没动**。
- **对作品名 `60e6b99` 而言多了什么**：`mode:'http'` 资格提供方（真实 HTTPS、绝对调用预算、正式配置只收不透明 ref）、
  其单测与两个实验脚本。账本、事件、`/state` 的其它字段与水位语义**一个字节没动**。
- **本包自己新增的两个文件**（既不属于前者也不属于后者，见第 6 节）：一份合并说明（本文件）＋一个只验"合起来才出现的交集"的脚本。

## 4 最小消费命令（edu 侧）

```bash
# 一、当前状态快照（每件作品带 title）
curl -sS "https://<practice-host>/api/integrations/edu/website-artifacts/state?school_ref=<school>" \
  -H "x-p09-client: edu" -H "x-p09-key-id: k1" \
  -H "x-p09-timestamp: <unix秒>" -H "x-p09-nonce: <一次性>" -H "x-p09-signature: <见消费包 §2b>"
# 二、增量事件（title 是各自发生时的名字）
curl -sS "https://<practice-host>/api/integrations/edu/website-artifacts/events?school_ref=<school>&cursor=<水位>"
```

`/state` 只收 `school_ref` / `assignment_ref` / `student_uuid`：**多带一个参数就是 `invalid_request`**（签名覆盖排序后的 query）。
资格提供方的配置片段与 `reason` 词汇见 `e09-http-eligibility.md`；字段语义（当前名 vs 事件里的当时名、`null` 的含义）见
`p09-e09-consumer-package.md` §3。

## 5 运维必须知道的一条（合并后才成立）

作品名由**受限账本角色**去读来源表，所以那条角色需要 `GRANT SELECT ON <db>.html_projects`
（`restrictedRoleGrants({..., sourceTables:['users','html_projects','html_pages']})` 生成的正是这条）。
**少给这条授权不会让读取失败**：`/state` 仍然 200、其它字段照旧，只是 `title` 一律 `null`。这一点是在真实受限角色上
撤授权又补回来实测的，不是推断。

## 6 本包自己新增的两个文件，和它们证到什么

| 仓内路径 | sha256 |
|---|---|
| docs/integrations/e09-consolidated-input.md | （本文件，见提交） |
| dev/e09-lab/consolidated.py | 17ec0ce01b74c3c35ab43f91967ebc5fafaef77cc9d223a0935a1f9545f0f504 |

两支各自的验收**没有重写**，而是在这棵合并树上原样又跑了一遍：
`dev/p09-lab/state-title.py` 4 条全过、`dev/e09-lab/revocation.py` 10 条全过、
两边单测**一起** 92/92 通过（6 套件，含真实滴字节服务器的绝对预算那条）。

`dev/e09-lab/consolidated.py` 只验"合起来才出现的交集"，**8 条全过**（一次运行 35 秒，证据
`storage/private/e09-consolidated/run-20260923T134752Z/report.json`）：

| 验的是什么 | 实测 |
|---|---|
| 两个开关都关 | C05 `student_entry_disabled`、P09 学生面与 edu 读都 ≥400、redis 0 键、账本 0 行 |
| 同一个实例同时回答两个问题 | 本班老师打开被点名那一版 200（页面与图片都出来了），同一实例 `/state` 给出"校园节水网站"，`complete:true`、`pending_reconcile:0` |
| 改名跟随读取但不造事实 | `/state` 变成"（第二稿）"；八个计数/状态字段**逐一相同**；事件 **4 条→4 条**（created/updated/preview_ready/revision_fixed），每条仍带发生当时的"校园节水网站" |
| 受限角色缺 `html_projects` 的 SELECT | `/state` 仍 200、`complete:true`、其它字段一字不差，`title` 为 `null`；补回授权后名字立刻回来 |
| 资格提供方下线 | 评阅会话 **503 `eligibility_unavailable`**（不放行），而同一时刻 `/state` 照样给名字 |
| 正式配置只收不透明 ref | 用运行时读配置的那个入口在 `NODE_ENV=production` 下试三种配置：明文 `mapping`、明文 `reviewer_refs` 都 `refused:invalid_request`，只有不透明那份 `accepted` |

失败运行**没有覆盖**，都留在 `storage/private/e09-consolidated/`：三次是实验脚本自己的错
（`node()` 返回值取错键、把 `/events` 的字段名当成 `events` 而不是 `facts` 并自己拼 `cursor=0`、
把配置入口写成不存在的 `httpSpec`），一次是这台机器同时跑着别的会话时浏览器工人在答复前被挤住
（截图已落盘、超时的是实验室的等待）。其中第二条尤其要记：改成读 `facts` 之前，"改名没有新增事件"
比较的是 0 与 0，**等于什么都没证明**。

## 6 未证事项（照写，不要改口径）

- **edu 的真实 Go 判定未执行**：跨仓编译/运行仍在既有审核 HOLD。实验里的 edu 资格端点是 `dev/e09-lab/stub.cjs`——
  线形与签名构造真实（对过 edu 自己发布的向量），但它**不是** edu 的判定代码，也不是 edu 的名单库。
  因此"HTTPS 资格正例/拒绝/不可用"只能读成**集成行为已验**，不能读成两端真实鉴权已通过。
- "edu 的列表里真的显示出这个名字"待 edu 自验；本方只证明它**能拿到**。
- 真人老师/学生未验；生产 DDL/配置/发布/迁移晋级/开关/凭据一项都没动；未合 main。
- 另一条 P03 主线合成候选 `77a9ccf`（`91bb2c0` ＋ `b2adc68` 的合并）**只做只读盘点**：它改 91 个文件，
  与本包的 `websiteArtifact*` / `studentEntry` / 资格代码**交集为 0**，是独立写入面，本包没有顺手并入。
