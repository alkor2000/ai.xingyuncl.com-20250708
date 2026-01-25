# Security Policy | 安全策略

**English** | [中文](#中文文档)

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

---

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by emailing **security@xingyuncl.com**.

Please do **NOT** create a public GitHub issue for security vulnerabilities.

We will respond within 48 hours and work with you to understand and address the issue.

---

## Security Best Practices for Deployment

### 1. Environment Variables

Never commit sensitive data to version control. Use environment variables:
```bash
# Copy template
cp backend/.env.template backend/.env

# Edit with your secure values
nano backend/.env

# Set proper permissions
chmod 600 backend/.env
```

### 2. Generate Strong Secrets

Always generate unique JWT secrets for your deployment:
```bash
# Generate JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# Generate JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

### 3. Database Security

- Use a strong, unique password for your database user
- Restrict database user permissions to only what's needed
- Never use `root` user for application connections
```sql
-- Example: Create limited user
CREATE USER 'ai_user'@'localhost' IDENTIFIED BY 'YourStrongPassword!';
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Redis Security

For production, configure Redis authentication:
```bash
# In redis.conf
requirepass YourRedisPassword
```

### 5. HTTPS Configuration

Always use HTTPS in production. We recommend Let's Encrypt:
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com
```

### 6. File Permissions
```bash
# Application directory
chmod 755 /var/www/ai-platform

# Sensitive files
chmod 600 /var/www/ai-platform/backend/.env

# Upload directory
chmod 755 /var/www/ai-platform/storage/uploads
```

### 7. Firewall Configuration

Only expose necessary ports:
```bash
# Allow SSH, HTTP, HTTPS only
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 8. Regular Updates

Keep your system and dependencies updated:
```bash
# System updates
sudo apt update && sudo apt upgrade -y

# NPM dependencies
cd backend && npm audit fix
cd frontend && npm audit fix
```

---

## Security Checklist

Before going to production, verify:

- [ ] Changed default admin password
- [ ] Generated unique JWT secrets
- [ ] Set strong database password
- [ ] Configured HTTPS
- [ ] Set proper file permissions
- [ ] Enabled firewall
- [ ] Disabled debug mode
- [ ] Removed/secured backup files

---

## Contact

For security concerns, please contact: **security@xingyuncl.com**

---

<a name="中文文档"></a>

# 中文文档

## 支持的版本

| 版本 | 支持状态 |
| ---- | ------- |
| 1.x.x | :white_check_mark: |

---

## 报告安全漏洞

如果您发现安全漏洞，请发送邮件至 **security@xingyuncl.com**。

请**不要**在GitHub上创建公开的Issue来报告安全漏洞。

我们将在48小时内回复，并与您一起理解和解决问题。

---

## 部署安全最佳实践

### 1. 环境变量管理

敏感数据不要提交到版本控制。使用环境变量：
```bash
# 复制模板
cp backend/.env.template backend/.env

# 编辑配置
nano backend/.env

# 设置文件权限
chmod 600 backend/.env
```

### 2. 生成强密钥

部署时必须生成唯一的JWT密钥：
```bash
# 生成 JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# 生成 JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

### 3. 数据库安全

- 使用强密码
- 限制数据库用户权限
- 不要使用`root`用户连接应用
```sql
-- 示例：创建受限用户
CREATE USER 'ai_user'@'localhost' IDENTIFIED BY '你的强密码!';
GRANT ALL PRIVILEGES ON ai_platform.* TO 'ai_user'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Redis安全

生产环境配置Redis密码认证：
```bash
# 在 redis.conf 中添加
requirepass 你的Redis密码
```

### 5. HTTPS配置

生产环境必须使用HTTPS。推荐使用Let's Encrypt：
```bash
# 安装Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com
```

### 6. 文件权限
```bash
# 应用目录
chmod 755 /var/www/ai-platform

# 敏感文件
chmod 600 /var/www/ai-platform/backend/.env

# 上传目录
chmod 755 /var/www/ai-platform/storage/uploads
```

### 7. 防火墙配置

只开放必要的端口：
```bash
# 只允许 SSH、HTTP、HTTPS
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 8. 定期更新

保持系统和依赖更新：
```bash
# 系统更新
sudo apt update && sudo apt upgrade -y

# NPM依赖更新
cd backend && npm audit fix
cd frontend && npm audit fix
```

---

## 安全检查清单

上线前请确认：

- [ ] 已修改默认管理员密码
- [ ] 已生成唯一的JWT密钥
- [ ] 已设置强数据库密码
- [ ] 已配置HTTPS
- [ ] 已设置正确的文件权限
- [ ] 已启用防火墙
- [ ] 已关闭调试模式
- [ ] 已清理备份文件

---

## 联系方式

安全问题请联系：**security@xingyuncl.com**

---

最后更新：2026-01-26
