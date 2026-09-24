# 生产发布流程

两个生产站点，同一份 `main`，**发布路径固定为 WSL → ai.xingyuncl.com → ai.pkuailab.com**：

| 站点 | 部署方式 | SSH 别名 | 代码目录 | 发布命令 |
|---|---|---|---|---|
| `https://ai.xingyuncl.com` | PM2 直跑（`ai-platform-auth` :4000）+ nginx 直出 dist | `practice` | `/var/www/ai-platform` | `make deploy` → `make migrate` |
| `https://ai.pkuailab.com` | docker compose（mysql / redis / backend / frontend 四个容器） | `pkuailab` | `/var/www/ai-platform` | `make deploy-docker`（含迁移） |

第一至六节讲 ai.xingyuncl.com，第七节讲 Docker 站点。本文是发布的唯一依据。不要绕过它直接 ssh 手改生产。

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

本次约定“首站 → GitHub → Docker”时，使用 `make deploy ARGS=--server-first`：本地构建并检查上游已合入，完成预览确认与数据库备份后，通过 git bundle 向首站传递已提交代码并 ff-only 合并；首站构建与健康检查通过后才推 GitHub。任一步失败停止，不继续 Docker。仍保留交互确认与版本复核，不直接改服务器源码。

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

## 七、Docker 站点（ai.pkuailab.com）

ai.xingyuncl.com 发布并验证后，再发 Docker 站点：

```bash
make deploy-docker
```

`dev/deploy-docker.sh` 做的事：

1. 本地检查：工作区干净、在 main、HEAD 已推 GitHub；**核对 ai.xingyuncl.com 已发布到同一提交**，否则拒绝（`ARGS=--allow-ahead` 可跳过，不推荐）。
2. 代码传输不走 GitHub（服务器直连 GitHub 常被掐断）：`git bundle` 打包服务器缺的提交，scp 过去，服务器 `git merge --ff-only`。服务器有未提交的跟踪文件改动时中止；未跟踪文件（门户页 `frontend/public/www/`、certbot 钩子 `reload-nginx-docker.sh`）不受影响。
3. 服务器资源复核后依次执行 `docker compose build backend` 和 `docker compose build frontend`，镜像打标签 `ai-platform-{backend,frontend}:v-<短sha>-<时间戳>`，当前运行的镜像（按镜像 ID，不怕旧标签已被清理）打 `rollback-<时间戳>`；写 `/var/backups/ai-platform/releases/ai-platform-v-…/`（`release.override.yml` 固定本次镜像标签、`rollback.override.yml` 指向发布前的镜像、`RELEASE.txt`、`build.log`），`releases/current` 软链指向它。旧镜像按标签末尾的时间戳只保留最近 3 个，正在运行的镜像永远不删。
4. 备份数据库（mysql 容器内 `mysqldump --single-transaction`，落 `/var/backups/ai-platform/mysql/`），**用新镜像先跑 `knex migrate:latest`**（`docker compose run --rm --no-deps backend …`，加法式迁移先行），再 `up -d backend frontend`，等双容器均运行目标镜像且 healthy（3 分钟），打印启动脚本的 SQL 迁移统计（应全是"跳过"）。
5. 发布前（代码传输前）和每个镜像构建前核磁盘可用字节、内存可用量及 inode；读取失败或低于阈值即停止，不自动清理缓存。后端、前端依次构建，降低同时构建的峰值。默认最低 8 GiB 磁盘、5120 MiB 可用内存、100000 inode；可用 `DOCKER_MIN_FREE_GIB`、`DOCKER_MIN_AVAILABLE_MIB`、`DOCKER_MIN_FREE_INODES` 调整。8 GiB 延续原 40 GiB 服务器的构建余量门；前端 Dockerfile 允许 Node 使用 4 GiB 堆，再预留约 1 GiB 给构建器与既有服务；inode 门防止 npm 安装因文件项耗尽。这是发布前守卫，不保证构建过程永不耗尽，门槛调整需按目标主机实际容量评估。
6. 同一 Git 提交仅在后端与前端容器均使用该提交的发布镜像 ID，且 `State.Running=true`、`State.Paused=false`、`State.Restarting=false`、健康状态为 healthy，且公网健康检查通过时跳过；否则仍走预览、人工确认、资源门、构建和切换。每个镜像仓库只保留最近 3 个发布标签及其 rollback 标签，其余删除。
7. 切换和远端收尾后，检查公网 `/health` 和关键路由，再本地打 `deploy-docker-<时间戳>` 标签并推送。

其他命令：`make status-docker`（git/容器/健康/磁盘/最近发布）、`make migrate-status-docker`、`make migrate-docker`（单独跑迁移，先备份）、`make logs-docker`、`make rollback-docker`。

**回滚**：`make rollback-docker` 列出最近发布目录，然后在服务器上用当前发布目录里的 `rollback.override.yml` 切回发布前的镜像（`rollback-<时间戳>` 标签）：

```bash
ssh pkuailab 'cd /var/www/ai-platform && docker compose -f docker-compose.yml -f /var/backups/ai-platform/releases/current/rollback.override.yml up -d backend frontend'
```

数据库回滚从 `/var/backups/ai-platform/mysql/` 最近的 dump 恢复（加法式迁移通常不用）。

**Docker 站点的已知差异**：
- 容器启动脚本 `docker/scripts/run-migrations.sh` 只跑 `database/migrations/*.sql`（旧机制），knex 迁移由 `deploy-docker` 显式执行；两套记录表分别是 `schema_migrations` 与 `knex_migrations`。
- 镜像里的 mysql 客户端是 MariaDB 的，需要 `--skip-ssl` 与 `mariadb-connector-c`（已在 Dockerfile/脚本里），否则启动脚本连不上 MySQL 8。
- `.env` 在服务器项目根目录（compose 读），不是 `backend/.env`；换口令等要改它并重建容器才生效。
- 服务器磁盘 40G，旧镜像和构建缓存要靠脚本清理。

## 八、不要做的事

- 不要 `make deploy ARGS=-y` 跳过确认
- 不要在生产服务器上直接改代码（会导致下次 ff-only 合并失败；`deploy.sh` 会因工作区不干净拒绝）
- 不要 `git push --force` 到 main
- 不要跳过 ai.xingyuncl.com 直接发 Docker 站点；两站必须在同一提交
- 不要在没备份的情况下执行任何 DDL
- 不要把工具配置、索引文件混进功能发布的提交里
- 不要跳过浏览器验证
- **这个仓库是公开的**（论文配套）：任何密钥、口令、真实 IP、dump 都不能进提交
