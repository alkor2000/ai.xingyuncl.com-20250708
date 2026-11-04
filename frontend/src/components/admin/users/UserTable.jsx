/**
 * 用户列表表格组件（包含组积分分配功能、账号有效期、标签管理和删除功能）
 * 
 * 修复记录：
 * - 添加删除按钮，支持软删除
 * - 删除前二次确认，显示详细信息
 */

import React from 'react'
import { Table, Tag, Space, Button, Tooltip, Popconfirm, Progress } from 'antd'
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  CalendarOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  RobotOutlined,
  GiftOutlined,
  LogoutOutlined,
  UserOutlined,
  TagsOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'

const UserTable = ({
  users = [],
  loading = false,
  pagination = {},
  currentUser = {},
  isGroupAdmin = false,
  onPageChange,
  onViewDetail,
  onEdit,
  onToggleStatus,
  onDelete,
  onManageModels,
  onDistributeCredits,
  onRemoveFromGroup,
  onManageTags
}) => {
  const { t } = useTranslation()
  
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const roleColors = {
    super_admin: 'red',
    admin: 'blue',
    user: 'green'
  }

  const statusColors = {
    active: 'green',
    inactive: 'red'
  }

  // 获取积分状态标签
  const getCreditsStatusTag = (user) => {
    const stats = user.credits_stats || {}
    
    if (stats.isExpired) {
      return <Tag color="error" icon={<ExclamationCircleOutlined />}>已过期</Tag>
    }
    
    if (stats.remainingDays !== null && stats.remainingDays <= 7) {
      return <Tag color="warning" icon={<ClockCircleOutlined />}>{stats.remainingDays}天后过期</Tag>
    }
    
    if (stats.remaining > 0) {
      return <Tag color="success" icon={<CheckCircleOutlined />}>正常</Tag>
    }
    
    return <Tag color="default">无积分</Tag>
  }

  // 获取账号状态标签
  const getAccountStatusTag = (user) => {
    if (user.role === 'super_admin') {
      return <Tag color="blue" icon={<UserOutlined />}>永久有效</Tag>
    }

    if (!user.expire_at) {
      return <Tag color="success" icon={<CheckCircleOutlined />}>永久有效</Tag>
    }

    const expireDate = moment(user.expire_at)
    const now = moment()
    const isExpired = expireDate.isBefore(now)
    const remainingDays = expireDate.diff(now, 'days')

    if (isExpired) {
      return <Tag color="error" icon={<ExclamationCircleOutlined />}>已过期</Tag>
    }

    if (remainingDays <= 7) {
      return <Tag color="warning" icon={<ClockCircleOutlined />}>{remainingDays}天后过期</Tag>
    }

    if (remainingDays <= 30) {
      return <Tag color="orange" icon={<ClockCircleOutlined />}>{remainingDays}天后过期</Tag>
    }

    return <Tag color="success" icon={<CheckCircleOutlined />}>正常</Tag>
  }

  const columns = [
    {
      title: t('admin.users.table.id'),
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: t('admin.users.table.username'),
      dataIndex: 'username',
      key: 'username',
      render: (username, record) => record.display_name || username
    },
    {
      title: t('admin.users.table.email'),
      dataIndex: 'email', 
      key: 'email'
    },
    {
      title: t('admin.users.table.role'),
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <Tag color={roleColors[role]}>{t(`role.${role}`)}</Tag>
      )
    },
    {
      title: t('admin.users.table.group'),
      dataIndex: 'group_name',
      key: 'group_name',
      render: (groupName, record) => (
        groupName ? (
          <Tag color={record.group_color || '#1677ff'}>{groupName}</Tag>
        ) : (
          <span style={{ color: '#999' }}>{t('admin.users.noGroup')}</span>
        )
      )
    },
    {
      title: '标签',
      key: 'tags',
      width: 200,
      render: (_, record) => {
        const tags = record.tags || []
        const tagCount = record.tag_count || 0
        
        if (tagCount === 0) {
          return <span style={{ color: '#999', fontSize: 12 }}>无标签</span>
        }
        
        const displayTags = tags.slice(0, 3)
        const remainingCount = tagCount - displayTags.length
        
        return (
          <Space size={4} wrap>
            {displayTags.map(tag => (
              <Tag
                key={tag.id}
                color={tag.color || '#1677ff'}
                style={{ margin: 0, fontSize: 11 }}
              >
                {tag.name}
              </Tag>
            ))}
            {remainingCount > 0 && (
              <Tag style={{ margin: 0, fontSize: 11 }}>
                +{remainingCount}
              </Tag>
            )}
          </Space>
        )
      }
    },
    {
      title: t('admin.users.table.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={statusColors[status]}>
          {t(`status.${status}`)}
        </Tag>
      )
    },
    {
      title: '账号有效期',
      key: 'account_expire',
      width: 150,
      render: (_, record) => {
        const expireAt = record.expire_at
        const isExpired = expireAt && moment(expireAt).isBefore(moment())
        
        return (
          <div style={{ minWidth: 120 }}>
            <div style={{ marginBottom: 4 }}>
              {getAccountStatusTag(record)}
            </div>
            {expireAt && (
              <div style={{ 
                fontSize: '11px', 
                color: isExpired ? '#ff4d4f' : '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}>
                <CalendarOutlined />
                {moment(expireAt).format('YYYY-MM-DD')}
              </div>
            )}
          </div>
        )
      }
    },
    {
      title: t('admin.users.table.credits'),
      key: 'credits',
      render: (_, record) => {
        const stats = record.credits_stats || {}
        const remaining = stats.remaining || 0
        const usageRate = record.credits_quota > 0 ? (record.used_credits / record.credits_quota * 100) : 0
        
        return (
          <div style={{ minWidth: 150 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ 
                fontSize: '16px', 
                fontWeight: 'bold', 
                color: stats.isExpired ? '#ff4d4f' : (remaining > 0 ? '#52c41a' : '#ff4d4f') 
              }}>
                {remaining.toLocaleString()}
              </div>
              {getCreditsStatusTag(record)}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {record.used_credits?.toLocaleString()} / {record.credits_quota?.toLocaleString()}
            </div>
            <Progress 
              percent={Math.round(usageRate)} 
              size="small" 
              strokeColor={stats.isExpired ? '#ff4d4f' : (usageRate > 80 ? '#ff4d4f' : '#52c41a')}
              showInfo={false}
            />
            {record.credits_expire_at && (
              <div style={{ fontSize: '11px', color: stats.isExpired ? '#ff4d4f' : '#999', marginTop: 2 }}>
                <CalendarOutlined /> {moment(record.credits_expire_at).format('YYYY-MM-DD')}
              </div>
            )}
          </div>
        )
      }
    },
    {
      title: t('admin.users.table.remark'),
      dataIndex: 'remark',
      key: 'remark',
      width: 150,
      render: (remark) => {
        if (!remark) return null
        return (
          <Tooltip title={remark}>
            <div style={{ 
              maxWidth: 150, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#666',
              fontSize: '12px'
            }}>
              <FileTextOutlined style={{ marginRight: 4 }} />
              {remark}
            </div>
          </Tooltip>
        )
      }
    },
    {
      title: t('admin.users.table.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time) => moment(time).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('admin.users.table.actions'),
      key: 'actions',
      fixed: 'right',
      width: 360,
      render: (_, record) => {
        // 是否可以管理此用户的模型权限
        const canManageUserModels = record.role === 'user' && (
          isSuperAdmin || (isGroupAdmin && record.group_id === currentUser.group_id)
        )
        
        // 是否可以管理标签
        const canManageUserTags = (
          isSuperAdmin || (isGroupAdmin && record.group_id === currentUser.group_id)
        )
        
        // 是否可以分配积分
        const canDistribute = onDistributeCredits && (
          (isGroupAdmin && record.group_id === currentUser.group_id) || isSuperAdmin
        )
        
        // 是否可以挪出用户
        const canRemoveUser = onRemoveFromGroup && (
          record.id !== currentUser.id &&
          record.group_id !== 1 &&
          !(record.role === 'super_admin' && currentUser.role === 'super_admin') &&
          (isSuperAdmin || (isGroupAdmin && record.group_id === currentUser.group_id))
        )
        
        // 🔧 新增：是否可以删除用户
        const canDeleteUser = onDelete && (
          // 不能删除自己
          record.id !== currentUser.id &&
          (
            // 超级管理员可以删除任何用户（除自己）
            isSuperAdmin ||
            // 组管理员只能删除本组的普通用户
            (isGroupAdmin && 
             record.group_id === currentUser.group_id && 
             record.role === 'user')
          )
        )
        
        // 计算用户剩余积分
        const remainingCredits = Math.max(0, (record.credits_quota || 0) - (record.used_credits || 0))
        
        return (
          <Space size="small">
            <Tooltip title={t('admin.users.viewDetail')}>
              <Button 
                type="text" 
                size="small" 
                icon={<EyeOutlined />} 
                onClick={() => onViewDetail(record.id)} 
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
            
            {canManageUserTags && onManageTags && (
              <Tooltip title="管理标签">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<TagsOutlined />} 
                  onClick={() => onManageTags(record)} 
                  style={{ color: '#fa8c16' }}
                />
              </Tooltip>
            )}
            
            {canManageUserModels && (
              <Tooltip title="管理模型权限">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<RobotOutlined />} 
                  onClick={() => onManageModels(record)} 
                />
              </Tooltip>
            )}
            
            {canDistribute && (
              <Tooltip title="分配积分">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<GiftOutlined />} 
                  onClick={() => onDistributeCredits(record)} 
                  style={{ color: '#52c41a' }}
                />
              </Tooltip>
            )}
            
            {record.id !== currentUser?.id && (
              <Tooltip title={record.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}>
                <Popconfirm
                  title={record.status === 'active' ? t('admin.users.disable.confirm') : t('admin.users.enable.confirm')}
                  onConfirm={() => onToggleStatus(record.id, record.status)}
                  okText={t('button.confirm')}
                  cancelText={t('button.cancel')}
                >
                  <Button 
                    type="text" 
                    size="small" 
                    danger={record.status === 'active'}
                    icon={record.status === 'active' ? <MinusCircleOutlined /> : <PlusCircleOutlined />} 
                  />
                </Popconfirm>
              </Tooltip>
            )}
            
            {canRemoveUser && (
              <Tooltip title="挪出组">
                <Popconfirm
                  title="确认挪出"
                  description={
                    <div>
                      <p>挪出用户将：</p>
                      <ul style={{ marginLeft: 20, marginBottom: 0 }}>
                        <li>将用户移至默认组</li>
                        <li>清零用户所有积分</li>
                        {record.role !== 'super_admin' && <li>清除账号有效期限制</li>}
                        {remainingCredits > 0 && (
                          <li style={{ color: '#fa8c16' }}>
                            返还 <strong>{remainingCredits}</strong> 积分到组积分池
                          </li>
                        )}
                      </ul>
                      <p style={{ marginTop: 10, marginBottom: 0 }}>确定要挪出该用户吗？</p>
                    </div>
                  }
                  onConfirm={() => onRemoveFromGroup(record)}
                  okText="确定挪出"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button 
                    type="text" 
                    size="small" 
                    danger
                    icon={<LogoutOutlined />} 
                  />
                </Popconfirm>
              </Tooltip>
            )}
            
            {/* 🔧 新增：删除按钮 */}
            {canDeleteUser && (
              <Tooltip title="删除用户">
                <Popconfirm
                  title="确认删除用户？"
                  description={
                    <div>
                      <p style={{ marginBottom: 8 }}>
                        即将删除用户 <strong>{record.username}</strong>
                      </p>
                      <p style={{ marginBottom: 4, color: '#666' }}>删除后：</p>
                      <ul style={{ marginLeft: 20, marginBottom: 0, color: '#666' }}>
                        <li>用户将无法登录</li>
                        <li>所有关联数据（对话、文件等）将保留</li>
                        <li>此操作不可恢复</li>
                      </ul>
                    </div>
                  }
                  onConfirm={() => onDelete(record.id)}
                  okText="确认删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button 
                    type="text" 
                    size="small" 
                    danger
                    icon={<DeleteOutlined />} 
                  />
                </Popconfirm>
              </Tooltip>
            )}
          </Space>
        )
      }
    }
  ]

  return (
    <Table
      columns={columns}
      dataSource={users}
      rowKey="id"
      loading={loading}
      pagination={{
        current: pagination.current,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true,
        showQuickJumper: true,
        showTotal: (total) => t('table.total', { total }),
        onChange: onPageChange
      }}
      scroll={{ x: 'max-content' }}
    />
  )
}

export default UserTable
