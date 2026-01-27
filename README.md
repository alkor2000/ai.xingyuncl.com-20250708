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
| Backend | Node.js 24 + Express.js + PM2 |
| Database | MySQL 8.0 + Redis 6.0 |
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
| Operating System | Ubuntu 22.04 LTS (recommended) / Debian 12 / CentOS Stream 9 |
| Server Specs | Minimum: 2 vCPU + 4GB RAM, Recommended: 2 vCPU + 8GB RAM |
| Cloud Provider | AWS, Google Cloud, Azure, Alibaba Cloud, etc. |

> ⚠️ **Windows Server is NOT recommended** due to compatibility issues.

---

### Step 1: Install Required Software (Ubuntu 22.04)

#### 1.1 Update System
```bash
sudo apt update && sudo apt upgrade -y
```

#### 1.2 Install Node.js 24 LTS
```bash
# Install Node.js official repository
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -

# Install Node.js (npm included)
sudo apt install -y nodejs

# Verify installation
node -v    # Should show v24.x.x
npm -v     # Should show 10.x.x or higher
```

#### 1.3 Install MySQL 8.0
```bash
# Install MySQL
sudo apt install -y mysql-server

# Start and enable MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# Secure installation (follow prompts to set root password)
sudo mysql_secure_installation

# Verify installation
mysql --version    # Should show mysql Ver 8.0.x
```

#### 1.4 Install Redis
```bash
# Install Redis
sudo apt install -y redis-server

# Start and enable Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify installation
redis-cli ping    # Should show PONG
```

#### 1.5 Install Nginx
```bash
# Install Nginx
sudo apt install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify: visit http://your-server-ip in browser
```

#### 1.6 Install PM2
```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify installation
pm2 -v
```

#### 1.7 Install Git
```bash
# Install Git
sudo apt install -y git

# Verify installation
git --version
```

---

### Step 2: Clone Repository
```bash
# Create directory
sudo mkdir -p /var/www
cd /var/www

# Clone repository
sudo git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform

# Set permissions
sudo chown -R $USER:$USER /var/www/ai-platform
```

---

### Step 3: Setup Database
```bash
# Login to MySQL
sudo mysql -u root -p
```

Execute the following SQL commands:
```sql
-- Create database
CREATE DATABASE ai_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user (CHANGE THE PASSWORD!)
CREATE USER 'ai_user'@'localhost' IDENTIFIED BY 'YourSecurePassword123!';

-- Grant privileges
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;

-- Exit MySQL
EXIT;
```

Import database structure:
```bash
cd /var/www/ai-platform

# Import schema
mysql -u ai_user -p ai_platform < docker/mysql-init/01-complete-database-structure.sql

# Import initial data
mysql -u ai_user -p ai_platform < docker/mysql-init/02-initial-data.sql
```

---

### Step 4: Configure Backend
```bash
cd /var/www/ai-platform/backend

# Copy template
cp .env.template .env

# Edit configuration
nano .env
```

**Required configuration items:**
```env
# Database (use credentials from Step 3)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ai_platform
DB_USER=ai_user
DB_PASSWORD=YourSecurePassword123!

# JWT Secrets (MUST CHANGE! Generate with command below)
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
JWT_ACCESS_SECRET=your_generated_random_string_1
JWT_REFRESH_SECRET=your_generated_random_string_2

# Your domain (use server IP if no domain)
CORS_ORIGIN=https://your-domain.com
```

Press `Ctrl+O` to save, `Ctrl+X` to exit.

---

### Step 5: Install Dependencies and Build
```bash
# Backend
cd /var/www/ai-platform/backend
npm install

# Test backend (check for errors)
node src/server.js
# If you see "Server running on port 4000", it works!
# Press Ctrl+C to stop

# Frontend
cd /var/www/ai-platform/frontend
npm install
npm run build    # Takes a few minutes

# Verify build
ls dist    # Should see index.html and other files
```

---

### Step 6: Configure Nginx
```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/ai-platform
```

Paste the following (replace `your-domain.com`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend static files
    location / {
        root /var/www/ai-platform/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        
        # SSE streaming support
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # File uploads
    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
    }
}
```
```bash
# Enable config
sudo ln -s /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

### Step 7: Start Services with PM2
```bash
cd /var/www/ai-platform

# Start services
pm2 start ecosystem.config.js

# Check status (should show "online")
pm2 status

# Setup auto-start on boot
pm2 save
pm2 startup
# Execute the command it outputs
```

---

### Step 8: Verify Installation

1. **Access frontend**: Open `http://your-domain.com` in browser
2. **Default admin account**:

| Username | Password |
|----------|----------|
| admin | Admin@123456 |

3. **⚠️ IMPORTANT: Change admin password immediately after first login!**

---

### Post-Installation Configuration

