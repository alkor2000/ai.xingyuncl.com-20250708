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
5. 发布前（代码传输前）和每个镜像构建前核磁盘可用字节、内存可用量及 inode；读取失败或低于阈值即停止，不自动清理缓存。后端、前端依次构建，降低同时构建的峰值。默认最低 8 GiB 磁盘、5120 MiB 可用内存、100000 inode；可用 `DOCKER_MIN_FREE_GIB`、`DOCKER_MIN_AVAILABLE_MIB`、`DOCKER_MIN_FREE_INODES` 调整。预构建路径（`--prebuilt`）的门按解包/镜像存储/运行余量另算，见下文。8 GiB 延续原 40 GiB 服务器的构建余量门；前端 Dockerfile 允许 Node 使用 4 GiB 堆，再预留约 1 GiB 给构建器与既有服务；inode 门防止 npm 安装因文件项耗尽。这是发布前守卫，不保证构建过程永不耗尽，门槛调整需按目标主机实际容量评估。
6. 同一 Git 提交仅在后端与前端容器均使用该提交的发布镜像 ID，且 `State.Running=true`、`State.Paused=false`、`State.Restarting=false`、健康状态为 healthy，且公网健康检查通过时跳过；否则仍走预览、人工确认、资源门、构建和切换。每个镜像仓库只保留最近 3 个发布标签及其 rollback 标签，其余删除；库备份只保留最近 7 份（`ai_platform-<时间戳>.sql.gz`，切换成功后才删，失败的发布一份不删；`DOCKER_KEEP_DB_BACKUPS` 可调，至少 1，0 或非数字在动手前就拒绝），其他名字的文件不碰。
7. 切换和远端收尾后，检查公网 `/health` 和关键路由，再本地打 `deploy-docker-<时间戳>` 标签并推送。

**预构建镜像路径（星云构建 → 本机中转 → 北大只加载）**：北大服务器 7.2 GiB 内存、无 swap，现场 `vite build` 的实测峰值 3.4–3.8 GiB，门口可用内存 2026-09-26 以来从 5757 MiB 一路降到 5016 MiB，现场构建已经过不了 5120 MiB 的门。这条路径把构建搬到构建主机（默认 ssh `practice`，即星云所在机器），北大只核验、加载、切换：

