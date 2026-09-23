# P09 `/state` 作品名：认知索引条目候选（本会话仍只能交候选）

本包在独立 worktree `~/ai-platform-p09-title-20260923`（分支 `codex/p09-state-title`，父版 `ca534dc`）开发，
而本会话的 AOCI MCP 绑定在主工作副本 `~/ai-platform`（`runtime_repository_root` 固定），Volumes v1 只能经 MCP 写入。
因此**本会话没有、也不能把下面的条目写进正式索引**，与前几包的阻点同一条，不重复探测。
合入主副本后调用一次 `aoci_maintain` → `aoci_update_entry`（批次内逐条带 `source_sha256`）即可对齐。

## 本包触及的对象与固定 `source_sha256`

| 仓内路径 | source_sha256 | 本包对语义的增量 |
|---|---|---|
| backend/src/services/websiteArtifact/service.js | 4bc2a495bae90c22e250e7065d01c71a602dd0678ff46558004f7644ba929b23 | `state()` 在取水位/取行的同一事务快照里补上每件作品的**当前名**；名字只来自服务端可核来源，证明不了就 `null` |
| backend/src/services/websiteArtifact/store.js | 9d2967eb95ca886900c6172c5a0ef9f12c86249fb016249e0c95d0f5319841b1 | 新增 `sourceTitles(rows)`（走事务自己的连接读 `html_projects`，缺 GRANT 时 fail-soft 返回空表）与共享键 `titleKey(owner, project)` |
| backend/src/__tests__/helpers/p09Fixture.js | 84a34b9ac3ef91bc9ef03c9c08cedd0d967c36928fb944a91f60e56905dd8a0f | 内存 store 实现同一把所有权规则的 `sourceTitles`；合成来源可改名 |
| backend/src/__tests__/unit/services/websiteArtifactService.test.js | acfa28b7ea0b88de56bab554c5f39b17127b084157e580bde1f466841bfe3660 | 新增 6 条：有名、改名跟随且不产生新事实、来源删了给 `null`、入口页删了仍可命名、他人项目不借名、客户端送不进名字 |
| docs/integrations/p09-e09-consumer-package.md | 2b89f7c67652d05db5f8040af2583b8eb5661eb5f27ec06d2307269a95695e18 | `title` 字段说明：**当前名 vs 事件里的当时名**、`null` 的含义与明示回退 |
| docs/integrations/WEBSITE-REVIEW-TEST.md | 7ccc0acc15e97ef0824f5f4222507617a81483eaa541d60ee44f563a388d9305 | 普通测试单第 9 组：老师看到作品名、改名跟随、无名称时的明示回退 |
| dev/p09-lab/state-title.py | 67b5a827a886679aa4cbb118cb105d97a783fae98060cf574d8aae73934487a9 | 一次真实两端可消费形状的隔离检查（`dev/` 目前在 Managed Scope 外，仅登记事实） |

## 条目正文要写进去的两句不变量

1. **作品名不是账本的字段**：账本从来没有 `title` 列，也不存名字的副本。`/state` 的 `title` 是读取当时从来源
   （`html_projects`，按 owner+project 取）现读的名字；事件里的 `title` 是那件事发生时读到的名字。两者可以不一样，
   这是设计，不是漂移。
2. **证明不了就给 `null`**：来源已删（`source_deleted`）、名字为空、或读来源的权限被收窄时一律 `null`，
   不回事件里翻旧名字冒充现名；消费方按明示回退显示。`entry_removed`（项目还在、入口页没了）仍然可命名。
