/**
 * 思维导图默认模板
 * 包含 Markdown、Mermaid、SVG 三种类型的示例代码
 */

// Markdown 思维导图模板
export const MARKDOWN_TEMPLATE = `# 项目规划

## 第一阶段
### 需求分析
- 用户调研
- 竞品分析
- 功能清单

### 技术选型
- 前端框架
  - React 18
  - Ant Design 5
- 后端技术
  - Node.js
  - Express
  - MySQL

## 第二阶段
### 系统设计
#### 架构设计
- 微服务架构
- 容器化部署
- 负载均衡

#### 数据库设计
- 表结构设计
- 索引优化
- 分库分表策略

### UI/UX设计
- 设计规范
- 原型设计
- 交互优化

## 第三阶段
### 开发实施
- 敏捷开发
- 代码审查
- 单元测试

### 部署上线
- CI/CD流程
- 灰度发布
- 监控告警`;

// Mermaid 流程图模板
export const MERMAID_TEMPLATE = `graph TD
    A[开始] --> B{需求分析}
    B -->|需求明确| C[系统设计]
    B -->|需求不明确| B
    C --> D[技术选型]
    D --> E[开发实施]
    E --> F[测试验证]
    F -->|测试通过| G[部署上线]
    F -->|测试失败| E
    G --> H[运维监控]
    H --> I[持续优化]
    I --> J[结束]`;

// SVG 矢量图模板
export const SVG_TEMPLATE = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景 -->
  <rect width="400" height="300" fill="#f0f2f5"/>
  
  <!-- 主圆形 -->
  <circle cx="200" cy="150" r="100" fill="#1890ff" opacity="0.8"/>
  
  <!-- 内圆 -->
  <circle cx="200" cy="150" r="60" fill="#fff" opacity="0.9"/>
  
  <!-- 文本 -->
  <text x="200" y="160" 
        text-anchor="middle" 
        font-size="24" 
        font-weight="bold"
        fill="#1890ff">
    SVG编辑器
  </text>
  
  <!-- 装饰圆点 -->
  <circle cx="120" cy="80" r="15" fill="#52c41a" opacity="0.7"/>
  <circle cx="280" cy="80" r="15" fill="#faad14" opacity="0.7"/>
  <circle cx="120" cy="220" r="15" fill="#f5222d" opacity="0.7"/>
  <circle cx="280" cy="220" r="15" fill="#722ed1" opacity="0.7"/>
</svg>`;

// 导出所有模板
export default {
  markdown: MARKDOWN_TEMPLATE,
  mermaid: MERMAID_TEMPLATE,
  svg: SVG_TEMPLATE
};
