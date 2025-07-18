/**
 * 用户分组表格组件（包含积分池功能）
 */

import React from 'react'
import { Table, Tag, Space, Button, Tooltip, Popconfirm, Progress } from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  TeamOutlined,
  WalletOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const UserGroupTable = ({
  groups = [],
  loading = false,
  isGroupAdmin = false,
  isSuperAdmin = false,
  onEdit,
  onDelete,
  onSetCreditsPool
}) => {
  const { t } = useTranslation()

  const columns = [
    {
      title: t('admin.users.table.id'),
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: t('admin.groups.table.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space>
          <Tag color={record.color}>{name}</Tag>
        </Space>
      )
    },
    {
      title: t('admin.groups.table.description'),
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: t('admin.groups.table.userCount'),
      dataIndex: 'user_count',
      key: 'user_count',
      render: (count) => (
        <Space>
          <TeamOutlined />
          <span>{count || 0}</span>
        </Space>
      )
    },
    {
      title: '积分池',
      key: 'credits_pool',
      render: (_, record) => {
        const total = record.credits_pool || 0
        const used = record.credits_pool_used || 0
        const remaining = record.credits_pool_remaining || 0
        const percentage = total > 0 ? (used / total * 100) : 0
        
        return (
          <div style={{ minWidth: 200 }}>
            <div style={{ marginBottom: 4 }}>
              <Space>
                <WalletOutlined />
                <span style={{ fontWeight: 'bold' }}>
                  {remaining.toLocaleString()} / {total.toLocaleString()}
                </span>
                <span style={{ color: '#999', fontSize: '12px' }}>积分</span>
              </Space>
            </div>
            <Progress 
              percent={Math.round(percentage)} 
              size="small" 
              strokeColor={percentage > 80 ? '#ff4d4f' : '#52c41a'}
              format={() => `已用 ${used.toLocaleString()}`}
            />
          </div>
        )
      }
    },
    {
      title: t('admin.groups.table.avgCredits'),
      dataIndex: 'avg_credits_used',
      key: 'avg_credits_used',
      render: (avg) => Math.round(avg || 0).toLocaleString()
    },
    {
      title: t('admin.groups.table.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? t('status.active') : t('status.inactive')}
        </Tag>
      )
    },
    {
      title: t('table.actions'),
      key: 'actions',
      render: (_, record) => {
        return (
          <Space size="small">
            {isSuperAdmin && (
              <>
                <Tooltip title="设置积分池">
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<SettingOutlined />} 
                    onClick={() => onSetCreditsPool(record)} 
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
                    title={t('admin.groups.delete.confirm')}
                    description={t('admin.groups.delete.desc')}
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
              </>
            )}
          </Space>
        )
      }
    }
  ]

  return (
    <Table
      columns={columns}
      dataSource={groups}
      rowKey="id"
      loading={loading}
      pagination={false}
      scroll={{ x: 'max-content' }}
    />
  )
}

export default UserGroupTable
