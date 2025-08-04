
## 数据库自动迁移说明

从 2025年8月5日 版本开始，系统支持自动数据库迁移：

1. **工作原理**：
   - 开发者会在 `database/migrations/` 目录创建SQL迁移文件
   - Docker容器启动时自动检查并执行未执行的迁移
   - 迁移记录保存在 `schema_migrations` 表中

2. **迁移文件命名规范**：
   - 格式：`序号_描述.sql`
   - 例如：`019_add_new_feature.sql`

3. **用户无需操作**：
   - 只需正常执行 `git pull` 和 `docker-compose up -d`
   - 系统会自动处理数据库结构更新
   - 所有用户数据完整保留

4. **查看迁移状态**：
   ```bash
   docker exec ai-platform-mysql mysql -u root -p'密码' ai_platform -e "SELECT * FROM schema_migrations;"
