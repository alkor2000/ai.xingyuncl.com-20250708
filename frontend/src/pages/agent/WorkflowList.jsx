/**
 * Agent工作流列表页
 * 展示用户的所有工作流，支持创建、编辑、删除、执行
 */

import React, { useEffect, useState } from 'react'
import { 
  Card, 
  Button, 
  Table, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Switch,
  Tooltip,
  Popconfirm,
  message
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAgentStore from '../../stores/agentStore'
import dayjs from 'dayjs'

const WorkflowList = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  
  const {
    workflows,
    workflowsLoading,
    workflowsPagination,
    fetchWorkflows,
    createWorkflow,
    deleteWorkflow,
    togglePublish
  } = useAgentStore()
  
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [form] = Form.useForm()
  
  // 初始加载
  useEffect(() => {
    fetchWorkflows({ current: 1 })
  }, [])
  
  // 创建工作流
  const handleCreate = async (values) => {
    try {
      const newWorkflow = await createWorkflow({
        name: values.name,
        description: values.description || '',
        flow_data: {
          nodes: [],
          edges: []
        },
        is_published: values.is_published || false
      })
      
      setCreateModalVisible(false)
      form.resetFields()
      
      // 跳转到编辑器
      navigate(`/agent/editor/${newWorkflow.id}`)
    } catch (error) {
      console.error('创建失败:', error)
    }
  }
  
  // 删除工作流
  const handleDelete = async (id) => {
    try {
      await deleteWorkflow(id)
    } catch (error) {
      console.error('删除失败:', error)
    }
  }
  
  // 切换发布状态
  const handleTogglePublish = async (id) => {
    try {
      await togglePublish(id)
    } catch (error) {
      console.error('切换发布状态失败:', error)
    }
  }
  
  // 执行工作流
  const handleExecute = (record) => {
    if (!record.is_published) {
      message.warning('请先发布工作流后再执行')
      return
    }
    navigate(`/agent/execute/${record.id}`)
  }
  
  // 表格列定义
  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: t('agent.workflow.name'),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (text, record) => (
        <Space>
          <a onClick={() => navigate(`/agent/editor/${record.id}`)}>
            {text}
          </a>
          {record.is_published && (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              已发布
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: t('agent.workflow.description'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80,
      align: 'center'
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text) => dayjs(text).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (text) => dayjs(text).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 280,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => navigate(`/agent/editor/${record.id}`)}
            />
          </Tooltip>
          
          <Tooltip title={record.is_published ? '取消发布' : '发布'}>
            <Button
              type="text"
              icon={record.is_published ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
              onClick={() => handleTogglePublish(record.id)}
            />
          </Tooltip>
          
          <Tooltip title="执行">
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              onClick={() => handleExecute(record)}
              disabled={!record.is_published}
            />
          </Tooltip>
          
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/agent/detail/${record.id}`)}
            />
          </Tooltip>
          
          <Popconfirm
            title="确定要删除这个工作流吗？"
            description="删除后无法恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]
  
  return (
    <div style={{ padding: '24px' }}>
      <Card
        title="工作流列表"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建工作流
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={workflows}
          rowKey="id"
          loading={workflowsLoading}
          pagination={{
            current: workflowsPagination.current,
            pageSize: workflowsPagination.pageSize,
            total: workflowsPagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              fetchWorkflows({ current: page, pageSize })
            }
          }}
          scroll={{ x: 1200 }}
        />
      </Card>
      
      {/* 创建工作流弹窗 */}
      <Modal
        title="创建工作流"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
        >
          <Form.Item
            name="name"
            label="工作流名称"
            rules={[
              { required: true, message: '请输入工作流名称' },
              { max: 100, message: '名称不能超过100个字符' }
            ]}
          >
            <Input placeholder="例如：AI客服自动回复" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
            rules={[
              { max: 500, message: '描述不能超过500个字符' }
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="描述这个工作流的用途..."
            />
          </Form.Item>
          
          <Form.Item
            name="is_published"
            label="创建后立即发布"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default WorkflowList
