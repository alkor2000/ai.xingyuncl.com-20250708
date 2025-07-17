/**
 * AI模型列表表格组件
 */

import React, { useState } from 'react'
import { Table, Tag, Space, Button, Switch, Tooltip, Popconfirm } from 'antd'
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
  WalletOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const AIModelTable = ({
  models = [],
  loading = false,
  testingModelId,
  onTest,
  onEdit,
  onDelete,
  onToggleStreamEnabled,
  onToggleImageUploadEnabled
}) => {
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState({})

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

  const columns = [
    {
      title: t('admin.models.table.name'),
      dataIndex: 'name',
      key: 'name',
      width: 140
    },
    {
      title: t('admin.models.table.displayName'),
      dataIndex: 'display_name',
      key: 'display_name',
      width: 160
    },
    {
      title: t('admin.models.table.credits'),
      dataIndex: 'credits_per_chat',
      key: 'credits_per_chat',
      width: 100,
      render: (credits) => (
        <Space>
          <WalletOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontWeight: 'bold', color: '#1677ff' }}>
            {credits}{t('admin.models.perChat')}
          </span>
        </Space>
      )
    },
    {
      title: t('admin.models.table.streamEnabled'),
      dataIndex: 'stream_enabled',
      key: 'stream_enabled',
      width: 120,
      render: (streamEnabled, record) => (
        <Space>
          <Switch
            checked={streamEnabled}
            size="small"
            loading={loading}
            onChange={(checked) => onToggleStreamEnabled(record.id, checked)}
            checkedChildren={<ThunderboltOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {streamEnabled ? (
            <Tag color="processing" icon={<ThunderboltOutlined />} size="small">
              {t('admin.models.stream')}
            </Tag>
          ) : (
            <Tag color="default" icon={<CloseCircleOutlined />} size="small">
              {t('admin.models.standard')}
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: t('admin.models.table.imageUploadEnabled'),
      dataIndex: 'image_upload_enabled',
      key: 'image_upload_enabled',
      width: 120,
      render: (imageUploadEnabled, record) => (
        <Space>
          <Switch
            checked={imageUploadEnabled}
            size="small"
            loading={loading}
            onChange={(checked) => onToggleImageUploadEnabled(record.id, checked)}
            checkedChildren={<PictureOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {imageUploadEnabled ? (
            <Tag color="success" icon={<FileImageOutlined />} size="small">
              {t('admin.models.image')}
            </Tag>
          ) : (
            <Tag color="default" icon={<CloseCircleOutlined />} size="small">
              {t('admin.models.textOnly')}
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: t('admin.models.table.apiKey'),
      dataIndex: 'api_key',
      key: 'api_key',
      width: 120,
      render: (apiKey, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 80 }}>
            {showApiKey[record.id] ? 
              (apiKey ? `${apiKey.substring(0, 15)}...` : t('admin.models.notConfigured')) : 
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
    },
    {
      title: t('admin.models.table.status'),
      key: 'status',
      width: 140,
      render: (_, record) => (
        <Space direction="vertical" size="small">
          <div>
            {record.is_active ? (
              <Tag color="success" size="small">{t('status.active')}</Tag>
            ) : (
              <Tag color="default" size="small">{t('status.inactive')}</Tag>
            )}
            {renderTestStatus(record.test_status, record.last_tested_at, record.id)}
          </div>
        </Space>
      )
    },
    {
      title: t('admin.models.table.actions'),
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title={t('admin.models.testConnection')}>
            <Button
              type="text"
              size="small"
              icon={<ExperimentOutlined />}
              loading={testingModelId === record.id}
              onClick={() => onTest(record.id)}
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
        </Space>
      )
    }
  ]

  return (
    <Table
      columns={columns}
      dataSource={models}
      rowKey="id"
      loading={loading}
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
    />
  )
}

export default AIModelTable
