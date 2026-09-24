# P03 当前固定候选：重试等待增量已集成

分支 `codex/p03-current-rc`，父版 **`f737a89e489046c58e92f0b2a8c4d11f0fadf106`**（P03 线当前 HEAD）。
默认关闭、未合 main、未发布、未晋级迁移、未开生产。

## 1 父版是哪一个，为什么

| 线 | HEAD | 有没有 P03 入口代码 |
| --- | --- | --- |
| `main` | `91bb2c0`（feedback 多图） | **没有**：`ArtifactHandoff.jsx` / 其测试 / 入口交付文档在 main 上都不存在 |
| P03 线 | **`f737a89`** | 有，这是入口整包的固定提交 |

补丁 `4f01792` 的基线正是 `f737a89`，所以**实际父版没有移动**，本次集成不需要任何手工合并。
`main` 上没有 P03 的任何对应文件，把 P03 增量往 main 上叠是另一回事，由总控按固定输入统一安排。

**文案冲突逐项核过**（`chat.json`，P03 线 vs `main`）：
P03 线是 main 的**严格超集**——多出 71 个 `chat.handoff.*` 键，
**main 独有键 0 个、同键不同文案 0 处**。也就是说将来并入 main 时只有新增，没有覆盖。

## 2 集成了什么（5 项），没有集成什么（2 项）

五项按 manifest 的 `candidate_sha256` **逐字节核对通过**：

| 路径 | sha256 |
| --- | --- |
| frontend/src/components/chat/ArtifactHandoff.jsx | 68315d5ef28e5ff6837ea2be187d014ea8106274f23767b77041ad2bd96825bb |
| frontend/src/__tests__/unit/components/ArtifactHandoff.test.jsx | abddd6a2dd188fe9717b79f0e7aa6863c4a59e56f13bdbc1c6c93a36ce3c4091 |
| frontend/src/locales/zh-CN/chat.json | b5bb7ed4da5bb250c2cac3bc3fe616d9a8b02ab13d21bbe4fc73c8a34f7e42e6 |
| frontend/src/locales/en-US/chat.json | d50c757bebd2d7476f99344b13e2b8a866dfa0e495f0a9f39d38e658fc00e03c |
| docs/integrations/p03-entry-deploy-candidate.md | 9981455517e011f0506ad84917c2132300a75ca768a87579837937c4fb78160d |

集成前先核过这 7 个文件在本树的**前像**与 manifest 的 `base_sha256` 全部一致，父版因此是可证的。
集成方式是从同仓已有提交 `git checkout 4f01792 -- <路径>` 取字节，不经由补丁文件。

**`.aoci/baseline.json` 与 `aoci.code.txt` 没有集成**，保持本树父版字节：
认知服务绑定在主工作副本（`runtime_repository_root=/home/hanying/ai-platform`），
把另一个副本的认知资产覆盖进来会替掉主线认知，派单明确不允许。
这两项按 source-bound 候选交付，限制写在 `docs/integrations/p03-rc-aoci-candidate.md`。

## 3 依赖锁与构建

`backend/` 与 `frontend/` 的 `package.json` / `package-lock.json` 与 `f737a89` **逐字节相同，未新增依赖**。

```bash
# 依赖（与父版同一套锁）
cd backend && npm ci
cd ../frontend && npm ci
# 受影响组件测试
cd frontend && npx vitest run src/__tests__/unit/components/ArtifactHandoff.test.jsx
# 生产构建
cd frontend && npx vite build
# 后端（P03 默认关闭；开启另需 Identity/目标就绪，见 §5）
cd backend && node src/server.js
```

## 4 这一轮验到了什么

- **受影响组件测试 15/15 通过**（原 7 + 新 8），在本候选树、本父版上重跑，不是沿用上游那次。
- **前端生产构建通过**（保留既有大块提示）。
- 组件测试是**模拟 API + 可控时钟**；**不是**真实浏览器、不是三端、没有真人。

## 5 有限入口浏览器检查：被产品自身的准入门挡住

要核的四条是：等待时不能保存/重试/刷新、倒计时结束零自动请求、重开恢复既有等待、R 到期无对外操作。
脚本 `dev/p03-triad/retry_cooldown.py` 已就绪（并给入口 worker 加了一条 `cooldown` 观察命令：
读倒计时文案、三个对外按钮的存在与禁用状态、以及观察窗口内页面发出的每一个入口请求）。

实跑到**账本建好**为止全部正常：隔离 mysql 起来、本地库结构前像导入、knex 应用账本候选迁移、
受限角色 4 条授权、114 张表。**下一步启动后端即被产品自己挡住**：

```
服务器启动失败: handoff_identity_not_ready
  at identityFacts (backend/src/services/artifactHandoff/formalRuntime.js:83)
```

P03 正式运行时在**启动时**就要 Identity 事实，而 Identity provider 是**外仓 Go**；
本会话构建/运行外仓 Go 已被自动审核拒绝并处于 HOLD。**没有绕过、没有转交、没有改设置。**
证据：`storage/private/p03-rc-validation/run-20260923T075231Z/report.json`
（`stage: blocked_by_admission_gate`，`refusal_code: handoff_identity_not_ready`）。

**放行之后按原样再跑一次即可**，四组判定与观察命令都已写好。
这一格因此是 **pending**，不是"通过"，也不是"不适用"。

## 6 与 Identity 新 RC / T11 r2 的版本衔接

这组 UI 集成**不依赖**它们，已经独立完成；但那条被挡住的浏览器检查需要它们就位：

- **Identity**：`dev/p03-triad/candidate-entry.json` 里钉的 provider 提交是 `9b6ca011…`。
  Identity 正在出新的 provider 候选；真正跑三端时要用**总控指定的那一版**，不要用这里的旧钉值。
- **T11 目标**：同一份配置钉的是 `target_parent a5dc5d15…`（release `20260921-t11-runtime-r2`）。
  T11 r2 之后的固定目标同样由总控指定。
- 本包**不代定**这两个版本，也没有改那份配置。三端联验由总控按固定输入统一安排。

## 7 仍然缺的

真实教师与真机验收（待验）；有限入口浏览器检查 pending（见 §5）；
北大 enrollment、Identity 生产 policy/pairs、TE 正式目标、迁移晋级、受限角色启用、生产开关——
全部沿原准入门禁，本包不代决；AOCI 正式对齐受限于认知服务只绑主副本。
