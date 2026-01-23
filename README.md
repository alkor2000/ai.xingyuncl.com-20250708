# AI Practice Platform | AI应用与实践平台

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Lines of Code](https://img.shields.io/badge/Lines%20of%20Code-156%2C454-blue)](https://github.com/alkor2000/ai.xingyuncl.com-20250708)
[![Paper](https://img.shields.io/badge/Paper-FSE%202026-green)](https://github.com/alkor2000/ai.xingyuncl.com-20250708)

**English** | [中文](#中文文档)

---

## Overview

This repository contains the complete source code for the **AI Practice Platform**—a production system of 156,454 lines of code built entirely by a non-programmer using only web-based LLMs and text editors, guided by the **AOCI (AI-Oriented Code Indexing)** methodology.

This work accompanies the paper submitted to **FSE 2026 Industry Track**:

> **AOCI: An AI-Native Architecture Description Language for Bridging the Repository-Level Cognitive Gap**
> 
> *Can a non-programmer independently build a 240K LOC production system? Our empirical evidence says yes.*

### Key Metrics

| Metric | Value |
|--------|-------|
| Total Lines of Code | 156,454 |
| Git Commits | 454 |
| Active Users | 4,400+ |
| Development Period | 8 months (spare time) |
| Developer Background | Geophysics undergraduate, 20 years away from coding |
| Tools Used | Web-based LLMs + Text Editor (No IDE) |

---

## What is AOCI?

**AOCI (AI-Oriented Code Indexing)** is a pure-text protocol that serves as middleware between raw code and LLM context windows. It achieves:

- **~300:1 line compression** (~40:1 token compression)
- **60%-90% architectural information retention**
- **O(1) incremental maintenance** via single-file independence
- **Human-readable, Git-versionable** index documents

The complete AOCI index for this 156K LOC system is approximately **600 lines**.

### The Three Paradigms of Code Indexing

| Paradigm | Representative | Index Generator | Information Level |
|----------|---------------|-----------------|-------------------|
| Syntax Extraction | Aider RepoMap | Tree-sitter | AST signatures |
| Vector Embedding | Cursor @Codebase | Embedding Model | Semantic similarity |
| **Semantic Compression** | **AOCI** | **LLM** | **Business intent** |

**Core insight**: The fundamental difference lies in "who generates the index." Only LLMs can understand and preserve business intent.

---

## AOCI Index

The complete AOCI index (code + database schema) is available in:

| Language | Location |
|----------|----------|
| English | [docs/aoci/index-en-US-20260123.txt](docs/aoci/index-en-US-20260123.txt) |
| 中文 | [docs/aoci/index-zh-CN-20260123.txt](docs/aoci/index-zh-CN-20260123.txt) |

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

### 19 Business Modules

1. **Core System** - Server startup, configuration, health checks
2. **Authentication** - 4 login methods, SSO, JWT dual-token
3. **Chat System** - Multi-model AI conversations, streaming responses
4. **Credits Management** - Quota allocation, transaction logging
5. **Knowledge Modules** - Drag-and-drop module assembly
6. **AI Model Management** - Multi-provider integration, connection testing
7. **Image Generation** - Volcano/Midjourney/Wanxiang providers
8. **Video Generation** - Volcano/Kling/Sora2 providers
9. **Agent Workflow** - Visual workflow editor, topological sort
10. **Smart Teaching** - Three-tier permission system, course management
11. **HTML Editor** - Monaco integration, live preview
12. **Smart Calendar** - AI-powered event analysis
13. **Storage System** - OSS integration, folder management
14. **OCR Tool** - Mistral OCR API integration
15. **Mindmap** - Markdown/Mermaid/SVG modes, PDF export
16. **Admin Dashboard** - Analytics, user management, system settings
17. **Smart Apps** - Customizable AI application marketplace
18. **Wiki Knowledge Base** - Version management, collaborative editing
19. **Other Utilities** - Statistics, logging, migrations

### Database Schema

- **90 objects** (83 tables + 4 backup tables + 3 views)
- Organized into 12 logical modules

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

After installation, login with:

| Username | Password |
|----------|----------|
| admin | Admin@123456 |

**⚠️ Important**: Change the admin password immediately after first login.

### Post-Installation Configuration

1. Login as admin
2. Go to **Settings > AI Models** and configure API keys
3. Enable the models you want to use
4. Configure other settings as needed (SMTP, registration, etc.)

### Configuration

Key environment variables (see `.env.template`):
```bash
# Database
DB_HOST=localhost
DB_PASSWORD=your_secure_password

# JWT (generate unique secrets for each deployment)
JWT_ACCESS_SECRET=your_64_byte_secret
JWT_REFRESH_SECRET=your_64_byte_secret

# Domain
APP_DOMAIN=your-domain.com
```

---

## Research Reproducibility

This repository supports the empirical claims in our FSE 2026 submission:

| Claim | Verification Method |
|-------|---------------------|
| 156,454 lines of code | `find . -name "*.js" -o -name "*.jsx" \| xargs wc -l` |
| 454 Git commits | `git rev-list --count HEAD` |
| ~600 line AOCI index | `wc -l docs/aoci/index-*.txt` |
| 90 database objects | Check AOCI index database section |

---

## Citation

If you use this work in your research, please cite:
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

本仓库包含**AI应用与实践平台**的完整源代码——一个由非程序员仅使用网页版LLM和文本编辑器，在**AOCI（AI导向的代码索引）**方法论指导下构建的156,454行生产系统。

本工作配套提交至**FSE 2026 Industry Track**的论文：

> **AOCI：一种弥合仓库级认知鸿沟的AI原生架构描述语言**
> 
> *非程序员能独立构建24万行生产系统吗？我们的实证答案是：能。*

### 核心数据

| 指标 | 数值 |
|------|------|
| 代码总行数 | 156,454行 |
| Git提交次数 | 454次 |
| 活跃用户 | 4,400+ |
| 开发周期 | 8个月（业余时间） |
| 开发者背景 | 地球物理学本科，20年未写代码 |
| 使用工具 | 网页版LLM + 文本编辑器（无IDE） |

---

## 什么是AOCI？

**AOCI（AI-Oriented Code Indexing，AI导向的代码索引）**是一种纯文本协议，作为原始代码与LLM上下文窗口之间的中间件：

- **约300:1的行数压缩**（约40:1的Token压缩）
- **60%-90%的架构信息保留率**
- **O(1)增量维护**（基于单文件独立性）
- **人类可读、Git可版本控制**

这个156K行系统的完整AOCI索引仅约**600行**。

### 代码索引的三种范式

| 范式 | 代表工具 | 索引生成者 | 信息层次 |
|------|---------|-----------|---------|
| 语法提取 | Aider RepoMap | Tree-sitter | AST语法签名 |
| 向量嵌入 | Cursor @Codebase | Embedding模型 | 语义相似度 |
| **语义压缩** | **AOCI** | **LLM** | **业务意图** |

**核心洞察**：三种范式的根本差异在于"谁生成索引"。只有LLM才能理解并保留业务意图。

---

## AOCI索引

完整的AOCI索引（代码+数据库）提供两种语言版本：

| 语言 | 位置 |
|------|------|
| English | [docs/aoci/index-en-US-20260123.txt](docs/aoci/index-en-US-20260123.txt) |
| 中文 | [docs/aoci/index-zh-CN-20260123.txt](docs/aoci/index-zh-CN-20260123.txt) |

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

### 19个业务模块

1. **核心系统** - 服务器启动、配置、健康检查
2. **认证授权** - 4种登录方式、SSO、JWT双Token
3. **对话系统** - 多模型AI对话、流式响应
4. **积分管理** - 配额分配、交易日志
5. **知识模块** - 拖拽式模块组装
6. **AI模型管理** - 多供应商集成、连通性测试
7. **图像生成** - 火山/Midjourney/万相
8. **视频生成** - 火山/可灵/Sora2
9. **Agent工作流** - 可视化编辑器、拓扑排序
10. **智能教学** - 三级权限体系、课程管理
11. **HTML编辑器** - Monaco集成、实时预览
12. **智能日历** - AI事项分析
13. **存储系统** - OSS集成、文件夹管理
14. **OCR工具** - Mistral OCR集成
15. **思维导图** - Markdown/Mermaid/SVG模式
16. **管理后台** - 数据分析、用户管理
17. **智能应用广场** - 可定制AI应用市场
18. **知识库Wiki** - 版本管理、协作编辑
19. **其他工具** - 统计、日志、迁移

### 数据库架构

- **90个对象**（83张表 + 4张备份表 + 3个视图）
- 按12个逻辑模块组织

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

安装完成后，使用以下账户登录：

| 用户名 | 密码 |
|--------|------|
| admin | Admin@123456 |

**⚠️ 重要**：首次登录后请立即修改管理员密码。

### 安装后配置

1. 以管理员身份登录
2. 进入**设置 > AI模型管理**，配置API密钥
3. 启用需要使用的模型
4. 根据需要配置其他设置（邮件SMTP、注册开关等）

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
