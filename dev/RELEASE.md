# 生产发布流程

生产环境：`https://ai.xingyuncl.com`，服务器 SSH 别名 `practice`，代码目录 `/var/www/ai-platform`，PM2 进程 `ai-platform-auth`（后端 :4000）。

本文是发布的唯一依据。不要绕过它直接 `ssh practice` 手改生产。

---

## 零、先记住三条硬规则

1. **`rebuild.sh` 不装依赖、不跑数据库迁移。** 它只做：环境检查 → `npm run build` 前端 → `pm2 delete all` + `pm2 start ecosystem.config.js` → 健康检查。依赖变化由 `make deploy` 检测到 `package-lock.json` 变更时补 `npm ci`；迁移必须走 `make migrate`。
2. **`rebuild.sh` 会把 PM2 进程全部删掉重建**，后端有几秒不可用；不要在业务高峰发布。
3. **迁移与代码的先后顺序取决于改动方向，搞反了会炸生产。** 见第三节。

`make deploy` 在动服务器之前会自动做一次数据库备份（`backend/scripts/db_backup.sh` → `/var/backups/ai-platform/mysql/`），但这只是兜底，带数据库改动的发布仍要自己先跑 `make migrate` 的备份门并在本地演练。

---

## 一、发布类型

| 类型 | 特征 | 要做迁移吗 |
|---|---|---|
| **A. 纯代码** | 只改 JS/JSX/语言包，不碰表结构 | 否 |
| **B. 加法式迁移** | 新增列、新增表、新增索引 | 是，**迁移先行** |
| **C. 减法式迁移** | 删列、删表、改列类型、加非空约束 | 是，**代码先行**，见 3.2 |

---

## 二、发布前检查清单

- [ ] 功能在本地跑通，**并且在浏览器里实际点过**（`make dev`），不是只有接口测试通过
- [ ] `make build` 全绿（后端加载完整模块图，前端 `vite build`；`make deploy` 会再跑一遍）
- [ ] `make test` 里你动过的模块的用例全绿。**已知陈旧用例（2026-09-13 起）**：`ImageService.test.js` 的 5 个 `convertSizeForSeedream` 用例（代码 9/3 已改为精确像素映射）和 `MessageService.test.js` 的 1 个 PDF `buildAIContext` 用例（代码已改为 base64 内嵌）——它们在改动前就失败，修好之前不算回归
- [ ] 改了后端且涉及数据库：`make test-integration` 通过（连本地 `ai_platform_test`）
- [ ] 国际化：新文案两侧语言包都加了、没有 `t()` 兜底（规约见 AOCI 索引头部）
- [ ] 工作区干净：`git status` 无未提交改动（`make deploy` 会强制检查）
- [ ] 想清楚回滚方案

### 易漏点

- 模型/密钥类接口的返回必须走字段白名单，禁止 `{...model}` 展开（AIModel 实例带 `api_key`/`api_endpoint`）。
- `backend/src/__tests__/integration/setup.js` 里写死了测试库连接参数，本地用 `TEST_DB_PORT=3307 TEST_REDIS_PORT=6380` 覆盖（`make test-integration` 已带）。
- 前端 `IMAGE_HOST` 是硬编码域名，换域名部署时要改。

---

## 三、数据库迁移

### 3.1 迁移文件

knex 迁移放 `backend/migrations/`，用 `cd backend && npx knex migrate:make <名字>` 生成（时间戳前缀）。要求：

- 文件顶部注释写清**为什么改**、**影响多少行**、**能否重复执行**
- 只做一件事
- `down` 要真的能回退，或明确写"不可回退"

### 3.2 执行顺序

**加法式（新增列/表）——迁移先行：**

```
make migrate（自带备份门）→ 验证列已存在 → make deploy
```

**减法式（删列/改类型）——代码先行：**

```
make deploy（部署"不再使用该列"的代码）→ 观察一段时间 → make migrate 删列
```

### 3.3 本地演练

本地库是线上副本（`make db-pull` 可刷新）。先在本地跑 `cd backend && npx knex migrate:latest`，确认语句无误，再动生产。大表（`messages` 千万行级）加列前确认 MySQL 8.0 走 `ALGORITHM=INSTANT/INPLACE`，否则会锁表。

---

## 四、部署代码

```bash
make deploy
```

这条命令背后做了什么（`dev/deploy.sh`）：

1. 检查工作区干净，不干净直接拒绝
2. 本地 `make build` 验证构建
3. `git push origin main`
4. 打印**部署预览**：服务器当前版本 → 将部署版本 → 变更提交与文件统计；含 `backend/migrations/` 改动时给出提醒
5. **交互式二次确认**（`ARGS=-y` 可跳过，日常发布不要用）
6. **备份门**：服务器上生成一份数据库 dump（含 sha256）
7. 服务器 `git fetch` + **ff-only 合并**（服务器有本地改动或分叉时中止，不会强推）
8. `package-lock.json` 有变化时 `npm ci`
9. 服务器执行 `rebuild.sh --full`
10. 打 tag `deploy-<时间戳>` 并推送
11. 调 `https://ai.xingyuncl.com/health` 健康检查

只有 `rebuild.sh` 的健康检查会报警，没有任何自动回滚。

---

## 五、发布后验证

- [ ] `curl -sf https://ai.xingyuncl.com/health`
- [ ] 用真实账号登录，走一遍**本次改动涉及的页面**
- [ ] 动了数据模型就顺带回归没动的页面
- [ ] `make logs` 看有没有新报错

---

## 六、出问题了怎么退

**代码回滚**（退到上一个部署 tag）：

```bash
git tag -l 'deploy-*' | tail -3                       # 找上一个 tag
ssh practice 'cd /var/www/ai-platform && git checkout <上一个deploy-tag> && export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh && bash rebuild.sh --full'
# 退完记得在本地把 main 也 revert 掉，否则下次 ff-only 合并会被服务器的 detached HEAD 拦住：
#   ssh practice 'cd /var/www/ai-platform && git checkout main'  →  本地 git revert → make deploy
```

**数据库回滚**：从 `/var/backups/ai-platform/mysql/` 最近的 dump 恢复（`make rollback` 会列出）。加法式迁移通常不用回滚。

**判断先退哪个**：先回滚代码止血，再看数据库。

---

## 七、不要做的事

- 不要 `make deploy ARGS=-y` 跳过确认
- 不要在生产服务器上直接改代码（会导致下次 ff-only 合并失败；`deploy.sh` 会因工作区不干净拒绝）
- 不要 `git push --force` 到 main
- 不要在没备份的情况下执行任何 DDL
- 不要把工具配置、索引文件混进功能发布的提交里
- 不要跳过浏览器验证
- **这个仓库是公开的**（论文配套）：任何密钥、口令、真实 IP、dump 都不能进提交
