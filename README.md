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

## System Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite 5 + Ant Design 5 |
| Backend | Node.js + Express.js |
| Database | MySQL 8.0 + Redis 6.0 |
| Authentication | JWT + bcrypt + Casbin RBAC |
| Process Management | PM2 |
| Deployment | Nginx + Let's Encrypt SSL |

### Database Schema

- **90 objects** (83 tables + 4 backup tables + 3 views)

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 6.0
- Nginx >= 1.20 (for production)

### Installation
```bash
# Clone repository
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git
cd ai.xingyuncl.com-20250708

# Backend setup
cd backend
cp .env.template .env
# Edit .env with your configuration
npm install

# Frontend setup
cd ../frontend
npm install
npm run build

# Database initialization
mysql -u root -p ai_platform < docker/mysql-init/01-complete-database-structure.sql
mysql -u root -p ai_platform < docker/mysql-init/02-initial-data.sql

# Start services
pm2 start ecosystem.config.js
```

### Default Admin Account

| Username | Password |
|----------|----------|
| admin | Admin@123456 |

**⚠️ Important**: Change the admin password immediately after first login.

### Post-Installation

1. Login as admin
2. Go to **Settings > AI Models** and configure API keys
3. Enable the models you want to use

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

## Acknowledgments

- AI Application and Innovation Lab, School of New Media, Peking University
- Xingyun Zhixue (Beijing) Technology Co., Ltd.

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

## 系统架构

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite 5 + Ant Design 5 |
| 后端 | Node.js + Express.js |
| 数据库 | MySQL 8.0 + Redis 6.0 |
| 认证 | JWT + bcrypt + Casbin RBAC |
| 进程管理 | PM2 |
| 部署 | Nginx + Let's Encrypt SSL |

### 数据库架构

- **90个对象**（83张表 + 4张备份表 + 3个视图）

---

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 6.0
- Nginx >= 1.20（生产环境）

### 安装步骤
```bash
# 克隆仓库
git clone https://github.com/alkor2000/ai.xingyuncl.com-20250708.git
cd ai.xingyuncl.com-20250708

# 后端配置
cd backend
cp .env.template .env
# 编辑.env填入你的配置
npm install

# 前端配置
cd ../frontend
npm install
npm run build

# 数据库初始化（需先创建数据库：CREATE DATABASE ai_platform;）
mysql -u root -p ai_platform < docker/mysql-init/01-complete-database-structure.sql
mysql -u root -p ai_platform < docker/mysql-init/02-initial-data.sql

# 启动服务
pm2 start ecosystem.config.js
```

### 默认管理员账户

| 用户名 | 密码 |
|--------|------|
| admin | Admin@123456 |

**⚠️ 重要**：首次登录后请立即修改管理员密码。

### 安装后配置

1. 以管理员身份登录
2. 进入**设置 > AI模型管理**，配置API密钥
3. 启用需要使用的模型

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

## 致谢

- 北京大学新媒体学院AI应用与创新实验室
- 星云智学（北京）科技有限公司
