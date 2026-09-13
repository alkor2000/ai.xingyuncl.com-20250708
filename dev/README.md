# 本地开发指南（WSL / Linux）

在 WSL Ubuntu 里开发本项目，代码走 GitHub，部署回生产服务器（ssh 别名 `practice`）。与 edu 项目（`~/pkuailab-platform`）同一套做法。

## 架构回顾

```
浏览器 → nginx(ai.xingyuncl.com) → 前端静态包 frontend/dist（nginx 直出）
                                  → /api、/health、/pages/*、/socket.io → 127.0.0.1:4000（PM2 ai-platform-auth = backend/src/server.js）
                                  → /storage/、/uploads/ → storage/uploads（磁盘直出）
        backend(Express) → MySQL 8.0 `ai_platform` + Redis 7（同机）
```

- `backend/` — Node/Express 后端，入口 **`src/server.js`**（`package.json` 的 `start/dev` 指向 `src/app.js`，那只导出 app 不监听，别用）。knex 迁移在 `backend/migrations/`。
- `frontend/` — React 18 + Vite 5 + Antd 5；`npm run build` 产出 `frontend/dist`，线上由 nginx 直接服务。
- PM2 里的 `ai-platform-frontend`（`serve dist -l 3000`）nginx 并不用，是历史遗留。
- `rebuild.sh` — 服务器自带的发布脚本：环境检查 → 前端构建 → PM2 全部重启 → 健康检查。**不装依赖、不跑迁移。**

## 环境要求

WSL 里需要：Node 22、Docker、rsync，`ssh practice` 与 `ssh lab` 免密可达（lab 用作大文件中转，practice→本机直连只有约 100KB/s）。

## 首次准备

```bash
# 1. 本地配置（machine-local，不进 git）。生产 .env 的镜像在 ~/practice-sync/mirror/backend.env，
#    本地副本改这些值：NODE_ENV=development、DB_HOST=127.0.0.1、DB_PORT=3307、REDIS_HOST=127.0.0.1、REDIS_PORT=6380、
#    UPLOAD_DIR/LOG_DIR 指向本仓库、APP_DOMAIN=localhost:4000、IDENTITY_ENABLED=false 且清空 IDENTITY_CLIENT_SECRET /
#    IDENTITY_CREDENTIALS_FILE / IDENTITY_DEPLOYMENT_INSTANCE_KEY（本地不接 Identity），末尾加 DEV_MYSQL_ROOT_PASSWORD=devroot。
make setup      # 拉起 MySQL 8.0(:3307)+Redis 7(:6380) 容器、npm ci 前后端
make db-pull    # 从线上导入最新数据库（约 30 秒，覆盖本地库；同时按结构重建 ai_platform_test）
# 上传文件（约 600MB，经 lab 中转）：
#   ssh -A lab "rsync -a root@<practice>:/var/www/ai-platform/storage/uploads/ /root/practice-relay/uploads/"
#   rsync -a lab:/root/practice-relay/uploads/ storage/uploads/
```

## 日常开发

```bash
make dev        # 后端 :4000（nodemon）+ 前端 :3000，浏览器开 http://localhost:3000
make backend    # 只起后端
make frontend   # 只起前端
make db-pull    # 想要最新线上数据时随时刷新
make test       # jest 单元测试 + vitest
make test-integration   # jest 集成测试（连本地 ai_platform_test）
make build      # 本地完整构建验证（发布前 make deploy 会自动跑）
make status     # 看本地/线上 git 与服务状态
```

## 部署到生产

**完整流程见 [RELEASE.md](RELEASE.md)，发布前请按那份清单走。** 下面只是命令速查。

```bash
git add -A && git commit -m "..."   # 先提交
make deploy                         # 构建验证→推 GitHub→预览确认→备份门→服务器 ff-only pull→rebuild.sh --full→打 tag→健康检查
make migrate-status                 # 看生产库 knex 迁移状态
make migrate                        # 有迁移时：备份门后在生产执行 knex migrate:latest（顺序见 RELEASE.md）
```

`make deploy` 前提：WSL 的 GitHub 专用公钥 `~/.ssh/id_ed25519_github.pub`（ssh 别名 `github-practice`，origin 已指向它）在本仓库 Settings → Deploy keys 里带 *Allow write access*。一把公钥在 GitHub 只能挂一处，所以不能复用挂在 pkuailab-platform 上的 `id_ed25519`。

## 目录里不该动的东西

- `backend/.env`、`~/practice-sync/mirror/*`、`~/db-dumps/*`：含密钥/数据，不进 git、不粘贴到任何地方。
- `storage/uploads/`、`storage/temp/`、`logs/`：运行产物，已 gitignore。
- 服务器上的 `/root/p2b-xingyun-enrollment-*/`、项目里的 `.identity-backups/`：Identity 私有凭据与备份，永远不同步到本地。
