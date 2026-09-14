# AI训练专区（ai-lab）开发说明

面向中小学的"真实数据、真实训练、三集制测试"实验模块。方案全文见课程规划稿与《AI训练专区实验体系》页面。

## 任务模板（backend/src/config/aiLabTasks.js）
| 键 | 学段 | 类型 / 引擎 | 一句话 |
|---|---|---|---|
| L1 它能分清我的两样东西吗 | 小学 | 图像 / image-knn | 两类各 10 张，留出集 + 换条件集考它 |
| L3 给 AI 喂错数据会怎样 | 小学 | 图像 / image-knn | 干净版 → 混入 20% 错标再训一版 → 揭晓 → 恢复 |
| L4 多少张够用 | 小学 | 图像 / image-knn | 每类 3 / 10 / 30 张各训一版，看样本量–准确率曲线 |
| M1 校园侦探 | 高中 | 图像 / image-knn | 数据卡 → 六类各 30 张 → 完整流程 |
| P1 模型认的是物体还是背景 | 初中 | 图像 / image-knn | 同背景训练，换背景测试 |
| P2 换一个环境还能识别吗 | 初中 | 图像 / image-knn | 自设测试条件表，预计 vs 实测 |
| P3 人工规则 vs 数据规则 | 初中 | 表格 / table-rules + table-tree | 手写 if-then 规则与决策树在同一批测试集对照 |
| P7 AI 给出的校园资讯可信吗 | 初中 | 文本 / verify | 拆说法 → 逐条核实 → 改写 → 反思（不训练模型） |
| L2 声音也能被认出来吗 | 小学 | 声音 / audio-knn | 拍手/敲桌/口哨各 10 段，换同学、加噪声测试 |
| L5 AI 讲的动物故事哪里不对 | 小学 | 文本 / verify | 教师投屏动物故事，对照图鉴找预埋的 1 处错误 |
| L6 规则是我定的 | 小学 | 表格 / table-rules + table-tree | 动物卡/垃圾卡属性，手写规则 vs 决策树 |
| M2 让分类器更公平 | 高中 | 图像 / image-knn | 按采集者分组看准确率，补弱势组数据再训 |
| M3 决策树 vs 神经网络 | 高中 | 表格 / table-tree + table-mlp | 同表同留出集，树与小 MLP 对照，看损失曲线 |
| M4 听懂关键词 | 高中 | 声音 / audio-knn | 十个中文指令词，换说话人、换设备 |
| M5 情绪翻译器 | 高中 | 文本 / text-nb | 双人标注 + kappa，朴素贝叶斯，换话题测试 |
| P6 校园声音地图 | 初中 | 声音 / audio-knn | 五类校园声音，换地点、加噪声 |
| free 自由实验 | 全部 | 图像 / image-knn | 自定类别自采数据 |

模板字段：`kind`（image / table / audio / text）、`engine`、`steps`（工作台按此渲染，重复步骤前端去重）、`presets`（推荐预置包）、`config`（`mislabel_ratio`、`per_class_limits`、`max_depth_options`）。

