/**
 * 模块组合列表组件
 */

import React, { useState } from 'react'
import {
  Table,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Badge,
  Tooltip,
  Input,
  Card,
  Progress
} from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  PlusOutlined,
  SearchOutlined,
  AppstoreOutlined,
  FireOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  StopOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import { formatTokenCount, getTokenStatus } from '../../utils/tokenCalculator'
import './ModuleCombinationList.less'

const { Search } = Input

const ModuleCombinationList = ({ combinations, onEdit, onCreate, onRefresh }) => {
  const { deleteCombination, copyCombination } = useKnowledgeStore()
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(false)

  // 处理删除
  const handleDelete = async (combinationId) => {
    try {
      setLoading(true)
      await deleteCombination(combinationId)
      message.success('删除成功')
      onRefresh()
    } catch (error) {
      message.error(error.message || '删除失败')
    } finally {
      setLoading(false)
    }
  }

  // 处理复制
  const handleCopy = async (combination) => {
    try {
      setLoading(true)
      const newName = prompt('请输入新组合的名称:', `${combination.name} (副本)`)
      if (!newName) return
      
      await copyCombination(combination.id, newName)
      message.success('复制成功')
      onRefresh()
    } catch (error) {
      message.error(error.message || '复制失败')
    } finally {
      setLoading(false)
    }
  }

  // 过滤组合
  const filteredCombinations = combinations.filter(combination => {
    if (!searchText) return true
    return combination.name.toLowerCase().includes(searchText.toLowerCase()) ||
           combination.description?.toLowerCase().includes(searchText.toLowerCase())
  })

  // 获取token进度条配置
  const getTokenProgressProps = (tokens) => {
    const MAX_TOKENS = 100000
    const status = getTokenStatus(tokens, MAX_TOKENS)
    
    return {
      percent: status.percentage,
      strokeColor: status.color,
      format: () => formatTokenCount(tokens),
      size: 'small',
      style: { width: 100 }
    }
  }

  const columns = [
    {
      title: '组合名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          {record.description && (
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              {record.description}
            </div>
          )}
        </div>
      )
    },
    {
      title: '包含模块',
      dataIndex: 'module_count',
      key: 'module_count',
      width: 100,
      align: 'center',
      render: (count) => (
        <Space>
          <AppstoreOutlined style={{ color: '#1890ff' }} />
          <span>{count || 0}</span>
        </Space>
      )
    },
    {
      title: 'Token数',
      dataIndex: 'estimated_tokens',
      key: 'estimated_tokens',
      width: 150,
      render: (tokens) => {
        const MAX_TOKENS = 100000
        const status = getTokenStatus(tokens, MAX_TOKENS)
        
        return (
          <Tooltip title={`${tokens} tokens / ${formatTokenCount(MAX_TOKENS)} 上限`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileTextOutlined style={{ color: status.color }} />
              <Progress {...getTokenProgressProps(tokens)} />
            </div>
          </Tooltip>
        )
      }
    },
    {
      title: '使用次数',
      dataIndex: 'usage_count',
      key: 'usage_count',
      width: 100,
      align: 'center',
      render: (count) => (
        <Space>
          <FireOutlined style={{ color: '#ff4d4f' }} />
          <span>{count || 0}</span>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      align: 'center',
      render: (isActive) => (
        isActive ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>启用</Tag>
        ) : (
          <Tag color="default" icon={<StopOutlined />}>禁用</Tag>
        )
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
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
    <Card 
      className="module-combination-list"
      bordered={false}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>模块组合列表</span>
          <Space>
            <Search
              placeholder="搜索组合"
              allowClear
              onSearch={setSearchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 200 }}
              prefix={<SearchOutlined />}
            />
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={onCreate}
            >
              新建组合
            </Button>
          </Space>
        </div>
      }
    >
      <Table
        dataSource={filteredCombinations}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 个组合`
        }}
        locale={{
          emptyText: searchText ? '没有找到符合条件的组合' : '暂无组合'
        }}
      />
    </Card>
  )
}

export default ModuleCombinationList
