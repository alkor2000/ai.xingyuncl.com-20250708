/**
 * 用户分组表格组件
 */

import React from 'react'
import { Table, Tag, Space, Button, Tooltip, Popconfirm } from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  TeamOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const UserGroupTable = ({
  groups = [],
  loading = false,
  isGroupAdmin = false,
  onEdit,
  onDelete
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
      title: t('admin.groups.table.avgTokens'),
      dataIndex: 'avg_tokens_used',
      key: 'avg_tokens_used',
      render: (avg) => Math.round(avg || 0).toLocaleString()
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
      title: t('admin.groups.table.sort'),
      dataIndex: 'sort_order',
      key: 'sort_order'
    },
    {
      title: t('table.actions'),
      key: 'actions',
      render: (_, record) => {
        // 管理员不能编辑分组
        if (isGroupAdmin) {
          return null
        }
        
        return (
          <Space size="small">
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
    />
  )
}

export default UserGroupTable
