# AI训练专区（ai-lab）首期开发说明

面向中小学的"真实数据、真实训练、三集制测试"实验模块。首期只做图像分类引擎（E1）和两个任务模板（P1 模型认的是物体还是背景、P2 换一个环境还能识别吗）以及自由实验；方案全文见课程规划稿与《AI训练专区实验体系》页面。

## 结构
- 前端页面 `frontend/src/pages/aiLab/`：`AiLab.jsx` 列表与新建；`ProjectWorkspace.jsx` 工作台（预测 → 采集 → 锁定留出集 → 训练 → 留出测试 → 换条件测试 → 错误分析 → 版本对照 → 模型卡 → 时间线）。
- 浏览器内引擎 `frontend/src/pages/aiLab/engine/`：`featureExtractor.js`（自托管 MobileNet v1 0.5，截到全局平均池化层，512 维嵌入）、`knn.js`（余弦 kNN，可序列化）、`metrics.js`（准确率、逐类、混淆矩阵、泛化差距）、`occlusion.js`（遮挡热图）、`imageUtils.js`。
- 状态 `frontend/src/stores/aiLabStore.js`：项目/数据集/样本/模型/评测的读写，过程事件 2 秒合并上报。
- 模型权重 `frontend/public/models/mobilenet_v1_050_224/`（约 5MB，从 tfjs-models 公共存储下载的 Keras 层模型；不走外网）。
- 后端 `backend/src/routes/aiLabRoutes.js` 等（见 `backend/src/config/aiLabTasks.js` 任务模板、`backend/migrations/20260913_001_create_ai_lab_tables.js` 六张表与系统模块登记）。

## 三集制
- 训练集：学生自采（摄像头连拍或上传）或预置；样本带采集条件标签（背景/角度/光线/设备）与来源。
- 留出测试集：`POST /datasets/:id/lock` 在训练前按类别随机留出 20%（确定性种子），训练页不显示这些样本。
- 换条件集：`split='shift'` + `shift_set` 名称，与训练集不同条件下采集；同分布准确率减去最差换条件准确率 = 泛化差距。

## 过程事实
14 种事件类型（`task.open`、`predict.write`、`dataset.add/remove/relabel`、`split.lock`、`train.run`、`test.run`、`error.view`、`condition.design`、`help.request`、`model.compare`、`reflection.write`、`model_card.write`）只记发生了什么，不记结论；教师/管理员在工作台底部的时间线里查看。

## 本地联调
1. `make dev`（后端 :4000 + 前端 :3000；vite 已把 `/api` 与 `/uploads` 代理到后端）。
2. 后端迁移：`cd backend && npx knex migrate:latest`（本地 practice-mysql :3307）。
3. 登录后左侧菜单出现"AI训练专区"（系统模块 `ai_lab`，`allowed_groups` 为空即全员可见）。
4. 训练在浏览器里跑：Chrome 内核建议 100+，WebGL 可用时几秒内完成；无摄像头可用"上传图片"。

## 已知限制（首期）
- 只有图像分类引擎；声音、表格、文本引擎与生成式 AI 核验工作台按方案后续加。
- 预置数据集资源包尚未打包；`source='preset'` 已预留。
- 课件内启动上下文（`{lesson_id, assignment_id}`）依赖跨系统待决项 D-7，现在 `context` 字段已预留。
- 摄像头帧与样本图片只在学生点击"上传"后才发到服务器；样本经 `/uploads/ai-lab/...` 静态服务，与其他上传物一致，不鉴权。