## 结构
- 前端页面 `frontend/src/pages/aiLab/`：`AiLab.jsx` 列表与新建（按学段分组的任务卡）；`ProjectWorkspace.jsx` 工作台，按 `kind` 切换面板：图像用 DatasetPanel / CapturePanel / TrainPanel / EvaluatePanel，表格用 TablePanel / RuleEditor / TreeTrainPanel / TableEvaluatePanel，文本用 VerifyWorkspace；附加步骤 ImportPresetModal（导入预置包）、MislabelPanel（错标/恢复）、DataCardForm（数据卡）、SampleCurve（样本量曲线）。
- 浏览器内引擎 `frontend/src/pages/aiLab/engine/`：`audio/spectrogram.js`（WAV → 44.1kHz 单声道 → OfflineAudioContext+AnalyserNode 取 43×232 dB 频谱图，参数与 speech-commands 一致）、`audio/audioFeatureExtractor.js`（自托管 speech-commands 18w 层模型截到 dense_1，2000 维嵌入）、`audio/recorder.js`（麦克风 1 秒录音 → WAV）、`text/tokenize.js`（单字+双字）、`text/naiveBayes.js`（多项式 NB + 逐词解释）、`text/agreement.js`（Cohen's kappa）、`tabular/mlp.js`（TF.js 单隐层 MLP，损失曲线，权重序列化）、`modalities.js`（图像/声音共用训练与测试面板的适配层）；`featureExtractor.js`（自托管 MobileNet v1 0.5，截到全局平均池化层，512 维嵌入）、`knn.js`（余弦 kNN）、`metrics.js`、`occlusion.js`（遮挡热图）、`tabular/decisionTree.js`（CART 基尼决策树，可展开成规则）、`tabular/rules.js`（手写规则求值与校验）、`tabular/stats.js`（各类范围、散点范围）。
- 状态 `frontend/src/stores/aiLabStore.js`：项目/数据集/样本/模型/评测读写，预置包导入、表格加行、错标/恢复，过程事件 2 秒合并上报。
- 模型权重 `frontend/public/models/mobilenet_v1_050_224/`（约 5MB）与 `speech_commands_18w/`（约 5.7MB），都不走外网。
- 后端：`routes/aiLabRoutes.js`、`controllers/AiLabController.js`、`services/aiLab/`（AiLabService、AiLabPresetService、presetPacks、splitHoldout、mislabel）、迁移 `20260913_001_create_ai_lab_tables.js`（六张表 + 系统模块登记）与 `20260914_001_ai_lab_tabular_presets.js`（datasets.kind/columns，samples.payload/original_class_key/origin_ref，file_path 允许 NULL）。
- 预置数据包 `backend/presets/ai-lab/<key>/manifest.json`：sounds-synth（合成哨音/敲击/沙沙声 WAV，换条件集叠加噪声/换音高）、campus-messages（原创校园留言 150+45 句，三类情绪）、animal-cards / garbage-cards（属性卡表格，`text` 列是名字不参与训练）、fruits-mini（Fruits-360 六类，CC BY-SA 4.0，换条件集由平台合成彩色/深色背景）、shapes（合成三类图形，CC0）、campus-items（合成校园物品属性表，CC0）、penguins（palmerpenguins，CC0，2009 年为换条件集）、iris（UCI，CC BY 4.0）。接口 `GET /presets`、`POST /datasets/:id/import-preset`；图片经 sharp 规范后复制到学生的 uploads 目录，`source='preset'`，按 `origin_ref` 去重。

## 三集制
- 训练集：学生自采（摄像头连拍或上传）、手工加行，或预置包导入；样本带采集条件标签与来源。
- 留出测试集：`POST /datasets/:id/lock` 在训练前按类别随机留出 20%（确定性种子），训练页不显示这些样本/行。
- 换条件集：`split='shift'` + `shift_set` 名称；同分布准确率减去最差换条件准确率 = 泛化差距。表格包的换条件集是来源不同的另一批行（另一所学校、另一年）。

## 表格实验（P3）
- 手写规则 `{rules:[{conditions:[{col,op,value}],label}], default_label}`，自上而下第一条命中；保存为 `engine='table-rules'` 版本，草稿存在 `project.context.rules`。
- 决策树：CART + 基尼，数值列阈值二分、类别列等值二分，`max_depth` 可选；artifact 是整棵树 JSON；同一测试面板可对照两种版本。

## 错标实验（L3）
`POST /datasets/:id/mislabel {ratio}` 按类别分层随机改标签并记 `original_class_key`；`restore-labels` 恢复。训练面板把当时的错标数写进 `params.mislabeled_count`，对照表多一列"错标数"。

## 过程事实
26 种事件类型：首期 14 种（`task.open`、`predict.write`、`dataset.add/remove/relabel`、`split.lock`、`train.run`、`test.run`、`error.view`、`condition.design`、`help.request`、`model.compare`、`reflection.write`、`model_card.write`）加 `preset.import`、`dataset.mislabel`、`dataset.restore`、`rules.write`、`data_card.write`、`claim.write`、`claim.verify`、`claim.revise`、`annotation.write`、`agreement.compute`、`fairness.view`、`audio.play`。只记发生了什么，不记结论。

## 本地联调
1. `make dev`（后端 :4000 + 前端 :3000；vite 已把 `/api` 与 `/uploads` 代理到后端）。
2. 后端迁移：`cd backend && npx knex migrate:latest`（本地 practice-mysql :3307）；生产走 `make migrate`。
3. 登录后左侧菜单出现"AI训练专区"（系统模块 `ai_lab`，`allowed_groups` 为空即全员可见）。
4. 训练在浏览器里跑：Chrome 内核建议 100+；无摄像头的机器用预置包或"上传图片"。
5. 自测：`cd backend && node scripts/ai-lab-smoke.cjs`（144 项）；`cd frontend && npx vitest run src/__tests__/unit/aiLab`。

## 已知限制
- 声音引擎只做 1 秒短音分类（speech-commands 特征），没有连续识别；P4/P5（聚类、推荐模拟）与 H 段实验未做；M4 没有预置中文关键词包，需自采。
- 课件内启动上下文（`{lesson_id, assignment_id}`）依赖跨系统待决项 D-7，`context` 字段已预留。
- 样本图片经 `/uploads/ai-lab/...` 静态服务，与其他上传物一致，不鉴权。
- P7 的示例材料写在前端 `content/verifyMaterials.js`（中英各两份），教师可让学生粘贴自己的材料。
