# AI Practice Platform | AI应用与实践平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Lines of Code](https://img.shields.io/badge/Lines%20of%20Code-156%2C454-blue)](https://github.com/alkor2000/ai.xingyuncl.com-20250708)
[![Paper](https://img.shields.io/badge/Paper-FSE%202026-green)](https://github.com/alkor2000/ai.xingyuncl.com-20250708)

**English** | [中文](#中文文档)

---

## Overview

This repository contains the complete source code for the **AI Practice Platform**, accompanying the paper submitted to **FSE 2026 Industry Track**:

> **AOCI: An AI-Native Architecture Description Language for Bridging the Repository-Level Cognitive Gap**

### Key Metrics

| Metric | Value |
|--------|-------|
| Total Lines of Code | 156,454 |
| Git Commits | 454 |
| Active Users | 4,400+ |
| Development Period | 8 months (spare time) |

---

## Live Demo

Experience the system without installation:

| | |
|---|---|
| **URL** | https://ai.xingyuncl.com |
| **Username** | fsetest |
| **Password** | fse2026 |
| **Role** | Group Admin (limited permissions) |

---

## AOCI Index

The AOCI index files referenced in the paper are available at:

- [docs/aoci/index-en-US-20260123.txt](docs/aoci/index-en-US-20260123.txt)
- [docs/aoci/index-zh-CN-20260123.txt](docs/aoci/index-zh-CN-20260123.txt)

For methodology details, please refer to the paper.

---

## Features & Modules

A production-grade enterprise AI platform with **19 subsystem modules**:

| Category | Modules |
|----------|---------|
| **AI Core** | Multi-model Chat (Claude/GPT/DeepSeek), Streaming SSE, Token Calculation |
| **Generation** | Image (Midjourney/Volcano/Wanxiang), Video (Kling/Sora2) |
| **Knowledge** | Knowledge Cube (RAG), Wiki System, System Prompts |
| **Agent** | Visual Workflow Editor, Node Orchestration, Conditional Branching |
| **Teaching** | 3-Level Permissions, Course Management, Lesson Plans |
| **Tools** | HTML Editor, Mind Map, AI Calendar, OCR, Cloud Storage |
| **Enterprise** | Credits Billing, Multi-tenant, RBAC (Casbin), SSO |
| **Admin** | 25+ Settings Components, Analytics Dashboard, Usage Logs |

> All modules serve as ground truth for validating AOCI effectiveness.

---

## System Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite 5 + Ant Design 5 + Monaco Editor + ReactFlow |
| Backend | Node.js 20 LTS + Express.js + PM2 |
| Database | MySQL 8.0 + Redis 7.0 |
| Authentication | JWT + bcrypt + Casbin RBAC |
| Security | AES-256 Encryption |
| Real-time | Server-Sent Events (SSE) |
| Storage | Local + Aliyun OSS |
| Deployment | Nginx + Let's Encrypt SSL |

### Database Schema

- **90 objects** (83 tables + 4 backup tables + 3 views)

---

## Quick Start

> **📋 Note for Reviewers**: For quick evaluation, we recommend using the [Live Demo](#live-demo) above. The detailed installation guide below is intended for production deployment on bare-metal servers.

### Recommended Environment

| Item | Recommendation |
|------|----------------|
| Operating System | Ubuntu 24.04 LTS (recommended) / Debian 12 / CentOS Stream 9 |
| Server Specs | Minimum: 2 vCPU + 4GB RAM, Recommended: 2 vCPU + 8GB RAM |
| Cloud Provider | AWS, Google Cloud, Azure, Alibaba Cloud, etc. |

> ⚠️ **Windows Server is NOT recommended** due to compatibility issues.

---

### Step 1: Install Required Software (Ubuntu 24.04)
```bash
# 1.1 Update system
apt update && apt upgrade -y
apt install -y curl wget gnupg2 software-properties-common

# 1.2 Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v    # Should show v20.x.x
npm -v     # Should show 10.x.x

# 1.3 Install MySQL 8.0
apt install -y mysql-server
systemctl start mysql
systemctl enable mysql

# 1.4 Install Redis
apt install -y redis-server
systemctl start redis-server
systemctl enable redis-server
redis-cli ping    # Should show PONG

# 1.5 Install Nginx
apt install -y nginx
systemctl start nginx
systemctl enable nginx

# 1.6 Install PM2
npm install -g pm2
```

---

### Step 2: Clone Repository
```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform
```

---

### Step 3: Configure Backend Environment

Create the backend configuration file:
```bash
cat > /var/www/ai-platform/backend/.env << 'EOF'
NODE_ENV=production
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_USER=ai_user
DB_PASSWORD=YourSecurePassword123!
DB_NAME=ai_platform
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ACCESS_SECRET=YOUR_GENERATED_64_BYTE_SECRET_1
JWT_REFRESH_SECRET=YOUR_GENERATED_64_BYTE_SECRET_2
JWT_ACCESS_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=*
UPLOAD_DIR=storage/uploads
MAX_FILE_SIZE=52428800
ENABLE_CASBIN=false
USE_CASBIN_RESULT=false
EOF
```

**Generate JWT secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

---

### Step 4: Setup Database
```bash
# Create database and user
mysql -u root << 'EOF'
CREATE DATABASE IF NOT EXISTS ai_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ai_user'@'localhost' IDENTIFIED BY 'YourSecurePassword123!';
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;
EOF

# Enable function creation (required for triggers)
mysql -u root -e "SET GLOBAL log_bin_trust_function_creators = 1;"

# Import database structure (must use root due to triggers/functions)
mysql -u root ai_platform < /var/www/ai-platform/docker/mysql-init/01-complete-database-structure.sql

# Import initial data
mysql -u root ai_platform < /var/www/ai-platform/docker/mysql-init/02-initial-data.sql

# Verify table count (should be ~90)
mysql -u root ai_platform -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'ai_platform';"
```

---

### Step 5: Install Dependencies and Build
```bash
# Backend
cd /var/www/ai-platform/backend
npm install

# Frontend
cd /var/www/ai-platform/frontend
npm install
npm run build
```

---

### Step 6: Configure Nginx (HTTP only, for SSL certificate)
```bash
cat > /etc/nginx/sites-available/ai-platform << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/ai-platform/certbot;
    }
    
    location / {
        root /var/www/ai-platform/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:4000/health;
    }
    
    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
    }
}
EOF

mkdir -p /var/www/ai-platform/certbot
ln -sf /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

---

### Step 7: Obtain SSL Certificate
```bash
apt install -y certbot
certbot certonly --webroot -w /var/www/ai-platform/certbot -d your-domain.com --non-interactive --agree-tos --email your@email.com
```

---

### Step 8: Configure Nginx (HTTPS)
```bash
cat > /etc/nginx/sites-available/ai-platform << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/ai-platform/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    client_max_body_size 50M;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    location / {
        root /var/www/ai-platform/frontend/dist;
        try_files $uri $uri/ /index.html;
        
        location = /index.html {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }
        
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_set_header X-Accel-Buffering 'no';
        chunked_transfer_encoding off;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
    }

    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location ~ ^/pages/(\d+)/(.+)$ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }
}
EOF

nginx -t && systemctl reload nginx
```

---

### Step 9: Start Services
```bash
cd /var/www/ai-platform
pm2 start ecosystem.config.js --only ai-platform-auth
pm2 startup
pm2 save
```

---

### Step 10: Verify Installation
```bash
curl https://your-domain.com/health
# Should return: {"success":true,"message":"Service is healthy",...}
```

**Default admin account:**

| Username | Password |
|----------|----------|
| admin | Admin@123456 |

**⚠️ IMPORTANT: Change admin password immediately after first login!**

---

## 🐳 Docker Deployment (Production)

For production environments, we recommend Docker deployment.

### Prerequisites

| Requirement | Details |
|-------------|---------|
| OS | Ubuntu 24.04 LTS (recommended) |
| Server | 2 vCPU + 8GB RAM minimum |
| Domain | DNS A record pointing to server IP |

### Complete Deployment Steps
```bash
# 1. Update system
apt-get update && apt-get upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 3. Install Docker Compose
apt-get install -y docker-compose

# 4. Install Git
apt-get install -y git

# 5. Install Certbot (SSL)
apt-get install -y certbot

# 6. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 7. Verify installations
docker --version
docker-compose --version
git --version
certbot --version
node --version

# 8. Clone repository
mkdir -p /var/www
cd /var/www
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform

# 9. Initialize (⚠️ SAVE the database password output!)
./docker/scripts/init-customer.sh your-domain.com

# 10. Start all containers (first build takes 10-20 minutes)
docker-compose up -d

# 11. Wait for health checks and verify
sleep 30
docker-compose ps
curl http://localhost:4000/health
curl -I https://your-domain.com

# 12. Configure Knex migrations (replace YOUR_DB_PASSWORD from step 9)
docker exec -i ai-platform-mysql mysql -uai_user -p'YOUR_DB_PASSWORD' ai_platform << 'EOF'
CREATE TABLE IF NOT EXISTS knex_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255),
  batch INT,
  migration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knex_migrations_lock (
  `index` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  is_locked INT,
  PRIMARY KEY (`index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO knex_migrations_lock (`index`, is_locked) VALUES (1, 0);
INSERT INTO knex_migrations (name, batch, migration_time) VALUES ('20260127032549_000_baseline.js', 1, NOW());
EOF

# 13. Verify Knex status
docker exec ai-platform-backend npm run migrate:status

# 14. Verify SSL auto-renewal
certbot renew --dry-run
```

### Post-Deployment

| Item | Value |
|------|-------|
| URL | https://your-domain.com |
| Admin Username | admin |
| Admin Password | Admin@123456 |

**⚠️ Change admin password immediately after first login!**

### Production Deployments

| Domain | Users |
|--------|-------|
| www.nebulink.com.cn | 1,474 |
| ai.pkuailab.com | 909 |

---

## Troubleshooting

### npm install is slow or fails
```bash
npm config set registry https://registry.npmmirror.com
```

### MySQL connection failed
```bash
sudo systemctl status mysql
mysql -u ai_user -p -e "SHOW DATABASES;"
```

### Database import fails with SUPER privilege error
```bash
mysql -u root -e "SET GLOBAL log_bin_trust_function_creators = 1;"
mysql -u root ai_platform < docker/mysql-init/01-complete-database-structure.sql
```

### Port already in use
```bash
sudo lsof -i :4000
sudo kill -9 <PID>
```

### PM2 service errors
```bash
pm2 logs
pm2 logs --lines 100
pm2 restart all
```

### Frontend build fails (out of memory)
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

---

## Research Reproducibility

| Claim | Verification Method |
|-------|---------------------|
| 156,454 lines of code | `find . -name "*.js" -o -name "*.jsx" \| xargs wc -l` |
| 454 Git commits | `git rev-list --count HEAD` |
| ~600 line AOCI index | `wc -l docs/aoci/index-*.txt` |
| 90 database objects | Check AOCI index database section |

---

## Citation
```bibtex
@inproceedings{liu2026aoci,
  title={AOCI: An AI-Native Architecture Description Language for Bridging the Repository-Level Cognitive Gap},
  author={Liu, Jinshi and Zuo, Hanying and Zhang, Anran and Xie, Xinzhou},
  booktitle={Companion Proceedings of the 34th ACM Symposium on the Foundations of Software Engineering (FSE '26)},
  year={2026}
}
```

---

## License

MIT License - see [LICENSE](LICENSE) file.

---

<a name="中文文档"></a>

# 中文文档

## 概述

本仓库包含**AI应用与实践平台**的完整源代码，配套提交至**FSE 2026 Industry Track**的论文：

> **AOCI：一种弥合仓库级认知鸿沟的AI原生架构描述语言**

### 核心数据

| 指标 | 数值 |
|------|------|
| 代码总行数 | 156,454行 |
| Git提交次数 | 454次 |
| 活跃用户 | 4,400+ |
| 开发周期 | 8个月（业余时间） |

---

## 在线演示

无需安装，直接体验：

| | |
|---|---|
| **网址** | https://ai.xingyuncl.com |
| **用户名** | fsetest |
| **密码** | fse2026 |
| **角色** | 组管理员（有限权限） |

---

## AOCI索引

论文中引用的AOCI索引文件：

- [docs/aoci/index-en-US-20260123.txt](docs/aoci/index-en-US-20260123.txt)
- [docs/aoci/index-zh-CN-20260123.txt](docs/aoci/index-zh-CN-20260123.txt)

方法论详情请参阅论文。

---

## 功能与模块

一个生产级企业AI平台，包含**19个子系统模块**：

| 类别 | 模块 |
|------|------|
| **AI核心** | 多模型对话（Claude/GPT/DeepSeek）、流式SSE输出、Token计算 |
| **内容生成** | 图像生成（Midjourney/火山/万相）、视频生成（可灵/Sora2） |
| **知识管理** | 万智魔方（RAG）、知识库Wiki、系统提示词 |
| **智能体** | 可视化工作流编辑器、节点编排、条件分支 |
| **智能教学** | 三级权限体系、课程管理、教案系统 |
| **效率工具** | HTML编辑器、思维导图、智能日历、OCR、云盘 |
| **企业功能** | 积分计费、多租户、RBAC权限（Casbin）、SSO单点登录 |
| **管理后台** | 25+设置组件、数据分析看板、使用记录 |

---

## 系统架构

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite 5 + Ant Design 5 + Monaco Editor + ReactFlow |
| 后端 | Node.js 20 LTS + Express.js + PM2 |
| 数据库 | MySQL 8.0 + Redis 7.0 |
| 认证 | JWT + bcrypt + Casbin RBAC |
| 安全 | AES-256加密 |
| 实时通信 | Server-Sent Events (SSE) |
| 存储 | 本地存储 + 阿里云OSS |
| 部署 | Nginx + Let's Encrypt SSL |

### 数据库架构

- **90个对象**（83张表 + 4张备份表 + 3个视图）

---

## 快速开始

> **📋 评审说明**：如需快速评估，建议使用上方的[在线演示](#在线演示)。以下详细安装指南适用于生产环境裸机部署。

### 推荐环境

| 项目 | 推荐配置 |
|-----|---------|
| 操作系统 | Ubuntu 24.04 LTS（推荐）/ Debian 12 / CentOS Stream 9 |
| 服务器配置 | 最低2核4G，推荐2核8G |
| 云服务商 | 阿里云、腾讯云、华为云、AWS等均可 |

> ⚠️ **不推荐Windows服务器**，会有很多兼容性问题。

---

### 第一步：安装必需软件（Ubuntu 24.04）
```bash
# 1.1 更新系统
apt update && apt upgrade -y
apt install -y curl wget gnupg2 software-properties-common

# 1.2 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

# 1.3 安装 MySQL 8.0
apt install -y mysql-server
systemctl start mysql
systemctl enable mysql

# 1.4 安装 Redis
apt install -y redis-server
systemctl start redis-server
systemctl enable redis-server
redis-cli ping    # 应显示 PONG

# 1.5 安装 Nginx
apt install -y nginx
systemctl start nginx
systemctl enable nginx

# 1.6 安装 PM2
npm install -g pm2
```

---

### 第二步：克隆代码
```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform
```

---

### 第三步：配置后端环境

创建后端配置文件：
```bash
cat > /var/www/ai-platform/backend/.env << 'EOF'
NODE_ENV=production
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_USER=ai_user
DB_PASSWORD=你的安全密码
DB_NAME=ai_platform
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ACCESS_SECRET=用命令生成的64字节密钥1
JWT_REFRESH_SECRET=用命令生成的64字节密钥2
JWT_ACCESS_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=*
UPLOAD_DIR=storage/uploads
MAX_FILE_SIZE=52428800
ENABLE_CASBIN=false
USE_CASBIN_RESULT=false
EOF
```

**生成JWT密钥：**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

---

### 第四步：配置数据库
```bash
# 创建数据库和用户
mysql -u root << 'EOF'
CREATE DATABASE IF NOT EXISTS ai_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ai_user'@'localhost' IDENTIFIED BY '你的安全密码';
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;
EOF

# 设置允许创建函数（解决SUPER权限问题）
mysql -u root -e "SET GLOBAL log_bin_trust_function_creators = 1;"

# 用root用户导入表结构（因为SQL包含触发器/函数）
mysql -u root ai_platform < /var/www/ai-platform/docker/mysql-init/01-complete-database-structure.sql

# 导入初始数据
mysql -u root ai_platform < /var/www/ai-platform/docker/mysql-init/02-initial-data.sql

# 验证表数量（应该约90张）
mysql -u root ai_platform -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'ai_platform';"
```

---

### 第五步：安装依赖并构建
```bash
# 后端
cd /var/www/ai-platform/backend
npm install

# 前端
cd /var/www/ai-platform/frontend
npm install
npm run build
```

---

### 第六步：配置Nginx（HTTP，用于SSL证书申请）
```bash
cat > /etc/nginx/sites-available/ai-platform << 'EOF'
server {
    listen 80;
    server_name 你的域名.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/ai-platform/certbot;
    }
    
    location / {
        root /var/www/ai-platform/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:4000/health;
    }
    
    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
    }
}
EOF

mkdir -p /var/www/ai-platform/certbot
ln -sf /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

---

### 第七步：申请SSL证书
```bash
apt install -y certbot
certbot certonly --webroot -w /var/www/ai-platform/certbot -d 你的域名.com --non-interactive --agree-tos --email your@email.com
```

---

### 第八步：配置Nginx（HTTPS完整版）
```bash
cat > /etc/nginx/sites-available/ai-platform << 'EOF'
server {
    listen 80;
    server_name 你的域名.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/ai-platform/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name 你的域名.com;

    client_max_body_size 50M;

    ssl_certificate /etc/letsencrypt/live/你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    location / {
        root /var/www/ai-platform/frontend/dist;
        try_files $uri $uri/ /index.html;
        
        location = /index.html {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }
        
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_set_header X-Accel-Buffering 'no';
        chunked_transfer_encoding off;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
    }

    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location ~ ^/pages/(\d+)/(.+)$ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }
}
EOF

nginx -t && systemctl reload nginx
```

---

### 第九步：启动服务
```bash
cd /var/www/ai-platform
pm2 start ecosystem.config.js --only ai-platform-auth
pm2 startup
pm2 save
```

---

### 第十步：验证部署
```bash
curl https://你的域名.com/health
# 应返回: {"success":true,"message":"Service is healthy",...}
```

**默认管理员账号：**

| 用户名 | 密码 |
|--------|------|
| admin | Admin@123456 |

**⚠️ 首次登录后请立即修改管理员密码！**

---

## 🐳 Docker部署（生产环境）

生产环境推荐使用Docker部署。

### 前置条件

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 24.04 LTS（推荐） |
| 服务器配置 | 最低2核8G |
| 域名 | 已将DNS A记录解析到服务器IP |

### 完整部署步骤
```bash
# 1. 更新系统
apt-get update && apt-get upgrade -y

# 2. 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 3. 安装 Docker Compose
apt-get install -y docker-compose

# 4. 安装 Git
apt-get install -y git

# 5. 安装 Certbot（SSL证书）
apt-get install -y certbot

# 6. 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 7. 验证安装
docker --version
docker-compose --version
git --version
certbot --version
node --version

# 8. 创建目录并克隆代码
mkdir -p /var/www
cd /var/www
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform

# 9. 运行初始化脚本（⚠️ 务必保存输出的数据库密码！）
./docker/scripts/init-customer.sh 你的域名.com

# 10. 启动所有容器（首次构建约10-20分钟）
docker-compose up -d

# 11. 等待健康检查完成并验证
sleep 30
docker-compose ps
curl http://localhost:4000/health
curl -I https://你的域名.com

# 12. 配置 Knex 迁移（将 YOUR_DB_PASSWORD 替换为第9步输出的数据库密码）
docker exec -i ai-platform-mysql mysql -uai_user -p'YOUR_DB_PASSWORD' ai_platform << 'EOF'
CREATE TABLE IF NOT EXISTS knex_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255),
  batch INT,
  migration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS knex_migrations_lock (
  `index` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  is_locked INT,
  PRIMARY KEY (`index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO knex_migrations_lock (`index`, is_locked) VALUES (1, 0);
INSERT INTO knex_migrations (name, batch, migration_time) VALUES ('20260127032549_000_baseline.js', 1, NOW());
EOF

# 13. 验证 Knex 状态
docker exec ai-platform-backend npm run migrate:status

# 14. 验证 SSL 自动续期
certbot renew --dry-run
```

### 部署完成后

| 项目 | 值 |
|------|------|
| 访问地址 | https://你的域名.com |
| 管理员用户名 | admin |
| 管理员密码 | Admin@123456 |

**⚠️ 首次登录后请立即修改管理员密码！**

### 已使用Docker部署的生产环境

| 域名 | 用户数 |
|------|--------|
| www.nebulink.com.cn | 1,474 |
| ai.pkuailab.com | 909 |

---

## 常见问题

### npm install 很慢或失败
```bash
npm config set registry https://registry.npmmirror.com
```

### MySQL连接失败
```bash
sudo systemctl status mysql
mysql -u ai_user -p -e "SHOW DATABASES;"
```

### 数据库导入报SUPER权限错误
```bash
mysql -u root -e "SET GLOBAL log_bin_trust_function_creators = 1;"
mysql -u root ai_platform < docker/mysql-init/01-complete-database-structure.sql
```

### 端口被占用
```bash
sudo lsof -i :4000
sudo kill -9 <PID>
```

### PM2服务异常
```bash
pm2 logs
pm2 logs --lines 100
pm2 restart all
```

### 前端构建失败（内存不足）
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

---

## 引用
```bibtex
@inproceedings{liu2026aoci,
  title={AOCI: An AI-Native Architecture Description Language for Bridging the Repository-Level Cognitive Gap},
  author={Liu, Jinshi and Zuo, Hanying and Zhang, Anran and Xie, Xinzhou},
  booktitle={Companion Proceedings of the 34th ACM Symposium on the Foundations of Software Engineering (FSE '26)},
  year={2026}
}
```

---

## 许可证

MIT许可证 - 详见[LICENSE](LICENSE)文件。
