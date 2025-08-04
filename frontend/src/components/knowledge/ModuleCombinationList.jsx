/**
 * 模块组合列表组件
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
  Progress
} from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  GroupOutlined,
  SearchOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import './ModuleCombinationList.less'

const { Search } = Input

const ModuleCombinationList = ({ 
  combinations, 
  modules,
  onEdit, 
  onRefresh 
}) => {
  const { deleteCombination, copyCombination } = useKnowledgeStore()
  
  const [searchText, setSearchText] = useState('')
  const [copying, setCopying] = useState(false)

  // 处理删除
  const handleDelete = async (combinationId) => {
    try {
      await deleteCombination(combinationId)
      message.success('删除成功')
      onRefresh()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  // 处理复制
  const handleCopy = async (combination) => {
    setCopying(true)
    try {
      const newName = `${combination.name} (副本)`
      await copyCombination(combination.id, newName)
      message.success('复制成功')
      onRefresh()
    } catch (error) {
      message.error(error.message || '复制失败')
    } finally {
      setCopying(false)
    }
  }

  // 过滤组合
  const filteredCombinations = combinations.filter(combination => {
    if (searchText && !combination.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !combination.description?.toLowerCase().includes(searchText.toLowerCase())) {
      return false
    }
    return true
  })

  // 获取模块类型统计
  const getModuleTypeStats = (moduleList) => {
    if (!moduleList || moduleList.length === 0) return null
    
    const systemCount = moduleList.filter(m => m.prompt_type === 'system').length
    const normalCount = moduleList.filter(m => m.prompt_type === 'normal').length
    
    return (
      <Space size="small">
        {systemCount > 0 && (
          <Tag color="purple" icon={<ThunderboltOutlined />}>
            系统级 x{systemCount}
          </Tag>
        )}
        {normalCount > 0 && (
          <Tag>
            普通 x{normalCount}
          </Tag>
        )}
      </Space>
    )
  }

  // 计算Token使用率（假设上限为4096）
  const getTokenUsage = (estimatedTokens) => {
    const maxTokens = 4096
    const percent = Math.min((estimatedTokens / maxTokens) * 100, 100)
    const status = percent > 80 ? 'exception' : percent > 60 ? 'active' : 'success'
    
    return (
      <Tooltip title={`预估 ${estimatedTokens} tokens / ${maxTokens} tokens`}>
        <Progress 
          percent={Math.round(percent)} 
          size="small" 
          status={status}
          style={{ width: 100 }}
        />
      </Tooltip>
    )
  }

  const columns = [
    {
      title: '组合名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (text, record) => (
        <Space>
          <GroupOutlined />
          <span className="combination-name">{text}</span>
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
      title: '包含模块',
      key: 'modules',
      width: 200,
      render: (_, record) => {
        const moduleCount = record.module_count || record.modules?.length || 0
        if (moduleCount === 0) {
          return <span style={{ color: '#999' }}>无模块</span>
        }
        
        return (
          <Space direction="vertical" size="small">
            <span>{moduleCount} 个模块</span>
            {record.modules && getModuleTypeStats(record.modules)}
          </Space>
        )
      }
    },
    {
      title: 'Token估算',
      dataIndex: 'estimated_tokens',
      key: 'estimated_tokens',
      width: 150,
      render: (tokens) => getTokenUsage(tokens || 0)
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
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (time) => time ? new Date(time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }) : '-'
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
            />
          </Tooltip>
          <Tooltip title="复制">
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(record)}
              loading={copying}
            />
          </Tooltip>
          <Popconfirm
            title="确定要删除这个组合吗？"
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
        </Space>
      )
    }
  ]

  return (
    <div className="module-combination-list">
      <div className="list-toolbar">
        <Search
          placeholder="搜索组合名称或描述"
          allowClear
          onSearch={setSearchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 300 }}
          prefix={<SearchOutlined />}
        />
      </div>
      
      <Table
        columns={columns}
        dataSource={filteredCombinations}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个组合`
        }}
        scroll={{ x: 1200 }}
      />
    </div>
  )
}

export default ModuleCombinationList
