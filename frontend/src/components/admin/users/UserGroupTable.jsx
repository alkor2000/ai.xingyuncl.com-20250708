/**
 * 用户分组表格组件（包含积分池、组员上限、组有效期、站点配置和邀请码功能）
 */

import React from 'react'
import { Table, Tag, Space, Button, Tooltip, Popconfirm, Progress, Switch, Badge } from 'antd'
import {
  EditOutlined,
  DeleteOutlined,
  TeamOutlined,
  WalletOutlined,
  SettingOutlined,
  UsergroupAddOutlined,
  CalendarOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  LinkOutlined,
  CopyOutlined,
  EyeOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'
import { message } from 'antd'

const UserGroupTable = ({
  groups = [],
  loading = false,
  isGroupAdmin = false,
  isSuperAdmin = false,
  currentUser = null,
  onEdit,
  onDelete,
  onSetCreditsPool,
  onSetUserLimit,
  onSetExpireDate,
  onToggleSiteCustomization,
  onEditSiteConfig,
  onManageInvitationCode,
  onViewInvitationLogs
}) => {
  const { t } = useTranslation()

  // 复制邀请码到剪贴板
  const copyInvitationCode = (code) => {
    if (!code) return
    
    navigator.clipboard.writeText(code).then(() => {
      message.success('邀请码已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  }

  // 获取组有效期状态标签
  const getExpireStatusTag = (group) => {
    if (!group.expire_date) {
      return <Tag color="success" icon={<CheckCircleOutlined />}>永久有效</Tag>
    }

    const expireDate = moment(group.expire_date)
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

  // 获取邀请码状态标签
  const getInvitationCodeStatus = (group) => {
    if (!group.invitation_enabled) {
      return <Tag color="default">未启用</Tag>
    }

    // 检查是否过期
    if (group.invitation_expire_at && moment(group.invitation_expire_at).isBefore(moment())) {
      return <Tag color="error">已过期</Tag>
    }

    // 检查使用次数
    if (group.invitation_max_uses && group.invitation_usage_count >= group.invitation_max_uses) {
      return <Tag color="warning">已用完</Tag>
    }

    return <Tag color="success">可用</Tag>
  }

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
      render: (count, record) => {
        const userLimit = record.user_limit || 10
        const percentage = (count / userLimit) * 100
        const isFull = count >= userLimit
        const isNearFull = percentage >= 80
        
        return (
          <Space direction="vertical" size="small">
            <Space>
              <TeamOutlined />
              <span style={{ 
                fontWeight: 'bold',
                color: isFull ? '#ff4d4f' : (isNearFull ? '#ff7a45' : '#000')
              }}>
                {count || 0} / {userLimit}
              </span>
              {isFull && <Tag color="error">已满</Tag>}
            </Space>
            <Progress 
              percent={Math.min(100, Math.round(percentage))} 
              size="small" 
              showInfo={false}
              strokeColor={isFull ? '#ff4d4f' : (isNearFull ? '#ff7a45' : '#52c41a')}
              style={{ width: 100 }}
            />
          </Space>
        )
      }
    },
    {
      title: '邀请码',
      key: 'invitation_code',
      width: 180,
      render: (_, record) => {
        const isEnabled = record.invitation_enabled
        const code = record.invitation_code
        const usageCount = record.invitation_usage_count || 0
        const maxUses = record.invitation_max_uses
        
        return (
          <Space direction="vertical" size="small">
            {isEnabled ? (
              <>
                <Space>
                  {getInvitationCodeStatus(record)}
                  {code && (
                    <Space>
                      <Badge count={usageCount} showZero>
                        <Tag style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                          {code}
                        </Tag>
                      </Badge>
                      <Tooltip title="复制邀请码">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => copyInvitationCode(code)}
                        />
                      </Tooltip>
                    </Space>
                  )}
                </Space>
                {maxUses && (
                  <span style={{ fontSize: '11px', color: '#666' }}>
                    使用: {usageCount}/{maxUses}
                  </span>
                )}
              </>
            ) : (
              <Tag color="default">未启用</Tag>
            )}
          </Space>
        )
      }
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
      title: '组有效期',
      key: 'expire_date',
      width: 150,
      render: (_, record) => {
        const expireDate = record.expire_date
        const isExpired = expireDate && moment(expireDate).isBefore(moment())
        
        return (
          <div style={{ minWidth: 120 }}>
            <div style={{ marginBottom: 4 }}>
              {getExpireStatusTag(record)}
            </div>
            {expireDate && (
              <div style={{ 
                fontSize: '11px', 
                color: isExpired ? '#ff4d4f' : '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}>
                <CalendarOutlined />
                {moment(expireDate).format('YYYY-MM-DD')}
              </div>
            )}
          </div>
        )
      }
    },
    {
      title: '站点自定义',
      key: 'site_customization',
      width: 120,
      render: (_, record) => {
        const isEnabled = record.site_customization_enabled
        const hasConfig = record.site_name || record.site_logo
        const isUserGroup = currentUser && record.id === currentUser.group_id
        
        return (
          <Space direction="vertical" size="small">
            {isSuperAdmin ? (
              <Switch
                checked={isEnabled}
                onChange={(checked) => onToggleSiteCustomization && onToggleSiteCustomization(record, checked)}
                checkedChildren="已开启"
                unCheckedChildren="已关闭"
              />
            ) : (
              <Tag color={isEnabled ? 'success' : 'default'}>
                {isEnabled ? '已开启' : '未开启'}
              </Tag>
            )}
            {isEnabled && hasConfig && (
              <Tooltip title={`站点名称: ${record.site_name || '未设置'}`}>
                <Tag icon={<GlobalOutlined />} color="blue">已配置</Tag>
              </Tooltip>
            )}
          </Space>
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
      width: 280,
      render: (_, record) => {
        // 组管理员只能编辑自己组的站点配置
        const canEditSiteConfig = record.site_customization_enabled && 
          (isSuperAdmin || (isGroupAdmin && currentUser && record.id === currentUser.group_id))
        
        return (
          <Space size="small">
            {canEditSiteConfig && onEditSiteConfig && (
              <Tooltip title="配置站点信息">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<GlobalOutlined />} 
                  onClick={() => onEditSiteConfig(record)} 
                />
              </Tooltip>
            )}
            {isSuperAdmin && (
              <>
                {onManageInvitationCode && (
                  <Tooltip title="管理邀请码">
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<LinkOutlined />} 
                      onClick={() => onManageInvitationCode(record)} 
                    />
                  </Tooltip>
                )}
                {onViewInvitationLogs && record.invitation_enabled && (
                  <Tooltip title="查看邀请记录">
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<EyeOutlined />} 
                      onClick={() => onViewInvitationLogs(record)} 
                    />
                  </Tooltip>
                )}
                <Tooltip title="设置组员上限">
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<UsergroupAddOutlined />} 
                    onClick={() => onSetUserLimit(record)} 
                  />
                </Tooltip>
                <Tooltip title="设置积分池">
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<SettingOutlined />} 
                    onClick={() => onSetCreditsPool(record)} 
                  />
                </Tooltip>
                {onSetExpireDate && (
                  <Tooltip title="设置有效期">
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<CalendarOutlined />} 
                      onClick={() => onSetExpireDate(record)} 
                    />
                  </Tooltip>
                )}
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
