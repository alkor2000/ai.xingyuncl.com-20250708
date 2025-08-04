/**
 * 知识模块列表组件
 */

import React, { useState } from 'react'
import {
  Table,
  Tag,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  message,
  Badge,
  Input,
  Select
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
  UnlockOutlined,
  SearchOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import './KnowledgeModuleList.less'

const { Search } = Input
const { Option } = Select

const KnowledgeModuleList = ({ 
  modules, 
  onEdit, 
  onRefresh,
  canCreateTeam,
  canCreateSystem 
}) => {
  const { deleteModule } = useKnowledgeStore()
  const { user } = useAuthStore()
  
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
    // 搜索过滤
    if (searchText && !module.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !module.description?.toLowerCase().includes(searchText.toLowerCase())) {
      return false
    }
    
    // 范围过滤
    if (filterScope !== 'all' && module.module_scope !== filterScope) {
      return false
    }
    
    // 类型过滤
    if (filterType !== 'all' && module.prompt_type !== filterType) {
      return false
    }
    
    return true
  })

  // 获取范围图标
  const getScopeIcon = (scope) => {
    switch (scope) {
      case 'personal':
        return <UserOutlined />
      case 'team':
        return <TeamOutlined />
      case 'system':
        return <GlobalOutlined />
      default:
        return null
    }
  }

  // 获取范围标签
  const getScopeTag = (scope) => {
    const config = {
      personal: { color: 'blue', text: '个人' },
      team: { color: 'green', text: '团队' },
      system: { color: 'gold', text: '系统' }
    }
    const { color, text } = config[scope] || {}
    return (
      <Tag color={color} icon={getScopeIcon(scope)}>
        {text}
      </Tag>
    )
  }

  // 获取类型标签
  const getTypeTag = (type) => {
    return type === 'system' ? (
      <Tag color="purple" icon={<LockOutlined />}>系统级</Tag>
    ) : (
      <Tag icon={<UnlockOutlined />}>普通</Tag>
    )
  }

  // 获取可见性标签
  const getVisibilityTag = (module) => {
    // 个人模块不显示可见性
    if (module.module_scope === 'personal') {
      return null
    }
    
    return module.content_visible ? (
      <Tag color="green" icon={<EyeOutlined />}>内容可见</Tag>
    ) : (
      <Tag color="orange" icon={<EyeInvisibleOutlined />}>内容隐藏</Tag>
    )
  }

  const columns = [
    {
      title: '模块名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (text, record) => (
        <Space>
          <span className="module-name">{text}</span>
          {!record.is_active && <Badge status="default" text="已禁用" />}
        </Space>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text) => text || <span style={{ color: '#999' }}>暂无描述</span>
    },
    {
      title: '范围',
      dataIndex: 'module_scope',
      key: 'module_scope',
      width: 100,
      render: (scope) => getScopeTag(scope)
    },
    {
      title: '类型',
      dataIndex: 'prompt_type',
      key: 'prompt_type',
      width: 100,
      render: (type) => getTypeTag(type)
    },
    {
      title: '可见性',
      key: 'visibility',
      width: 120,
      render: (_, record) => getVisibilityTag(record)
    },
    {
      title: '创建者',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 120,
      ellipsis: true,
      render: (text, record) => (
        <span style={{ color: record.creator_id === user.id ? '#1890ff' : undefined }}>
          {text || '未知'}
        </span>
      )
    },
    {
      title: '使用次数',
      dataIndex: 'usage_count',
      key: 'usage_count',
      width: 100,
      sorter: (a, b) => a.usage_count - b.usage_count,
      render: (count) => count || 0
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, record) => {
        const canEdit = record.creator_id === user.id || 
                       (record.module_scope === 'team' && canCreateTeam) ||
                       (record.module_scope === 'system' && canCreateSystem)
        const canDelete = record.creator_id === user.id || canCreateSystem
        
        return (
          <Space size="small">
            {canEdit && (
              <Tooltip title="编辑">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => onEdit(record)}
                />
              </Tooltip>
            )}
            {canDelete && (
              <Popconfirm
                title="确定要删除这个模块吗？"
                description="删除后无法恢复"
                onConfirm={() => handleDelete(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Tooltip title="删除">
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        )
      }
    }
  ]

  return (
    <div className="knowledge-module-list">
      <div className="list-toolbar">
        <Space>
          <Search
            placeholder="搜索模块名称或描述"
            allowClear
            onSearch={setSearchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 250 }}
            prefix={<SearchOutlined />}
          />
          <Select
            value={filterScope}
            onChange={setFilterScope}
            style={{ width: 120 }}
          >
            <Option value="all">所有范围</Option>
            <Option value="personal">个人模块</Option>
            <Option value="team">团队模块</Option>
            <Option value="system">系统模块</Option>
          </Select>
          <Select
            value={filterType}
            onChange={setFilterType}
            style={{ width: 120 }}
          >
            <Option value="all">所有类型</Option>
            <Option value="normal">普通</Option>
            <Option value="system">系统级</Option>
          </Select>
        </Space>
      </div>
      
      <Table
        columns={columns}
        dataSource={filteredModules}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个模块`
        }}
        scroll={{ x: 1000 }}
      />
    </div>
  )
}

export default KnowledgeModuleList