1. Login as admin
2. Go to **Settings > AI Models** and configure API keys
3. Enable the models you want to use

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

# 6. Install Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# 7. Verify installations
docker --version
docker-compose --version
git --version
certbot --version
node --version
npm --version

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
docker exec -i ai-platform-mysql mysql -uai_user -p'YOUR_DB_PASSWORD' ai_platform << 'SQLEOF'
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
SQLEOF

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

### What's Included

- MySQL 8.0 + Redis 7 + Node.js Backend + Nginx Frontend
- Auto SSL certificate via Let's Encrypt (webroot renewal mode)
- Health checks for all services
- Zero-downtime rolling updates

### Production Deployments

| Domain | Users |
|--------|-------|
| www.nebulink.com.cn | 1,474 |
| ai.pkuailab.com | 909 |

---

## Troubleshooting

### npm install is slow or fails
```bash
# Use mirror (for users in China)
npm config set registry https://registry.npmmirror.com

# Or use yarn
npm install -g yarn
yarn install
```

### MySQL connection failed
```bash
# Check MySQL status
sudo systemctl status mysql

# Check user permissions
mysql -u ai_user -p -e "SHOW DATABASES;"
```

### Port already in use
```bash
# Check port usage
sudo lsof -i :4000
sudo lsof -i :80

# Kill process
sudo kill -9 <PID>
```

### PM2 service errors
```bash
# View logs
pm2 logs

# Restart services
pm2 restart all

# View detailed error
pm2 logs --lines 100
```

### Frontend build fails (out of memory)
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Docker: Container not starting
```bash
# View container logs
docker-compose logs backend
docker-compose logs frontend

# Restart containers
docker-compose restart

# Rebuild containers
docker-compose up -d --build
```

### Docker: SSL renewal fails
```bash
# Verify webroot mode is configured
cat /etc/letsencrypt/renewal/your-domain.com.conf

# Test renewal
certbot renew --dry-run
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

> 所有模块作为验证AOCI有效性的真实数据集。

---

## 系统架构

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite 5 + Ant Design 5 + Monaco Editor + ReactFlow |
| 后端 | Node.js 24 + Express.js + PM2 |
| 数据库 | MySQL 8.0 + Redis 6.0 |
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
| 操作系统 | Ubuntu 22.04 LTS（推荐）/ Debian 12 / CentOS Stream 9 |
| 服务器配置 | 最低2核4G，推荐2核8G |
| 云服务商 | 阿里云、腾讯云、华为云、AWS等均可 |

> ⚠️ **不推荐Windows服务器**，会有很多兼容性问题。

---

### 第一步：安装必需软件（Ubuntu 22.04）

#### 1.1 更新系统
```bash
sudo apt update && sudo apt upgrade -y
```

#### 1.2 安装Node.js 24 LTS
```bash
# 安装Node.js官方源
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -

# 安装Node.js（会同时安装npm）
sudo apt install -y nodejs

# 验证安装
node -v    # 应显示 v24.x.x
npm -v     # 应显示 10.x.x 或更高
```

#### 1.3 安装MySQL 8.0
```bash
# 安装MySQL
sudo apt install -y mysql-server

# 启动MySQL并设置开机自启
sudo systemctl start mysql
sudo systemctl enable mysql

# 安全配置（按提示设置root密码）
sudo mysql_secure_installation

# 验证安装
mysql --version    # 应显示 mysql Ver 8.0.x
```

#### 1.4 安装Redis
```bash
# 安装Redis
sudo apt install -y redis-server

# 启动Redis并设置开机自启
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证安装
redis-cli ping    # 应显示 PONG
```

#### 1.5 安装Nginx
```bash
# 安装Nginx
sudo apt install -y nginx

# 启动Nginx并设置开机自启
sudo systemctl start nginx
sudo systemctl enable nginx

# 验证安装（浏览器访问服务器IP应看到Nginx欢迎页）
```

#### 1.6 安装PM2（进程管理器）
```bash
# 全局安装PM2
sudo npm install -g pm2

# 验证安装
pm2 -v
```

#### 1.7 安装Git
```bash
# 安装Git
sudo apt install -y git

# 验证安装
git --version
```

---

### 第二步：克隆项目代码
```bash
# 创建目录
sudo mkdir -p /var/www
cd /var/www

# 克隆代码
sudo git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git ai-platform
cd ai-platform

# 设置目录权限
sudo chown -R $USER:$USER /var/www/ai-platform
```

---

### 第三步：创建数据库
```bash
# 登录MySQL
sudo mysql -u root -p
```

在MySQL命令行中执行以下SQL：
```sql
-- 创建数据库
CREATE DATABASE ai_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户（请修改密码！）
CREATE USER 'ai_user'@'localhost' IDENTIFIED BY '你的安全密码';

