# 星云AI平台版本信息

## v1.2.0 (2024-08-19)

### 新增功能
- HTML编辑器模块
- Midjourney图像生成支持
- 用户UUID支持（SSO准备）

### 数据库变更
- 新增表：html_pages, html_projects, html_resources, html_templates
- 新增表：midjourney_tasks
- 新增字段：users.uuid, image_models.generation_type

### 升级说明
1. 备份数据库
2. 运行升级工具：docker-compose run backend db-upgrade
3. 重启服务：docker-compose restart

### 包含表数量
- 总计：33个表
