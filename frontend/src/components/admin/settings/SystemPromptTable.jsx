/**
 * 系统提示词表格组件
 */

import React, { useState } from 'react'
import { Table, Button, Space, Tag, Switch, Modal, Tooltip, message } from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'

const { confirm } = Modal

const SystemPromptTable = ({ onEdit, disabled = false }) => {
  const { t } = useTranslation()
  const { 
    systemPrompts, 
    systemPromptsEnabled,
    loading, 
    deleteSystemPrompt, 
    toggleSystemPromptsFeature,
    updateSystemPrompt 
  } = useAdminStore()

  const [switchLoading, setSwitchLoading] = useState(false)

  // 处理功能开关切换
  const handleToggleFeature = async (checked) => {
    setSwitchLoading(true)
    const result = await toggleSystemPromptsFeature(checked)
    if (result.success) {
      message.success(checked ? '系统提示词功能已启用' : '系统提示词功能已禁用')
    } else {
      message.error(result.error || '操作失败')
    }
    setSwitchLoading(false)
  }

  // 处理启用/禁用单个提示词
  const handleToggleStatus = async (record) => {
    const newStatus = !record.is_active
    const result = await updateSystemPrompt(record.id, { is_active: newStatus })
    if (result.success) {
      message.success(newStatus ? '提示词已启用' : '提示词已禁用')
    } else {
      message.error(result.error || '操作失败')
    }
  }

  // 处理删除
  const handleDelete = (record) => {
    confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除系统提示词"${record.name}"吗？删除后使用该提示词的对话不受影响。`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await deleteSystemPrompt(record.id)
        if (result.success) {
          message.success('删除成功')
        } else {
          message.error(result.error || '删除失败')
        }
      }
    })
  }

  // 复制提示词内容
  const handleCopyPrompt = (content) => {
    navigator.clipboard.writeText(content).then(() => {
      message.success('已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败')
    })
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '提示词预览',
      dataIndex: 'content',
      key: 'content',
      width: 300,
      ellipsis: true,
      render: (content) => (
        <Space>
          <span style={{ 
            maxWidth: 250, 
            display: 'inline-block', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap' 
          }}>
            {content}
          </span>
          <Tooltip title="复制提示词">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyPrompt(content)}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '分组',
      dataIndex: 'group_ids',
      key: 'groups',
      width: 150,
      render: (groupIds) => {
        if (!groupIds || groupIds.length === 0) {
          return <Tag color="green">所有用户</Tag>
        }
        return (
          <Space size={0} wrap>
            {groupIds.map(id => (
              <Tag key={id} color="blue">组{id}</Tag>
            ))}
          </Space>
        )
      }
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      align: 'center',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      align: 'center',
      render: (isActive, record) => (
        <Switch
          checked={isActive}
          disabled={disabled || !systemPromptsEnabled}
          onChange={() => handleToggleStatus(record)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
            disabled={disabled}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
            disabled={disabled}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 功能开关和新增按钮 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <span>功能开关：</span>
          <Switch
            checked={systemPromptsEnabled}
            onChange={handleToggleFeature}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            loading={switchLoading}
            disabled={disabled}
          />
          <Tooltip title="启用后，用户可以在创建对话时选择预设的系统提示词">
            <QuestionCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </Space>
        
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => onEdit(null)}
          disabled={disabled || !systemPromptsEnabled}
        >
          新增提示词
        </Button>
      </div>

      {/* 表格 */}
      <Table
        columns={columns}
        dataSource={systemPrompts}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* 提示信息 */}
      {!systemPromptsEnabled && (
        <div style={{ marginTop: 16, color: '#999', fontSize: '13px' }}>
          <ExclamationCircleOutlined /> 系统提示词功能已禁用，启用后用户才能使用预设的提示词
        </div>
      )}
    </div>
  )
}

export default SystemPromptTable
