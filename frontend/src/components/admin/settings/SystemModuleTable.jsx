/**
 * 系统模块表格组件
 */

import React from 'react'
import { Table, Tag, Space, Button, Badge, Tooltip, Popconfirm } from 'antd'
import {
  ApiOutlined,
  StopOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const SystemModuleTable = ({
  modules = [],
  loading = false,
  checkingModuleId,
  onCheckHealth,
  onToggleStatus,
  onEdit,
  onDelete
}) => {
  const { t } = useTranslation()

  // 渲染模块状态
  const renderModuleStatus = (status) => {
    switch (status) {
      case 'online':
        return <Tag color="success">{t('status.online')}</Tag>
      case 'offline':
        return <Tag color="error">{t('status.offline')}</Tag>
      case 'error':
        return <Tag color="error">{t('status.error')}</Tag>
      default:
        return <Tag color="default">{t('status.error')}</Tag>
    }
  }

  const columns = [
    {
      title: t('admin.modules.table.name'),
      dataIndex: 'display_name', 
      key: 'display_name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{record.name}</div>
        </div>
      )
    },
    {
      title: t('admin.modules.table.type'),
      dataIndex: 'module_type',
      key: 'module_type',
      render: (type) => {
        const typeMap = {
          'frontend': { color: 'blue', text: t('admin.modules.type.frontend') },
          'backend': { color: 'green', text: t('admin.modules.type.backend') },
          'fullstack': { color: 'purple', text: t('admin.modules.type.fullstack') }
        }
        const config = typeMap[type] || { color: 'default', text: type }
        return <Tag color={config.color}>{config.text}</Tag>
      }
    },
    {
      title: t('admin.modules.table.proxyPath'),
      dataIndex: 'proxy_path',
      key: 'proxy_path',
      render: (path) => (
        <span style={{ 
          fontFamily: 'monospace', 
          fontSize: 12, 
          backgroundColor: '#f5f5f5', 
          padding: '2px 6px', 
          borderRadius: 4 
        }}>
          {path}
        </span>
      )
    },
    {
      title: t('admin.modules.table.status'),
      key: 'status',
      render: (_, record) => (
        <Space>
          <Badge 
            status={record.is_active ? 'success' : 'default'} 
            text={record.is_active ? t('status.active') : t('status.inactive')} 
          />
          {renderModuleStatus(record.status)}
        </Space>
      )
    },
    {
      title: t('table.actions'),
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title={t('admin.modules.healthCheck')}>
            <Button
              type="text"
              size="small"
              icon={<ApiOutlined />}
              loading={checkingModuleId === record.id}
              onClick={() => onCheckHealth(record.id)}
            />
          </Tooltip>
          <Tooltip title={record.is_active ? t('admin.modules.disable') : t('admin.modules.enable')}>
            <Button
              type="text"
              size="small"
              icon={record.is_active ? <StopOutlined /> : <PlayCircleOutlined />}
              onClick={() => onToggleStatus(record.id, !record.is_active)}
            />
          </Tooltip>
          <Tooltip title={t('button.edit')}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t('button.delete')}>
            <Popconfirm
              title="确定删除这个模块吗？"
              onConfirm={() => onDelete(record.id)}
              okText={t('button.confirm')}
              cancelText={t('button.cancel')}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <Table
      columns={columns}
      dataSource={modules}
      rowKey="id"
      loading={loading}
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
    />
  )
}

export default SystemModuleTable
