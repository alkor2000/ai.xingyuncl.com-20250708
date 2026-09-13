SHELL := /bin/bash
.DEFAULT_GOAL := help
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BE_DIR := $(ROOT)/backend
FE_DIR := $(ROOT)/frontend
ENV_FILE := $(BE_DIR)/.env
COMPOSE := docker compose --env-file $(ENV_FILE) -f $(ROOT)/dev/docker-compose.yml
SSH_HOST ?= practice
REMOTE_DIR ?= /var/www/ai-platform
NVM := export NVM_DIR=$$HOME/.nvm; [ -s $$NVM_DIR/nvm.sh ] && . $$NVM_DIR/nvm.sh

.PHONY: help
help: ## 显示本帮助
	@echo "AI应用与实践平台（ai.xingyuncl.com）— 本地开发/部署命令"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "首次使用: make setup  然后  make db-pull  再  make dev"

.PHONY: setup
setup: ## 首次准备：拉起 MySQL/Redis 容器、装前后端依赖
	@test -f $(ENV_FILE) || { echo "缺少 $(ENV_FILE)（从 ~/practice-sync/mirror/backend.env 复制并改为本地值，见 dev/README.md）"; exit 1; }
	$(COMPOSE) up -d
	cd $(BE_DIR) && npm ci --no-audit --no-fund
	cd $(FE_DIR) && npm ci --no-audit --no-fund
	@echo "✅ setup 完成。下一步: make db-pull（导入线上数据），再 make dev"

.PHONY: db-up
db-up: ## 启动本地 MySQL 8.0 (:3307) + Redis 7 (:6380) 容器
	$(COMPOSE) up -d
	@echo "MySQL: 127.0.0.1:3307  Redis: 127.0.0.1:6380"

.PHONY: db-down
db-down: ## 停止容器（保留数据卷）
	$(COMPOSE) down

.PHONY: db-reset
db-reset: ## 停止容器并删除数据卷（清空本地库）
	$(COMPOSE) down -v

.PHONY: db-pull
db-pull: db-up ## 从线上拉取最新数据库到本地（覆盖本地库；ARGS=--reuse-latest 复用服务器上最新 dump）
	$(ROOT)/dev/db-pull.sh $(ARGS)

.PHONY: db-shell
db-shell: ## 打开本地 MySQL 命令行
	docker exec -it practice-mysql mysql -uroot -p$${DEV_MYSQL_ROOT_PASSWORD:-devroot} ai_platform

.PHONY: backend
backend: db-up ## 只运行后端 (:4000)
	cd $(BE_DIR) && node src/server.js

.PHONY: frontend
frontend: ## 只运行前端 vite dev server (:3000)
	cd $(FE_DIR) && npm run dev -- --host 127.0.0.1 --port 3000

.PHONY: dev
dev: db-up ## 同时运行后端 + 前端（Ctrl-C 一起停止）
	$(ROOT)/dev/dev.sh

.PHONY: build
build: ## 本地构建验证（发布门）：后端加载完整模块图，前端 vite build；单元测试走 make test
	@echo "==> backend: 加载 src/app.js 模块图（语法/引用错误在此暴露）"; cd $(BE_DIR) && NODE_ENV=test timeout 90 node -e "require('./src/app'); console.log('app ok'); process.exit(0)"
	@echo "==> frontend: vite build"; cd $(FE_DIR) && npm run build >/dev/null && echo "✅ 构建通过: frontend/dist ($$(du -sh $(FE_DIR)/dist | cut -f1))"

.PHONY: test
test: ## 后端单元测试 (jest) + 前端测试 (vitest run)
	cd $(BE_DIR) && npx jest --verbose
	cd $(FE_DIR) && npx vitest run

.PHONY: test-integration
test-integration: db-up ## 后端集成测试（连本地 ai_platform_test，需先 make db-pull）
	cd $(BE_DIR) && TEST_DB_PORT=3307 TEST_REDIS_PORT=6380 npx jest --config jest.integration.config.js --verbose

.PHONY: deploy
deploy: ## 推送到 GitHub 并部署到生产服务器（备份门 → ff-only pull → rebuild.sh --full → 打 tag；会二次确认）
	$(ROOT)/dev/deploy.sh $(ARGS)

.PHONY: migrate-status
migrate-status: ## 查看生产库 knex 迁移状态
	ssh -n $(SSH_HOST) '$(NVM); cd $(REMOTE_DIR)/backend && npx knex migrate:status'

.PHONY: migrate
migrate: ## 在生产库执行待执行的 knex 迁移（先备份门，再 migrate:latest；见 dev/RELEASE.md 第三节）
	@read -rp "确认在生产库执行 knex migrate:latest? [y/N] " a; [ "$$a" = y ] || exit 1
	ssh $(SSH_HOST) 'APP_DIR=$(REMOTE_DIR) bash -s' < $(BE_DIR)/scripts/db_backup.sh
	ssh -n $(SSH_HOST) '$(NVM); cd $(REMOTE_DIR)/backend && npx knex migrate:latest && npx knex migrate:status'

.PHONY: rollback
rollback: ## 列出最近的部署 tag 与服务器备份，回滚步骤见 dev/RELEASE.md 第六节
	@git tag -l 'deploy-*' | tail -5
	@ssh -n $(SSH_HOST) 'ls -t /var/backups/ai-platform/mysql/*.sql.gz 2>/dev/null | head -5'

.PHONY: logs
logs: ## 看生产 PM2 最近日志
	ssh -n $(SSH_HOST) '$(NVM); pm2 logs --lines 60 --nostream'

.PHONY: status
status: ## 查看本地/生产 git 与服务状态
	@echo "=== 本地 git ==="; git -C $(ROOT) status -sb | head -1; git -C $(ROOT) log --oneline -1
	@echo "=== 生产 git ==="; ssh -n $(SSH_HOST) 'cd $(REMOTE_DIR) && git log --oneline -1 && git status -sb | head -1'
	@echo "=== 生产服务 ==="; ssh -n $(SSH_HOST) '$(NVM); pm2 list | grep -E "ai-platform|name"; curl -sf http://127.0.0.1:4000/health >/dev/null && echo "health: ok" || echo "health: FAIL"'
	@echo "=== 容器 ==="; docker ps --filter name=practice --format '{{.Names}} {{.Status}}'
