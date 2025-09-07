/**
 * 知识模块列表组件 - Apple风格卡片设计
 */

import React, { useState, useEffect } from 'react'
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
  EyeInvisibleOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  LockOutlined,
  SearchOutlined,
  MoreOutlined,
  FireOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  TagsOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'
import apiClient from '../../utils/api'
import { formatTokenCount } from '../../utils/tokenCalculator'
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
  const [tagInfoCache, setTagInfoCache] = useState({}) // 缓存标签信息

  // 加载标签信息
  useEffect(() => {
    loadTagInfo()
  }, [modules])

  // 批量加载标签信息
  const loadTagInfo = async () => {
    try {
      // 收集所有需要的标签ID
      const tagIds = new Set()
      modules.forEach(module => {
        if (module.allowed_tag_ids && module.allowed_tag_ids.length > 0) {
          module.allowed_tag_ids.forEach(id => tagIds.add(id))
        }
      })

      if (tagIds.size === 0) return

      // 批量获取标签信息
      const response = await apiClient.post('/admin/user-tags/batch-info', {
        tag_ids: Array.from(tagIds)
      })

      const tagMap = {}
      response.data.data.forEach(tag => {
        tagMap[tag.id] = tag
      })
      setTagInfoCache(tagMap)
    } catch (error) {
      console.error('加载标签信息失败:', error)
    }
  }

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

  // 获取token显示颜色
  const getTokenColor = (tokenCount) => {
    if (!tokenCount || tokenCount === 0) return '#999'
    if (tokenCount < 1000) return '#52c41a'  // 绿色 - 小于1K
    if (tokenCount < 10000) return '#1890ff'  // 蓝色 - 1K-10K
    if (tokenCount < 50000) return '#faad14'  // 橙色 - 10K-50K
    return '#f5222d'  // 红色 - 大于50K
  }

  // 渲染模块卡片 - Apple风格
  const renderModuleCard = (module) => {
    const scopeConfig = getScopeConfig(module.module_scope)
    const canEdit = module.creator_id === user.id || 
                   (module.module_scope === 'team' && canCreateTeam) ||
                   (module.module_scope === 'system' && canCreateSystem)
    const canDelete = module.creator_id === user.id || canCreateSystem
    
    // 检查是否有标签限制
    const hasTagRestriction = module.module_scope === 'team' && 
                             module.allowed_tag_ids && 
                             module.allowed_tag_ids.length > 0
    
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
              {/* 隐藏内容标识 */}
              {module.content_hidden && (
                <Tag className="apple-tag apple-tag-orange">
                  <EyeInvisibleOutlined /> 内容隐藏
                </Tag>
              )}
              {/* 标签限制标识 */}
              {hasTagRestriction && (
                <Tooltip 
                  title={
                    <div>
                      <div style={{ marginBottom: 4 }}>访问限制：</div>
                      {module.allowed_tag_ids.map(tagId => {
                        const tag = tagInfoCache[tagId]
                        return tag ? (
                          <Tag 
                            key={tagId} 
                            color={tag.color}
                            style={{ margin: '2px' }}
                          >
                            {tag.name}
                          </Tag>
                        ) : null
                      })}
                    </div>
                  }
                >
                  <Tag className="apple-tag apple-tag-orange">
                    <SafetyCertificateOutlined /> 限制访问
                  </Tag>
                </Tooltip>
              )}
            </div>
          </div>
          
          <div className="module-footer">
            <Tooltip title="创建者">
              <div className="footer-item">
                <UserOutlined className="footer-icon" />
                <span>{module.creator_name || '未知'}</span>
              </div>
            </Tooltip>
            <Tooltip title="使用次数">
              <div className="footer-item">
                <FireOutlined className="footer-icon" />
                <span>{module.usage_count || 0}</span>
              </div>
            </Tooltip>
            <Tooltip title={`Token数量: ${module.token_count || 0}`}>
              <div className="footer-item">
                <FileTextOutlined 
                  className="footer-icon" 
                  style={{ color: getTokenColor(module.token_count) }}
                />
                <span style={{ 
                  color: getTokenColor(module.token_count),
                  fontWeight: module.token_count > 10000 ? 'bold' : 'normal'
                }}>
                  {formatTokenCount(module.token_count || 0)}
                </span>
              </div>
            </Tooltip>
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
