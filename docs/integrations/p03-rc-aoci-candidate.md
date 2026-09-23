# P03 当前候选的认知索引：source-bound 候选与唯一限制

## 为什么这一版没有把上游的两个认知资产带进来

上游补丁 `4f01792` 里有七个文件，其中两个是认知资产：

| 路径 | 上游候选 sha256 | 本树的处理 |
| --- | --- | --- |
| `.aoci/baseline.json` | cfcfee2e6823be9dbfd201e976663ac3223bcb6fe07e84318b9caebf8ff0e308 | **未集成**，保持父版 `28f7420649831c29…` |
| `aoci.code.txt` | 86751b564f29d77051ef657e61b4a6966a49260a984feedcc813657a59078d38 | **未集成**，保持父版 `6af916559cf8170b…` |

原因是具体的，不是保守：认知服务绑定在**主工作副本**
（`aoci_overview` 的 `runtime_repository_root = /home/hanying/ai-platform`，接口上没有指向别的仓库根的参数）。
把另一个隔离副本生成的 `aoci.code.txt` / `baseline.json` 覆盖进来，等于用那一份副本的认知替掉主线认知；
派单明确要求"不可覆盖主线认知"。

**唯一限制**：隔离副本无法按正常流程维护自己的正式认知卷，需要的是"对指定仓库根打开独立 volume
并写入、且不影响主副本 baseline/scope"的能力。在此之前，本文件就是 source-bound 候选。
**没有为了 aligned 写主副本，也没有反复探测。**

## 本包新增/受影响对象（source-bound）

| 仓内路径 | sha256 | 状态 |
| --- | --- | --- |
| frontend/src/components/chat/ArtifactHandoff.jsx | 68315d5ef28e5ff6837ea2be187d014ea8106274f23767b77041ad2bd96825bb | 受影响（重试等待） |
| frontend/src/__tests__/unit/components/ArtifactHandoff.test.jsx | abddd6a2dd188fe9717b79f0e7aa6863c4a59e56f13bdbc1c6c93a36ce3c4091 | 受影响（15 条） |
| frontend/src/locales/zh-CN/chat.json | b5bb7ed4da5bb250c2cac3bc3fe616d9a8b02ab13d21bbe4fc73c8a34f7e42e6 | 受影响（倒计时文案） |
| frontend/src/locales/en-US/chat.json | d50c757bebd2d7476f99344b13e2b8a866dfa0e495f0a9f39d38e658fc00e03c | 受影响 |
| docs/integrations/p03-entry-deploy-candidate.md | 9981455517e011f0506ad84917c2132300a75ca768a87579837937c4fb78160d | 受影响 |
| dev/p03-triad/retry_cooldown.py | f96aef61c35eecbee7752197b6757928c8a6ab8c8e6c2ee753ebd46d497eddf4 | 新增（有限入口检查，当前 pending） |
| dev/p03-entry-e2e.cjs | 145010dfef0cd96e46c03c7bd348f54dca37635f81a3acd81333812e7418f3a9 | 受影响（新增 cooldown 观察命令） |

```
ArtifactHandoff.jsx[EU7M]: F:C·保存到备课资源库的入口面板：选段/附件/标题→预览→显式确认→状态与重试，**并按 Retry-After 与本地 retry_at 的较晚截止等待** | R:code:frontend/src/utils/api.js,code:frontend/src/locales/zh-CN/chat.json,code:backend/src/routes/artifactHandoffEntry.js | A:ArtifactHandoff | S:预览之前一个字节都不发；等待中确认/重试/刷新三个对外按钮全部禁用并显示中英文倒计时，倒计时结束**只恢复按钮、零自动请求**；等待来自账本因此刷新/重开仍在等；过了 R 之后刷新与重试不再出现且处理函数再核一次当前时间；保存/刷新失败只读一次本地操作元数据，读取失败保留原状态
retry_cooldown.py[TQ4S]: F:C·重试等待的有限入口浏览器检查：等待中不可操作、倒计时结束零自动请求、重开恢复等待、R 到期无对外操作 | R:code:dev/p03-triad/entry_scenarios.py,code:dev/p03-entry-e2e.cjs,code:frontend/src/components/chat/ArtifactHandoff.jsx | A:python3 dev/p03-triad/retry_cooldown.py | S:当前**被产品自身的准入门挡住**——P03 正式运行时启动即要 Identity 事实(formalRuntime.identityFacts)，而 Identity provider 是外仓 Go 且本会话构建/运行处于审批 HOLD；账本与隔离库已建好(114 表、候选迁移、受限角色 4 授权)，放行后原样再跑一次即可；等待状态由本地账本 fixture 写入，不冒称真实目标返回
```