-- 授权
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;

-- 退出MySQL
EXIT;
```

导入数据库结构：
```bash
cd /var/www/ai-platform

# 导入表结构
mysql -u ai_user -p ai_platform < docker/mysql-init/01-complete-database-structure.sql

# 导入初始数据
mysql -u ai_user -p ai_platform < docker/mysql-init/02-initial-data.sql
```

---

### 第四步：配置后端
```bash
cd /var/www/ai-platform/backend

# 复制配置模板
cp .env.template .env

# 编辑配置文件
nano .env
```

**必须修改的配置项：**
```env
# 数据库配置（填入第三步创建的用户信息）
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ai_platform
DB_USER=ai_user
DB_PASSWORD=你的安全密码

# JWT密钥（必须修改！用下面的命令生成）
# 生成命令：node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
JWT_ACCESS_SECRET=生成的随机字符串1
JWT_REFRESH_SECRET=生成的随机字符串2

# 你的域名（没有域名先填服务器IP）
CORS_ORIGIN=https://你的域名
```

按 `Ctrl+O` 保存，`Ctrl+X` 退出。

---

### 第五步：安装依赖并构建
```bash
# 后端
cd /var/www/ai-platform/backend
npm install

# 测试后端（检查是否有报错）
node src/server.js
# 如果看到 "Server running on port 4000" 说明成功
# 按 Ctrl+C 停止

# 前端
cd /var/www/ai-platform/frontend
npm install
npm run build    # 需要几分钟

# 验证构建
ls dist    # 应看到 index.html 等文件
```

---

### 第六步：配置Nginx
```bash
# 创建Nginx配置文件
sudo nano /etc/nginx/sites-available/ai-platform
```

粘贴以下内容（记得修改域名）：
```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    # 前端静态文件
    location / {
        root /var/www/ai-platform/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端API代理
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        
        # SSE流式输出支持
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # 静态文件上传目录
    location /uploads/ {
        alias /var/www/ai-platform/storage/uploads/;
    }
}
```
```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/

# 删除默认站点（可选）
sudo rm /etc/nginx/sites-enabled/default

# 测试配置是否正确
sudo nginx -t

# 重启Nginx
sudo systemctl restart nginx
```

---

### 第七步：使用PM2启动服务
```bash
cd /var/www/ai-platform

# 启动服务
pm2 start ecosystem.config.js

# 查看状态（应显示 online）
pm2 status

# 设置开机自启
pm2 save
pm2 startup
# 执行它输出的命令
```

---

### 第八步：验证部署

1. **访问前端**：浏览器打开 `http://你的域名或IP`
2. **默认管理员账号**：

| 用户名 | 密码 |
|--------|------|
| admin | Admin@123456 |

3. **⚠️ 重要：首次登录后请立即修改管理员密码！**

---

### 安装后配置

1. 以管理员身份登录
2. 进入**设置 > AI模型管理**，配置API密钥
3. 启用需要使用的模型

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

# 6. 安装 Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# 7. 验证安装
docker --version
docker-compose --version
git --version
certbot --version
node --version
npm --version

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
docker exec -i ai-platform-mysql mysql -uai_user -p'YOUR_DB_PASSWORD' ai_platform << 'SQLEOF'
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
SQLEOF

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

### 包含内容

- MySQL 8.0 + Redis 7 + Node.js后端 + Nginx前端
- Let's Encrypt自动SSL证书（webroot续期模式）
- 所有服务健康检查
- 零停机滚动更新

### 已使用Docker部署的生产环境

| 域名 | 用户数 |
|------|--------|
| www.nebulink.com.cn | 1,474 |
| ai.pkuailab.com | 909 |

---

## 常见问题

### npm install 很慢或失败
```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 或使用yarn
npm install -g yarn
yarn install
```

### MySQL连接失败
```bash
# 检查MySQL是否运行
sudo systemctl status mysql

# 检查用户权限
mysql -u ai_user -p -e "SHOW DATABASES;"
```

### 端口被占用
```bash
# 查看端口占用
sudo lsof -i :4000
sudo lsof -i :80

# 杀掉占用进程
sudo kill -9 进程ID
```

### PM2服务异常
```bash
# 查看日志
pm2 logs

# 重启服务
pm2 restart all

# 查看详细错误
pm2 logs --lines 100
```

### 前端构建失败（内存不足）
```bash
# 增加Node.js内存限制
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Docker：容器无法启动
```bash
# 查看容器日志
docker-compose logs backend
docker-compose logs frontend

# 重启容器
docker-compose restart

# 重新构建容器
docker-compose up -d --build
```

### Docker：SSL续期失败
```bash
# 验证webroot模式是否配置
cat /etc/letsencrypt/renewal/你的域名.com.conf

# 测试续期
certbot renew --dry-run
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

---