1. `make build-images ARGS=--precheck`：只读前检。探测北大平台（`linux/amd64` 之类，未知即拒绝）、构建主机的 docker 可用性/平台/磁盘/内存/inode/基础镜像是否已在本地，写一份前检记录到 `~/ai-platform-images/`；不在任何服务器上写入。构建主机没有 Docker 就在这里停下——装不装由人决定，脚本不装。
2. `make build-images`：工作区干净、在 main、HEAD 已推 GitHub（与 deploy-docker 同一口径）→ 构建主机资源门（默认 ≥ 8 GiB 磁盘、≥ 4864 MiB 可用内存、≥ 100000 inode；4864 = 实测 cgroup 峰值 3789 + 1024 预留，2026-10-14 总控登记值）→ `git archive HEAD` 送到构建主机专属任务目录 `/var/tmp/ai-platform-image-build/v-<短sha>-<时间戳>/src`（只含已提交文件，不碰 `/var/www/ai-platform` 的 PM2 业务目录，不读任何 `.env`）→ 依次 `docker build` backend、frontend（标签与发布标签同形 `ai-platform-{backend,frontend}:v-<短sha>-<时间戳>`；frontend 只带一个构建参数 `CUSTOMER_DOMAIN=<北大域名>`，取自 `DOCKER_HEALTH_URL` 的主机名；默认用旧构建器 `DOCKER_BUILDKIT=0`，每步 `--memory=4608m --memory-swap=4608m --cpu-shares=256`，不让构建把构建主机的既有服务挤出内存；BuildKit 没有逐次构建的内存上限，`IMAGE_BUILD_BUILDER=buildkit` 时只靠资源门）→ `docker save | gzip` → 清单（源码提交与树、Dockerfile/依赖锁/compose/.dockerignore 摘要、构建参数、构建主机平台与 Docker 版本、基础镜像 ID 与 RepoDigests、两镜像 ID/大小/平台、tar 摘要与大小）→ scp 取回 `~/ai-platform-images/<任务>/`，本机核对摘要 → 删除构建主机上的任务目录与两个任务标签（只删这两个标签，不 prune；`--keep-remote` 保留）。镜像里没有任何运行配置或凭据：`CUSTOMER_DOMAIN` 之外的一切都由北大的 compose 在运行时注入。
3. `make deploy-docker ARGS=--prebuilt=<包目录>`：本地先核包——tar 摘要、`SOURCE_COMMIT` 必须等于本地 HEAD（错提交拒绝）、`CUSTOMER_DOMAIN_BUILD_ARG` 必须等于站点域名——再做与现场构建相同的本地检查和星云顺序检查；远端探测平台（与清单 `IMAGE_PLATFORM` 不同即拒绝，错架构不加载）；服务器检出里若有会被 Dockerfile COPY 进镜像的未跟踪文件即拒绝并列出——预构建镜像里不可能有它们，现场构建却会带上，不能让它们在切换时消失。compose 里以 `./` 挂载进容器的宿主目录不算（由挂载提供，与镜像来源无关）：北大的门户页 `frontend/public/www/` 就是这样处理的，本次把它从"靠现场构建拷进镜像"改成 `docker-compose.yml` 里只读挂载到 nginx 根下同一路径 `/usr/share/nginx/html/www`，现场构建与预构建都能提供 `/www/`；检出根目录下的 `reload-nginx-docker.sh`、`backup_*.html` 和 `docker/*.backup_b` 不在任何 COPY 范围内，不算；预览、人工确认；拿发布锁；资源门按这条路径拆分：磁盘 ≥ tar 大小 + 两镜像大小 + 2 GiB（库备份约 0.4 GB、发布目录与日志、1 GiB 底）、可用内存 ≥ 1024 MiB（迁移一次性容器与新旧容器交接约 150–300 MiB，取两倍再取整；`DOCKER_PREBUILT_MIN_AVAILABLE_MIB` 可调）、inode ≥ 100000；不再有编译门。传码（bundle，同现场路径）；传包：先写到 `/var/tmp/ai-platform-images/<任务>/images.tar.gz.part`，服务器核对摘要通过才改成正式名，不符就删掉中止；已有摘要一致的正式包则直接复用（中断后重跑幂等）。服务器：再核摘要 → `docker load` → 逐个核对加载出的镜像 ID、平台与清单一致、frontend 镜像里的 `CUSTOMER_DOMAIN` 等于服务器 `.env` 里的值，不一致就删掉刚加载的标签并中止（**校验前不切换、不迁移；校验通过只表示镜像在本地，不表示业务已上线**）→ 之后与现场路径完全相同：rollback 标签、发布目录与 override、RELEASE.txt（多了 `IMAGES_SOURCE=prebuilt`、包摘要、镜像 ID、构建主机平台，`IMAGES_LOADED=1` 在切换之前落盘）、备份库、迁移、切换、健康判定、清理；成功后删除服务器上的包目录。**这条路径里服务器永远不会 `docker compose build`**：包有问题就停，不回退到现场构建。
4. 发布锁：两种模式都先在 `/var/backups/ai-platform/releases/.lock` 原子 mkdir（`dev/docker-release-lock.sh`），锁里记 token/时间/主机；已被占用即拒绝并打印持有者，脚本不抢锁、不清锁。远端脚本退出时释放。发布中途断线留下的残留锁要由人核实（`ssh pkuailab 'cat /var/backups/ai-platform/releases/.lock/owner; docker ps'`，确认没有发布在跑）后手工 `rmdir`。
5. 回退与现场路径相同（`current/rollback.override.yml`，见上）。同一提交的双容器已运行目标镜像且健康时仍直接跳过。Git HEAD 不代表运行中的镜像，判定一律以容器实际镜像 ID 与健康为准。
6. 工具变更的上线顺序不变：含这些脚本的提交先 `make deploy ARGS=--server-first`（星云 + GitHub），再 `make build-images`，再 `make deploy-docker ARGS=--prebuilt=…`；不用 `--allow-ahead` 跳过顺序检查。构建主机的真实 Docker 能力、镜像仓库可达性与一次生产演练在写下这段时都还没有做过，以 `--precheck` 的实际输出为准。

