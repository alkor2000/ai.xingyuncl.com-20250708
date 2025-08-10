/**
 * 知识模块列表组件 - Apple风格卡片设计
 */

import React, { useState } from 'react'
import {
  Row,
  Col,
  Card,
  Tag,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  message,
  Badge,
  Input,
  Select,
  Empty,
  Typography,
  Dropdown,
  Menu
} from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  LockOutlined,
  SearchOutlined,
  MoreOutlined,
  FireOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'
import './KnowledgeModuleList.less'

const { Search } = Input
const { Option } = Select
const { Text, Paragraph } = Typography

const KnowledgeModuleList = ({ 
  modules, 
  onEdit, 
  onRefresh,
  canCreateTeam,
  canCreateSystem 
}) => {
  const { deleteModule } = useKnowledgeStore()
  const { user } = useAuthStore()
  const { userGroups } = useAdminStore()
  
  const [searchText, setSearchText] = useState('')
  const [filterScope, setFilterScope] = useState('all')
  const [filterType, setFilterType] = useState('all')

  // 处理删除
  const handleDelete = async (moduleId) => {
    try {
      await deleteModule(moduleId)
      message.success('删除成功')
      onRefresh()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  // 过滤模块
  const filteredModules = modules.filter(module => {
    if (searchText && !module.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !module.description?.toLowerCase().includes(searchText.toLowerCase())) {
      return false
    }
    
    if (filterScope !== 'all' && module.module_scope !== filterScope) {
      return false
    }
    
    if (filterType !== 'all' && module.prompt_type !== filterType) {
      return false
    }
    
    return true
  })

  // 获取范围配置 - 使用苹果色系
  const getScopeConfig = (scope) => {
    const configs = {
      personal: { 
        color: '#007AFF', 
        bgColor: 'rgba(0, 122, 255, 0.08)',
        icon: <UserOutlined />, 
        text: '个人'
      },
      team: { 
        color: '#34C759', 
        bgColor: 'rgba(52, 199, 89, 0.08)',
        icon: <TeamOutlined />, 
        text: '团队'
      },
      system: { 
        color: '#FF9500', 
        bgColor: 'rgba(255, 149, 0, 0.08)',
        icon: <GlobalOutlined />, 
        text: '系统'
      }
    }
    return configs[scope] || configs.personal
  }

  // 渲染模块卡片 - Apple风格
  const renderModuleCard = (module) => {
    const scopeConfig = getScopeConfig(module.module_scope)
    const canEdit = module.creator_id === user.id || 
                   (module.module_scope === 'team' && canCreateTeam) ||
                   (module.module_scope === 'system' && canCreateSystem)
    const canDelete = module.creator_id === user.id || canCreateSystem
    
    const moreMenu = (
      <Menu className="apple-menu">
        {canEdit && (
          <Menu.Item key="edit" icon={<EditOutlined />} onClick={() => onEdit(module)}>
            编辑模块
          </Menu.Item>
        )}
        {canDelete && (
          <Menu.Item key="delete" icon={<DeleteOutlined />} danger>
            <Popconfirm
              title="确定要删除这个模块吗？"
              description="删除后无法恢复"
              onConfirm={() => handleDelete(module.id)}
              okText="确定"
              cancelText="取消"
              placement="left"
            >
              删除模块
            </Popconfirm>
          </Menu.Item>
        )}
      </Menu>
    )
    
    return (
      <Col xs={24} sm={12} md={8} lg={6} key={module.id}>
        <Card
          className="module-card-apple"
          bordered={false}
          hoverable
        >
          <div className="module-header">
            <div className="module-scope-badge" style={{ 
              background: scopeConfig.bgColor,
              color: scopeConfig.color
            }}>
              {scopeConfig.icon}
              <span>{scopeConfig.text}</span>
            </div>
            <Dropdown overlay={moreMenu} trigger={['click']} placement="bottomRight">
              <Button 
                type="text" 
                icon={<MoreOutlined />} 
                className="more-btn"
              />
            </Dropdown>
          </div>
          
          <div className="module-body">
            <div className="module-name">
              {module.name}
              {!module.is_active && (
                <Badge status="default" text="已禁用" className="status-badge" />
              )}
            </div>
            
            <Paragraph 
              ellipsis={{ rows: 2 }} 
              className="module-description"
            >
              {module.description || '暂无描述'}
            </Paragraph>
            
            <div className="module-tags">
              {module.prompt_type === 'system' && (
                <Tag className="apple-tag apple-tag-purple">
                  <LockOutlined /> 系统级
                </Tag>
              )}
              {module.content_visible && module.module_scope !== 'personal' && (
                <Tag className="apple-tag apple-tag-green">
                  <EyeOutlined /> 可见
                </Tag>
              )}
            </div>
          </div>
          
          <div className="module-footer">
            <div className="footer-item">
              <UserOutlined className="footer-icon" />
              <span>{module.creator_name || '未知'}</span>
            </div>
            <div className="footer-item">
              <FireOutlined className="footer-icon" />
              <span>{module.usage_count || 0}</span>
            </div>
          </div>
        </Card>
      </Col>
    )
  }

  return (
    <div className="knowledge-module-list-apple">
      {/* 搜索和筛选栏 - Apple风格 */}
      <div className="list-toolbar-apple">
        <Search
          placeholder="搜索模块"
          allowClear
          onSearch={setSearchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="search-input-apple"
          prefix={<SearchOutlined />}
        />
        <Space className="filter-group">
          <Select
            value={filterScope}
            onChange={setFilterScope}
            className="filter-select-apple"
            bordered={false}
          >
            <Option value="all">所有范围</Option>
            <Option value="personal">个人模块</Option>
            <Option value="team">团队模块</Option>
            <Option value="system">系统模块</Option>
          </Select>
          <Select
            value={filterType}
            onChange={setFilterType}
            className="filter-select-apple"
            bordered={false}
          >
            <Option value="all">所有类型</Option>
            <Option value="normal">普通</Option>
            <Option value="system">系统级</Option>
          </Select>
        </Space>
      </div>
      
      {/* 模块卡片网格 */}
      {filteredModules.length > 0 ? (
        <Row gutter={[12, 12]} className="module-grid-apple">
          {filteredModules.map(renderModuleCard)}
        </Row>
      ) : (
        <Empty
          description={searchText || filterScope !== 'all' || filterType !== 'all' 
            ? "没有找到符合条件的模块" 
            : "暂无模块"}
          className="empty-apple"
        />
      )}
    </div>
  )
}

export default KnowledgeModuleList
