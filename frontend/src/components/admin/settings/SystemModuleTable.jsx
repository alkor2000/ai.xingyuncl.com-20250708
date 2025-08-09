/**
 * 系统模块表格组件 - 支持系统内置模块和外部模块
 */

import React from 'react'
import { Table, Tag, Space, Button, Badge, Tooltip, Popconfirm, message } from 'antd'
import {
  ApiOutlined,
  StopOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  LockOutlined,
  GlobalOutlined,
  AppstoreOutlined
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
        return <Tag color="default">{t('status.unknown') || '未知'}</Tag>
    }
  }

  // 渲染模块类别
  const renderModuleCategory = (category, canDisable) => {
    if (category === 'system') {
      if (!canDisable) {
        // 核心系统模块（不可禁用）
        return (
          <Tooltip title="核心系统模块，不可禁用">
            <Tag icon={<LockOutlined />} color="red">
              核心模块
            </Tag>
          </Tooltip>
        )
      }
      // 普通系统模块
      return (
        <Tag icon={<AppstoreOutlined />} color="blue">
          系统模块
        </Tag>
      )
    }
    // 外部模块
    return (
      <Tag icon={<GlobalOutlined />} color="green">
        扩展模块
      </Tag>
    )
  }

  const columns = [
    {
      title: t('admin.modules.table.name'),
      dataIndex: 'display_name', 
      key: 'display_name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {text}
            {record.module_category === 'system' && record.route_path && (
              <span style={{ 
                marginLeft: 8, 
                fontSize: 12, 
                color: '#1890ff',
                fontFamily: 'monospace' 
              }}>
                {record.route_path}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#999' }}>
            ID: {record.name}
            {record.module_url && record.module_category === 'external' && (
              <span style={{ marginLeft: 8 }}>
                URL: {record.module_url}
              </span>
            )}
          </div>
        </div>
      )
    },
    {
      title: '模块类别',
      key: 'category',
      width: 120,
      render: (_, record) => renderModuleCategory(record.module_category, record.can_disable)
    },
    {
      title: t('admin.modules.table.type'),
      dataIndex: 'module_type',
      key: 'module_type',
      width: 100,
      render: (type) => {
        const typeMap = {
          'frontend': { color: 'blue', text: t('admin.modules.type.frontend') || '前端' },
          'backend': { color: 'green', text: t('admin.modules.type.backend') || '后端' },
          'fullstack': { color: 'purple', text: t('admin.modules.type.fullstack') || '全栈' }
        }
        const config = typeMap[type] || { color: 'default', text: type }
        return <Tag color={config.color}>{config.text}</Tag>
      }
    },
    {
      title: '打开方式',
      dataIndex: 'open_mode',
      key: 'open_mode',
      width: 100,
      render: (mode) => {
        if (mode === 'iframe') {
          return <Tag>内嵌</Tag>
        }
        return <Tag color="blue">新标签</Tag>
      }
    },
    {
      title: t('admin.modules.table.status'),
      key: 'status',
      width: 150,
      render: (_, record) => (
        <Space>
          <Badge 
            status={record.is_active ? 'success' : 'default'} 
            text={record.is_active ? t('status.active') : t('status.inactive')} 
          />
          {record.module_category === 'external' && renderModuleStatus(record.status)}
        </Space>
      )
    },
    {
      title: '访问权限',
      key: 'access',
      width: 200,
      render: (_, record) => {
        if (!record.allowed_groups || record.allowed_groups.length === 0) {
          return <Tag color="green">所有用户</Tag>
        }
        return (
          <Tooltip title={`限制 ${record.allowed_groups.length} 个用户组访问`}>
            <Tag color="orange">
              {record.allowed_groups.length} 个用户组
            </Tag>
          </Tooltip>
        )
      }
    },
    {
      title: t('table.actions'),
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, record) => {
        // 核心管理模块的特殊处理
        const isCoreModule = record.module_category === 'system' && !record.can_disable
        const isSystemModule = record.module_category === 'system'
        const canToggle = record.can_disable !== false
        const canDelete = record.module_category === 'external'
        
        return (
          <Space size="small">
            {/* 健康检查 - 只对外部模块显示 */}
            {record.module_category === 'external' && (
              <Tooltip title={t('admin.modules.healthCheck')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ApiOutlined />}
                  loading={checkingModuleId === record.id}
                  onClick={() => onCheckHealth(record.id)}
                />
              </Tooltip>
            )}
            
            {/* 启用/禁用按钮 */}
            {canToggle ? (
              <Tooltip title={record.is_active ? t('admin.modules.disable') : t('admin.modules.enable')}>
                <Button
                  type="text"
                  size="small"
                  icon={record.is_active ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={() => onToggleStatus(record.id, !record.is_active)}
                />
              </Tooltip>
            ) : (
              <Tooltip title="核心模块不可禁用">
                <Button
                  type="text"
                  size="small"
                  icon={<LockOutlined />}
                  disabled
                />
              </Tooltip>
            )}
            
            {/* 编辑按钮 */}
            <Tooltip title={
              isSystemModule 
                ? (isCoreModule ? '编辑（仅可修改显示名称）' : '编辑（部分字段）')
                : t('button.edit')
            }>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => onEdit(record)}
              />
            </Tooltip>
            
            {/* 删除按钮 - 只对外部模块显示 */}
            {canDelete ? (
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
            ) : (
              <Tooltip title="系统模块不可删除">
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled
                />
              </Tooltip>
            )}
          </Space>
        )
      }
    }
  ]

  // 按类别和排序分组显示
  const sortedModules = [...modules].sort((a, b) => {
    // 先按类别排序：系统模块在前
    if (a.module_category !== b.module_category) {
      return a.module_category === 'system' ? -1 : 1
    }
    // 同类别内按sort_order排序
    return (a.sort_order || 0) - (b.sort_order || 0)
  })

  return (
    <Table
      columns={columns}
      dataSource={sortedModules}
      rowKey="id"
      loading={loading}
      pagination={{
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 个模块`,
        defaultPageSize: 20
      }}
      size="small"
      scroll={{ x: 1200 }}
      rowClassName={(record) => {
        if (record.module_category === 'system' && !record.can_disable) {
          return 'core-module-row'
        }
        if (record.module_category === 'system') {
          return 'system-module-row'
        }
        return 'external-module-row'
      }}
    />
  )
}

export default SystemModuleTable
