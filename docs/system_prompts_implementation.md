# 系统提示词功能实现总结

## 功能概述
系统提示词功能允许管理员预设多个AI角色模板，用户在创建对话时可以选择使用，提升用户体验。

## 数据库结构

### 1. 主要表结构
- **system_prompts**: 存储系统提示词
  - id (INT): 主键
  - name (VARCHAR(50)): 提示词名称
  - description (VARCHAR(200)): 描述
  - content (TEXT): 提示词内容
  - sort_order (INT): 排序顺序
  - is_active (BOOLEAN): 是否启用
  - created_by (BIGINT): 创建人ID

- **system_prompt_groups**: 提示词与用户组关联表
  - prompt_id (INT): 提示词ID
  - group_id (BIGINT): 用户组ID
  - PRIMARY KEY (prompt_id, group_id)

- **conversations表新增字段**:
  - system_prompt_id (INT): 使用的系统提示词ID

### 2. 迁移文件
- `/database/migrations/016_add_system_prompts.sql`: 包含所有必要的表结构和初始数据

## API接口

### 管理端接口 (/api/admin/system-prompts)
- GET `/` - 获取系统提示词列表
- GET `/status` - 获取功能开关状态
- GET `/:id` - 获取单个提示词详情
- POST `/` - 创建系统提示词
- PUT `/:id` - 更新系统提示词
- DELETE `/:id` - 删除系统提示词
- PUT `/toggle` - 切换功能开关

### 用户端接口 (/api/chat)
- GET `/system-prompts` - 获取用户可用的系统提示词列表

## 主要功能特性

1. **权限控制**
   - 只有超级管理员可以管理系统提示词
   - 可以设置特定用户组可见
   - 用户只能看到和使用其所在组可见的提示词

2. **功能开关**
   - 支持全局启用/禁用功能
   - 禁用后用户端不显示相关选项

3. **用户使用**
   - 创建对话时可选择预设提示词
   - 支持在预设和自定义之间切换
   - 编辑对话时可更改选择

4. **安全性**
   - 用户无法看到提示词的具体内容
   - 只显示名称和描述
   - 防止提示词泄露

## 默认提示词
系统预置了5个常用模板：
1. 通用助手 - 友好专业的日常对话
2. 技术专家 - 编程和技术问题解答
3. 创意写作 - 文案和创意内容创作
4. 学习辅导 - 教育和学习辅导
5. 商务助理 - 商务沟通和文档撰写

## Docker部署注意事项

1. **数据库迁移**
   - 迁移文件已包含在 `/database/migrations/016_add_system_prompts.sql`
   - Docker容器启动时会自动执行
   - 使用了兼容的数据类型（BIGINT for group_id）

2. **环境变量**
   - 无需额外的环境变量配置
   - 使用现有的数据库连接配置

3. **兼容性**
   - 支持MySQL 5.7+
   - 使用标准SQL语法
   - 处理了DISTINCT和ORDER BY的兼容性问题

## 技术实现细节

1. **SQL优化**
   - 修复了 `SELECT DISTINCT` 与 `ORDER BY` 的冲突
   - 添加了必要的索引提升查询性能

2. **事务处理**
   - 创建和更新操作使用事务保证数据一致性
   - 正确处理了批量插入的语法问题

3. **错误处理**
   - 完善的错误日志记录
   - 友好的用户错误提示

## 更新日期
2024-08-04