**纯代码发布（`--code-only`，对应发布类型 A）**：常规路径会无条件跑 knex（第 4 步）、容器启动时跑 SQL 迁移脚本、切换后清理旧镜像和旧库备份（第 6 步）；星云的备份门也按 `KEEP=14` 滚动删除。只改代码的发布可以不碰这些：

```bash
make deploy ARGS="--server-first --code-only"
make build-images
make deploy-docker ARGS="--prebuilt=<包目录> --code-only"
```

1. **范围门**：差量含 `backend/migrations/`、`backend/knexfile.js`、`database/`、`tools/database-upgrade/`、`docker/`、`docker-compose.yml` 中任一路径即拒绝，改走常规发布。Docker 站点的差量基准是 `docker-release-preflight.sh sealed-parent` 读到的运行中封存父版（`current` 发布记录、镜像清单、两个运行容器必须是同一份且健康），不是服务器 Git HEAD；读不到或对不上就拒绝，这一步在拿锁和传任何东西之前。`--code-only` 只能配 `--prebuilt`。目标镜像加载后还要核它的 CMD 就是已知那一份，不符就删掉刚加载的两个标签并中止，不备份、不切换。
2. **不做的事**：不跑 `knex migrate:latest`；容器启动不跑 `run-migrations.sh`（`release.override.yml` 与 `rollback.override.yml` 给 backend 写 `command: ["su-exec", "nodejs", "node", "src/server.js"]`，只替换 CMD、镜像字节不变，切换后核 `Config.Cmd` 与日志，不符即按失败处理并打印回滚命令）；不清理旧镜像和旧库备份；星云备份门带 `BACKUP_RETENTION=skip`，只新增、不删旧备份。保留份数的配置不动，下一次常规发布照常收回。
3. **照旧保留**：交互确认、站点先后、发布锁、资源门（不因 `--code-only` 放宽）、包与镜像核验、发布前库备份、回退标签与回退文件、健康检查、星云 `rebuild.sh`（其中清 PM2 日志照旧）。北大只删本次自己上传的暂存包。星云的每日定时备份不走发布脚本，仍按 `KEEP` 滚动。
4. **记录**：`RELEASE.txt` 多出 `RELEASE_KIND=code-only`、`DB_MIGRATED=skipped-code-only`、`STARTUP_MIGRATIONS=skipped-code-only`、`RETENTION_CLEANUP=skipped-code-only`。
5. **代价**：不清理意味着这次发布净增磁盘（一份库备份和新镜像层），发布前先看 `make status-docker` 的磁盘行。

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
- 服务器磁盘 40G，旧镜像和构建缓存要靠脚本清理。库备份每份约 330M，2026-10-03 曾攒到 22 份（6.7G），把可用空间压到资源门以下、前端构建前被拦停；现在由脚本只留最近 7 份。发布前仍先看一眼 `make status-docker` 的磁盘行。

## 八、不要做的事

- 不要为了过资源门去降门槛：门槛只按目标主机实测容量评估后调整，一次门拒即停。预构建路径里不要在北大现场补构建。
- 不要用 `--allow-ahead` 跳过星云→北大的顺序检查，也不要绕开发布锁。
- 不要用 `--code-only` 发带迁移或启动改动的提交，也不要把它当成放宽任何门的手段；它只跳过迁移和清理。
- 不要 `make deploy ARGS=-y` 跳过确认
- 不要在生产服务器上直接改代码（会导致下次 ff-only 合并失败；`deploy.sh` 会因工作区不干净拒绝）
- 不要 `git push --force` 到 main
- 不要跳过 ai.xingyuncl.com 直接发 Docker 站点；两站必须在同一提交
- 不要在没备份的情况下执行任何 DDL
- 不要把工具配置、索引文件混进功能发布的提交里
- 不要跳过浏览器验证
- **这个仓库是公开的**（论文配套）：任何密钥、口令、真实 IP、dump 都不能进提交
