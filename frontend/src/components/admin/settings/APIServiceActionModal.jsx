/**
 * API服务操作配置模态框组件
 */

import React, { useState, useEffect } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  InputNumber, 
  Select, 
  Table, 
  Button, 
  Space, 
  message,
  Popconfirm,
  Tag,
  Alert,
  Empty
} from 'antd'
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Option } = Select

const APIServiceActionModal = ({
  visible,
  service,
  onCancel,
  onSuccess,
  adminStore
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [actions, setActions] = useState([])
  const [editingKey, setEditingKey] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // 加载操作列表
  useEffect(() => {
    if (visible && service) {
      loadActions()
    }
  }, [visible, service])

  // 加载操作列表
  const loadActions = async () => {
    try {
      setLoading(true)
      const data = await adminStore.getApiServiceActions(service.service_id)
      setActions(data || [])
    } catch (error) {
      message.error('加载操作配置失败')
    } finally {
      setLoading(false)
    }
  }

  // 判断是否正在编辑
  const isEditing = (record) => record.action_type === editingKey

  // 开始编辑
  const edit = (record) => {
    form.setFieldsValue({
      action_type: record.action_type,
      action_name: record.action_name,
      credits: record.credits,
      description: record.description,
      status: record.status
    })
    setEditingKey(record.action_type)
    setIsAdding(false)
  }

  // 开始添加
  const handleAdd = () => {
    form.resetFields()
    form.setFieldsValue({
      status: 'active',
      credits: 1
    })
    setEditingKey('new')
    setIsAdding(true)
  }

  // 取消编辑
  const cancel = () => {
    setEditingKey('')
    setIsAdding(false)
    form.resetFields()
  }

  // 保存操作配置
  const save = async (actionType) => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      await adminStore.upsertApiServiceAction(service.service_id, values)
      message.success(isAdding ? '操作配置添加成功' : '操作配置更新成功')
      
      setEditingKey('')
      setIsAdding(false)
      form.resetFields()
      await loadActions()
      onSuccess && onSuccess()
    } catch (error) {
      if (error.errorFields) {
        return
      }
      message.error(error.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  // 删除操作配置
  const handleDelete = async (actionType) => {
    try {
      setLoading(true)
      await adminStore.deleteApiServiceAction(service.service_id, actionType)
      message.success('操作配置删除成功')
      await loadActions()
      onSuccess && onSuccess()
    } catch (error) {
      message.error(error.message || '删除失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    {
      title: '操作类型',
      dataIndex: 'action_type',
      key: 'action_type',
      width: 150,
      render: (text, record) => {
        if (isEditing(record) || (isAdding && editingKey === 'new')) {
          return (
            <Form.Item
              name="action_type"
              style={{ margin: 0 }}
              rules={[
                { required: true, message: '请输入操作类型' },
                { 
                  pattern: /^[a-z0-9_]+$/, 
                  message: '只能包含小写字母、数字和下划线' 
                }
              ]}
            >
              <Input 
                placeholder="如：generate_image" 
                disabled={!isAdding}
              />
            </Form.Item>
          )
        }
        return <Tag color="blue">{text}</Tag>
      }
    },
    {
      title: '操作名称',
      dataIndex: 'action_name',
      key: 'action_name',
      width: 150,
      render: (text, record) => {
        if (isEditing(record) || (isAdding && editingKey === 'new')) {
          return (
            <Form.Item
              name="action_name"
              style={{ margin: 0 }}
              rules={[
                { required: true, message: '请输入操作名称' },
                { max: 50, message: '操作名称不能超过50个字符' }
              ]}
            >
              <Input placeholder="如：生成图片" />
            </Form.Item>
          )
        }
        return text
      }
    },
    {
      title: '消耗积分',
      dataIndex: 'credits',
      key: 'credits',
      width: 120,
      render: (text, record) => {
        if (isEditing(record) || (isAdding && editingKey === 'new')) {
          return (
            <Form.Item
              name="credits"
              style={{ margin: 0 }}
              rules={[
                { required: true, message: '请输入积分' },
                { type: 'number', min: 1, message: '积分必须大于0' }
              ]}
            >
              <InputNumber min={1} placeholder="1" style={{ width: '100%' }} />
            </Form.Item>
          )
        }
        return <Tag color="orange">{text} 积分</Tag>
      }
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (text, record) => {
        if (isEditing(record) || (isAdding && editingKey === 'new')) {
          return (
            <Form.Item
              name="description"
              style={{ margin: 0 }}
              rules={[
                { max: 200, message: '描述不能超过200个字符' }
              ]}
            >
              <Input placeholder="操作说明（选填）" />
            </Form.Item>
          )
        }
        return text || '-'
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (text, record) => {
        if (isEditing(record) || (isAdding && editingKey === 'new')) {
          return (
            <Form.Item
              name="status"
              style={{ margin: 0 }}
            >
              <Select style={{ width: '100%' }}>
                <Option value="active">启用</Option>
                <Option value="inactive">禁用</Option>
              </Select>
            </Form.Item>
          )
        }
        return (
          <Tag color={text === 'active' ? 'success' : 'default'}>
            {text === 'active' ? '启用' : '禁用'}
          </Tag>
        )
      }
    },
    {
      title: '操作',
      key: 'operation',
      width: 120,
      fixed: 'right',
      render: (_, record) => {
        const editable = isEditing(record) || (isAdding && editingKey === 'new')
        return editable ? (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<SaveOutlined />}
              onClick={() => save(record.action_type)}
              loading={loading}
            >
              保存
            </Button>
            <Button
              type="link"
              size="small"
              onClick={cancel}
              disabled={loading}
            >
              取消
            </Button>
          </Space>
        ) : (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => edit(record)}
              disabled={editingKey !== ''}
            >
              编辑
            </Button>
            <Popconfirm
              title="确定要删除这个操作配置吗？"
              onConfirm={() => handleDelete(record.action_type)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                danger
                disabled={editingKey !== ''}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    }
  ]

  // 表格数据（包含新增行）
  const tableData = isAdding 
    ? [...actions, { action_type: 'new', key: 'new' }]
    : actions

  return (
    <Modal
      title={`配置操作 - ${service?.service_name || ''}`}
      open={visible}
      onCancel={onCancel}
      width={1000}
      footer={[
        <Button key="close" onClick={onCancel}>
          关闭
        </Button>
      ]}
    >
      <Alert
        message="操作配置说明"
        description={
          <div>
            <div>• 每个操作类型对应不同的积分消耗</div>
            <div>• 操作类型创建后不可修改，请谨慎填写</div>
            <div>• 禁用的操作将无法调用扣费接口</div>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          disabled={editingKey !== ''}
        >
          添加操作
        </Button>
      </div>

      <Form form={form} component={false}>
        <Table
          dataSource={tableData}
          columns={columns}
          rowKey="action_type"
          loading={loading}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{
            emptyText: (
              <Empty
                description="暂无操作配置"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )
          }}
        />
      </Form>
    </Modal>
  )
}

export default APIServiceActionModal
