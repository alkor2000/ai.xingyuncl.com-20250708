/**
 * API服务表格组件
 */

import React, { useState } from 'react'
import { 
  Table, 
  Tag, 
  Space, 
  Button, 
  Badge, 
  Tooltip, 
  Popconfirm,
  message,
  Modal,
  Descriptions,
  Typography,
  Alert
} from 'antd'
import {
  ApiOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  SettingOutlined,
  CopyOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import APIServiceFormModal from './APIServiceFormModal'
import APIServiceActionModal from './APIServiceActionModal'

const { Text, Paragraph } = Typography

const APIServiceTable = ({
  services = [],
  loading = false,
  onRefresh,
  onDelete,
  adminStore
}) => {
  const { t } = useTranslation()
  const [formModalVisible, setFormModalVisible] = useState(false)
  const [actionModalVisible, setActionModalVisible] = useState(false)
  const [editingService, setEditingService] = useState(null)
  const [selectedService, setSelectedService] = useState(null)
  const [apiKeyVisible, setApiKeyVisible] = useState({})
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [detailService, setDetailService] = useState(null)

  // 处理编辑
  const handleEdit = (service) => {
    setEditingService(service)
    setFormModalVisible(true)
  }

  // 处理添加
  const handleAdd = () => {
    setEditingService(null)
    setFormModalVisible(true)
  }

  // 处理配置操作
  const handleConfigActions = (service) => {
    setSelectedService(service)
    setActionModalVisible(true)
  }

  // 处理重置密钥
  const handleResetApiKey = async (service) => {
    try {
      await adminStore.resetApiServiceKey(service.service_id)
      message.success('API密钥重置成功')
      onRefresh && onRefresh()
    } catch (error) {
      message.error(error.message || '重置API密钥失败')
    }
  }

  // 复制API密钥
  const handleCopyApiKey = (apiKey) => {
    navigator.clipboard.writeText(apiKey).then(() => {
      message.success('API密钥已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  }

  // 切换API密钥可见性
  const toggleApiKeyVisibility = (serviceId) => {
    setApiKeyVisible(prev => ({
      ...prev,
      [serviceId]: !prev[serviceId]
    }))
  }

  // 查看详情
  const handleViewDetail = async (service) => {
    try {
      const detail = await adminStore.getApiService(service.service_id)
      setDetailService(detail)
      setDetailModalVisible(true)
    } catch (error) {
      message.error('获取服务详情失败')
    }
  }

  const columns = [
    {
      title: '服务信息',
      key: 'info',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.service_name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>
            ID: {record.service_id}
          </div>
          {record.description && (
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {record.description}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'API密钥',
      dataIndex: 'api_key',
      key: 'api_key',
      width: 300,
      render: (apiKey, record) => (
        <Space>
          <Text 
            code 
            style={{ fontSize: 12 }}
            copyable={false}
          >
            {apiKeyVisible[record.service_id] 
              ? apiKey 
              : apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4)}
          </Text>
          <Tooltip title={apiKeyVisible[record.service_id] ? '隐藏' : '显示'}>
            <Button
              type="text"
              size="small"
              icon={apiKeyVisible[record.service_id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => toggleApiKeyVisibility(record.service_id)}
            />
          </Tooltip>
          <Tooltip title="复制">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyApiKey(apiKey)}
            />
          </Tooltip>
        </Space>
      )
    },
    {
      title: '操作配置',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <div>
          <div>
            <Badge 
              count={record.action_count || 0} 
              showZero 
              style={{ backgroundColor: '#52c41a' }}
            />
            <span style={{ marginLeft: 8, fontSize: 12 }}>个操作</span>
          </div>
          {record.active_action_count !== undefined && (
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              {record.active_action_count} 个启用
            </div>
          )}
        </div>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'active' ? 'success' : 'default'}>
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (time) => new Date(time).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleViewDetail(record)}
            />
          </Tooltip>
          <Tooltip title="配置操作">
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              onClick={() => handleConfigActions(record)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="重置API密钥"
            description="确定要重置API密钥吗？原密钥将立即失效。"
            onConfirm={() => handleResetApiKey(record)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="重置密钥">
              <Button
                type="text"
                size="small"
                icon={<KeyOutlined />}
                danger
              />
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="删除确认"
            description="确定要删除这个API服务吗？所有相关配置将被清除。"
            onConfirm={() => onDelete(record.service_id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                danger
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button
            type="primary"
            icon={<ApiOutlined />}
            onClick={handleAdd}
          >
            添加API服务
          </Button>
          <Button
            icon={<BarChartOutlined />}
            onClick={() => message.info('统计功能开发中')}
          >
            使用统计
          </Button>
        </Space>
      </div>

      <Alert
        message="API服务说明"
        description={
          <div>
            <div>• 每个服务需要使用唯一的服务ID和API密钥进行认证</div>
            <div>• 配置操作类型和对应的积分消耗，系统会自动扣费</div>
            <div>• 使用 POST /api/services/deduct-credits 接口进行积分扣费</div>
            <div>• 请妥善保管API密钥，如有泄露请立即重置</div>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Table
        columns={columns}
        dataSource={services}
        rowKey="service_id"
        loading={loading}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个服务`
        }}
        scroll={{ x: 1200 }}
      />

      {/* 服务表单模态框 */}
      <APIServiceFormModal
        visible={formModalVisible}
        editingService={editingService}
        onCancel={() => {
          setFormModalVisible(false)
          setEditingService(null)
        }}
        onSuccess={() => {
          setFormModalVisible(false)
          setEditingService(null)
          onRefresh && onRefresh()
        }}
        adminStore={adminStore}
      />

      {/* 操作配置模态框 */}
      <APIServiceActionModal
        visible={actionModalVisible}
        service={selectedService}
        onCancel={() => {
          setActionModalVisible(false)
          setSelectedService(null)
        }}
        onSuccess={() => {
          onRefresh && onRefresh()
        }}
        adminStore={adminStore}
      />

      {/* 详情模态框 */}
      <Modal
        title="API服务详情"
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false)
          setDetailService(null)
        }}
        footer={null}
        width={800}
      >
        {detailService && (
          <div>
            <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="服务ID" span={1}>
                {detailService.service_id}
              </Descriptions.Item>
              <Descriptions.Item label="服务名称" span={1}>
                {detailService.service_name}
              </Descriptions.Item>
              <Descriptions.Item label="API密钥" span={2}>
                <Paragraph copyable={{ text: detailService.api_key }}>
                  {detailService.api_key}
                </Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="状态" span={1}>
                <Tag color={detailService.status === 'active' ? 'success' : 'default'}>
                  {detailService.status === 'active' ? '启用' : '禁用'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间" span={1}>
                {new Date(detailService.created_at).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {detailService.description || '-'}
              </Descriptions.Item>
            </Descriptions>

            <h4>操作配置</h4>
            {detailService.actions && detailService.actions.length > 0 ? (
              <Table
                dataSource={detailService.actions}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  {
                    title: '操作类型',
                    dataIndex: 'action_type',
                    key: 'action_type'
                  },
                  {
                    title: '操作名称',
                    dataIndex: 'action_name',
                    key: 'action_name'
                  },
                  {
                    title: '消耗积分',
                    dataIndex: 'credits',
                    key: 'credits',
                    render: (credits) => <Tag color="blue">{credits} 积分</Tag>
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    key: 'status',
                    render: (status) => (
                      <Tag color={status === 'active' ? 'success' : 'default'}>
                        {status === 'active' ? '启用' : '禁用'}
                      </Tag>
                    )
                  }
                ]}
              />
            ) : (
              <Alert message="暂无操作配置" type="warning" />
            )}

            <h4 style={{ marginTop: 16 }}>接口调用示例</h4>
            <Paragraph>
              <pre style={{ backgroundColor: '#f5f5f5', padding: 12, borderRadius: 4 }}>
{`POST /api/services/deduct-credits
Headers:
  X-Service-ID: ${detailService.service_id}
  X-API-Key: ${detailService.api_key}
  Content-Type: application/json

Body:
{
  "user_id": 123,
  "action_type": "generate_image",
  "request_id": "unique-request-id",
  "description": "生成图片 1024x1024"
}`}
              </pre>
            </Paragraph>
          </div>
        )}
      </Modal>
    </>
  )
}

export default APIServiceTable
