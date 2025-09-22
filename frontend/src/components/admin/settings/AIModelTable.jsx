/**
 * AI模型列表表格组件 - 支持基于角色的权限控制、分组管理和免费模型
 */

import React, { useState } from 'react'
import { Table, Tag, Space, Button, Switch, Tooltip, Popconfirm, Modal, Checkbox, message } from 'antd'
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  ExperimentOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  PictureOutlined,
  FileImageOutlined,
  FileTextOutlined,
  WalletOutlined,
  LockOutlined,
  TeamOutlined,
  GiftOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../../stores/authStore'
import useAdminStore from '../../../stores/adminStore'
import { getFieldPermission, ROLES } from '../../../utils/permissions'

const AIModelTable = ({
  models = [],
  loading = false,
  testingModelId,
  onTest,
  onEdit,
  onDelete,
  onToggleStreamEnabled,
  onToggleImageUploadEnabled,
  onToggleDocumentUploadEnabled
}) => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { userGroups, getModelGroups, updateModelGroups } = useAdminStore()
  const [showApiKey, setShowApiKey] = useState({})
  const [groupModalVisible, setGroupModalVisible] = useState(false)
  const [selectedModel, setSelectedModel] = useState(null)
  const [selectedGroups, setSelectedGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  
  const userRole = user?.role || ROLES.USER

  // 显示分组管理弹窗
  const showGroupModal = async (model) => {
    setSelectedModel(model)
    setGroupModalVisible(true)
    setGroupsLoading(true)
    
    try {
      const groups = await getModelGroups(model.id)
      setSelectedGroups(groups.map(g => g.id))
    } catch (error) {
      message.error(t('admin.models.groups.error.load', { defaultValue: '获取模型分配组失败' }))
    } finally {
      setGroupsLoading(false)
    }
  }

  // 保存分组分配
  const handleSaveGroups = async () => {
    if (!selectedModel) return
    
    setGroupsLoading(true)
    try {
      await updateModelGroups(selectedModel.id, selectedGroups)
      message.success(t('admin.models.groups.success.update', { defaultValue: '模型分组更新成功' }))
      setGroupModalVisible(false)
    } catch (error) {
      message.error(t('admin.models.groups.error.update', { defaultValue: '更新模型分组失败' }))
    } finally {
      setGroupsLoading(false)
    }
  }

  // 渲染测试状态
  const renderTestStatus = (status, lastTestedAt, modelId) => {
    if (testingModelId === modelId) {
      return (
        <Tag icon={<ClockCircleOutlined />} color="processing">
          {t('status.loading')}
        </Tag>
      )
    }

    switch (status) {
      case 'success':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            {t('status.success')}
          </Tag>
        )
      case 'failed':
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            {t('status.failed')}
          </Tag>
        )
      default:
        return (
          <Tag icon={<QuestionCircleOutlined />} color="default">
            {t('status.error')}
          </Tag>
        )
    }
  }

  // 根据权限渲染字段
  const renderFieldWithPermission = (fieldName, value, renderFunc) => {
    const permission = getFieldPermission(userRole, fieldName)
    
    if (!permission.visible) {
      return (
        <Tooltip title={t('admin.noPermission')}>
          <LockOutlined style={{ color: '#ccc' }} />
        </Tooltip>
      )
    }
    
    return renderFunc ? renderFunc(value, permission) : value
  }

  const columns = [
    {
      title: t('admin.models.table.name'),
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (name) => renderFieldWithPermission('name', name, (value) => value)
    },
    {
      title: t('admin.models.table.displayName'),
      dataIndex: 'display_name',
      key: 'display_name',
      width: 160,
      render: (displayName) => renderFieldWithPermission('display_name', displayName)
    },
    {
      title: t('admin.models.table.credits'),
      dataIndex: 'credits_per_chat',
      key: 'credits_per_chat',
      width: 120,
      render: (credits) => renderFieldWithPermission('credits_per_chat', credits, (value) => {
        // 如果积分为0，显示免费标签
        if (value === 0) {
          return (
            <Space>
              <GiftOutlined style={{ color: '#52c41a' }} />
              <Tag color="success" icon={<GiftOutlined />}>
                免费
              </Tag>
            </Space>
          )
        }
        // 否则显示正常的积分数量
        return (
          <Space>
            <WalletOutlined style={{ color: '#1677ff' }} />
            <span style={{ fontWeight: 'bold', color: '#1677ff' }}>
              {value}{t('admin.models.perChat')}
            </span>
          </Space>
        )
      })
    },
    {
      title: t('admin.models.table.streamEnabled'),
      dataIndex: 'stream_enabled',
      key: 'stream_enabled',
      width: 120,
      render: (streamEnabled, record) => renderFieldWithPermission('stream_enabled', streamEnabled, (value, permission) => (
        <Space>
          <Switch
            checked={value}
            size="small"
            loading={loading}
            disabled={!permission.editable}
            onChange={(checked) => permission.editable && onToggleStreamEnabled(record.id, checked)}
            checkedChildren={<ThunderboltOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {value ? (
            <Tag color="processing" icon={<ThunderboltOutlined />} size="small">
              {t('admin.models.stream')}
            </Tag>
          ) : (
            <Tag color="default" icon={<CloseCircleOutlined />} size="small">
              {t('admin.models.standard')}
            </Tag>
          )}
        </Space>
      ))
    },
    {
      title: t('admin.models.table.imageUploadEnabled'),
      dataIndex: 'image_upload_enabled',
      key: 'image_upload_enabled',
      width: 120,
      render: (imageUploadEnabled, record) => renderFieldWithPermission('image_upload_enabled', imageUploadEnabled, (value, permission) => (
        <Space>
          <Switch
            checked={value}
            size="small"
            loading={loading}
            disabled={!permission.editable}
            onChange={(checked) => permission.editable && onToggleImageUploadEnabled(record.id, checked)}
            checkedChildren={<PictureOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {value ? (
            <Tag color="success" icon={<FileImageOutlined />} size="small">
              {t('admin.models.image')}
            </Tag>
          ) : (
            <Tag color="default" icon={<CloseCircleOutlined />} size="small">
              {t('admin.models.textOnly')}
            </Tag>
          )}
        </Space>
      ))
    },
    {
      title: t('admin.models.table.documentUploadEnabled'),
      dataIndex: 'document_upload_enabled',
      key: 'document_upload_enabled',
      width: 120,
      render: (documentUploadEnabled, record) => renderFieldWithPermission('document_upload_enabled', documentUploadEnabled, (value, permission) => (
        <Space>
          <Switch
            checked={value}
            size="small"
            loading={loading}
            disabled={!permission.editable}
            onChange={(checked) => permission.editable && onToggleDocumentUploadEnabled(record.id, checked)}
            checkedChildren={<FileTextOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {value ? (
            <Tag color="orange" icon={<FileTextOutlined />} size="small">
              {t('admin.models.document')}
            </Tag>
          ) : (
            <Tag color="default" icon={<CloseCircleOutlined />} size="small">
              {t('admin.models.textOnly')}
            </Tag>
          )}
        </Space>
      ))
    },
    {
      title: t('admin.models.table.apiKey'),
      dataIndex: 'api_key',
      key: 'api_key',
      width: 120,
      render: (apiKey, record) => renderFieldWithPermission('api_key', apiKey, (value, permission) => {
        if (!permission.visible) {
          return (
            <Tooltip title={t('admin.noPermission')}>
              <LockOutlined style={{ color: '#ccc' }} />
            </Tooltip>
          )
        }
        
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 80 }}>
              {showApiKey[record.id] ? 
                (value ? `${value.substring(0, 15)}...` : t('admin.models.notConfigured')) : 
                '••••••••••••••••'
              }
            </span>
            <Button
              type="text"
              size="small"
              icon={showApiKey[record.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setShowApiKey(prev => ({ ...prev, [record.id]: !prev[record.id] }))}
            />
          </div>
        )
      })
    },
    {
      title: t('admin.models.table.status'),
      key: 'status',
      width: 140,
      render: (_, record) => renderFieldWithPermission('is_active', record.is_active, (value) => (
        <Space direction="vertical" size="small">
          <div>
            {value ? (
              <Tag color="success" size="small">{t('status.active')}</Tag>
            ) : (
              <Tag color="default" size="small">{t('status.inactive')}</Tag>
            )}
            {renderTestStatus(record.test_status, record.last_tested_at, record.id)}
          </div>
        </Space>
      ))
    },
    {
      title: t('admin.models.table.actions'),
      key: 'actions',
      width: 180,
      render: (_, record) => {
        const canEdit = userRole === ROLES.SUPER_ADMIN
        const canDelete = userRole === ROLES.SUPER_ADMIN
        const canTest = userRole !== ROLES.USER
        const canManageGroups = userRole === ROLES.SUPER_ADMIN
        
        return (
          <Space size="small">
            {canManageGroups && (
              <Tooltip title={t('admin.models.groups.assign')}>
                <Button
                  type="primary"
                  size="small"
                  icon={<TeamOutlined />}
                  onClick={() => showGroupModal(record)}
                >
                  {t('admin.models.groups.assign')}
                </Button>
              </Tooltip>
            )}
            {canTest && (
              <Tooltip title={t('admin.models.testConnection')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ExperimentOutlined />}
                  loading={testingModelId === record.id}
                  onClick={() => onTest(record.id)}
                />
              </Tooltip>
            )}
            {canEdit && (
              <Tooltip title={t('button.edit')}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => onEdit(record)}
                />
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title={t('button.delete')}>
                <Popconfirm
                  title={t('admin.models.delete.confirm')}
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
            )}
            {!canEdit && !canDelete && !canTest && !canManageGroups && (
              <Tooltip title={t('admin.noPermission')}>
                <LockOutlined style={{ color: '#ccc' }} />
              </Tooltip>
            )}
          </Space>
        )
      }
    }
  ]

  return (
    <>
      <Table
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
      />
      
      {/* 分组管理弹窗 */}
      <Modal
        title={
          <Space>
            <TeamOutlined />
            {selectedModel ? 
              t('admin.models.groups.assignTitle') + ` [${selectedModel.display_name}]` : 
              t('admin.models.groups.assignTitle')}
          </Space>
        }
        open={groupModalVisible}
        onOk={handleSaveGroups}
        onCancel={() => setGroupModalVisible(false)}
        confirmLoading={groupsLoading}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: '#666' }}>
            {t('admin.models.groups.assignDesc')}
          </p>
        </div>
        
        <Checkbox.Group
          style={{ width: '100%' }}
          value={selectedGroups}
          onChange={setSelectedGroups}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {userGroups.map(group => (
              <Checkbox 
                key={group.id} 
                value={group.id}
                style={{ width: '100%' }}
              >
                <Space>
                  <Tag color={group.color || '#1677ff'}>{group.name}</Tag>
                  <span style={{ color: '#999' }}>
                    {group.user_count || 0} {t('admin.models.groups.userCount')}
                  </span>
                </Space>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        
        {selectedGroups.length === 0 && (
          <div style={{ marginTop: 16, padding: '12px', background: '#fff7e6', borderRadius: '4px' }}>
            <Space>
              <span style={{ color: '#fa8c16' }}>⚠️</span>
              <span style={{ color: '#666' }}>
                {t('admin.models.groups.noGroupWarning')}
              </span>
            </Space>
          </div>
        )}
      </Modal>
    </>
  )
}

export default AIModelTable
