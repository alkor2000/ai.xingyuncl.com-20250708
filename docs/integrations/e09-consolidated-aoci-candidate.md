# 合并输入（E09 HTTP 资格 ＋ `/state` 作品名）：认知索引条目候选

与前几包同一条阻点：本会话的 AOCI MCP 绑定在主工作副本 `~/ai-platform`（`runtime_repository_root` 固定），
Volumes v1 只能经 MCP 写入，所以**独立树里只能交候选**，不写正式索引、不改 baseline/scope，也不反复探测。
合入主副本后 `aoci_maintain` → `aoci_update_entry`（逐条带 `source_sha256`）即可对齐。

两个前像各自的条目候选仍然有效，不在这里重抄：
`docs/integrations/e09-aoci-entries-candidate.md`（HTTP 资格）与 `docs/integrations/p09-title-aoci-candidate.md`（作品名）。
本包只新增两个对象，并给出合并后这些文件的现值。

## 新增对象

| 仓内路径 | source_sha256 | 一句话语义 |
|---|---|---|
| docs/integrations/e09-consolidated-input.md | 见提交（本文件同批） | 给 edu 的单一固定输入：两个前像、逐文件 SHA、最小消费命令、精确差异、未证事项、P03 只读盘点 |
| dev/e09-lab/consolidated.py | 17ec0ce01b7460ff6d2c68daa2a4fdd01e0cae33e34a4e6cd70f97f2ebc4e5f2 | 只验"合起来才出现的交集"的隔离脚本（8 条）：双开关关、同实例两问同答、改名不造事实、受限角色缺 GRANT 不退步、问不到资格仍拒绝而名字照给、正式配置只收不透明 ref |

## 合并后这些文件的现值（与两个前像逐字节相同，未二次修改）

| 仓内路径 | source_sha256 |
|---|---|
| backend/src/services/websiteArtifact/eligibility.js | 818e68b8f15a6546e6ad018e8126cf65aed11f5065fecb95d2031bf98b0c14c7 |
| backend/src/services/websiteArtifact/runtime.js | c3224fd18dbed1298e2b26a0f8a26b3a865247b8a9601553115aece775764e76 |
| backend/src/services/websiteArtifact/service.js | 4bc2a495bae90c22e250e7065d01c71a602dd0678ff46558004f7644ba929b23 |
| backend/src/services/websiteArtifact/store.js | 9d2967eb95ca886900c6172c5a0ef9f12c86249fb016249e0c95d0f5319841b1 |
| docs/integrations/p09-e09-consumer-package.md | 2b89f7c67652d05db5f8040af2583b8eb5661eb5f27ec06d2307269a95695e18 |
| docs/integrations/e09-http-eligibility.md | 64b0f1bf93747930b7109bad5e9ea484677d9ec8e35b0b13a69026c020d42d59 |
| docs/integrations/JOINT-ENTRY-TEST.md | fc35d29fac0028cc0eb8739b050173d2cba6e15b35ad250c45a8447ed4d2605c |
| docs/integrations/WEBSITE-REVIEW-TEST.md | 7ccc0acc15e97ef0824f5f4222507617a81483eaa541d60ee44f563a388d9305 |

## 条目正文要带上的一条新不变量

**作品名要经过受限账本角色**：`/state` 的 `title` 由账本事务自己的连接读来源表（`html_projects`），
因此那条角色需要 `SELECT` 授权；**缺了不会让读取失败**，只是 `title` 一律 `null`（fail-soft）。
这条在真实受限角色上撤授权又补回来实测过，不是推断。
