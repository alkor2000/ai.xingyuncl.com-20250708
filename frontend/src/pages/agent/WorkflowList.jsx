/**
 * Agent工作流列表页 v2.2
 * 卡片式网格布局，FastGPT风格
 * 支持创建、编辑、删除、执行、发布等操作
 * 
 * v2.1 修复：Dropdown菜单点击事件冒泡问题
 * v2.2 新增：重命名功能，可以在列表中修改工作流名称和描述
 */

import React, { useEffect, useState, useMemo } from 'react'
import { 
  Card, 
  Button, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Switch,
  Tooltip,
  Popconfirm,
  message,
  Empty,
  Spin,
  Dropdown,
  Row,
  Col,
  Segmented
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  MoreOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SearchOutlined,
  AppstoreOutlined,
  RobotOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  FormOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAgentStore from '../../stores/agentStore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import './WorkflowList.less'

// 配置dayjs
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/**
 * 工作流卡片组件
 */
const WorkflowCard = ({ workflow, onEdit, onRename, onDelete, onTogglePublish, onExecute }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  
  // 格式化更新时间为相对时间
  const formatRelativeTime = (date) => {
    const now = dayjs()
    const target = dayjs(date)
    const diffDays = now.diff(target, 'day')
    
    if (diffDays === 0) {
      return target.format('HH:mm')
    } else if (diffDays === 1) {
      return '昨天'
    } else if (diffDays < 7) {
      return `${diffDays}天前`
    } else {
      return target.format('MM-DD')
    }
  }
  
  // 处理编辑（进入画布）
  const handleEdit = (e) => {
    e.domEvent?.stopPropagation()
    onEdit(workflow)
  }
  
  // v2.2 处理重命名
  const handleRename = (e) => {
    e.domEvent?.stopPropagation()
    onRename(workflow)
  }
  
  // 处理执行
  const handleExecute = (e) => {
    e.domEvent?.stopPropagation()
    onExecute(workflow)
  }
  
  // 处理发布/取消发布
  const handleTogglePublish = (e) => {
    e.domEvent?.stopPropagation()
    onTogglePublish(workflow.id)
  }
  
  // 处理删除
  const handleDelete = (e) => {
    e.domEvent?.stopPropagation()
    onDelete(workflow)
  }
  
  // 更多操作菜单 - v2.2 添加重命名选项
  const menuItems = [
    {
      key: 'rename',
      label: '重命名',
      icon: <FormOutlined />,
      onClick: handleRename
    },
    {
      key: 'edit',
      label: t('agent.workflow.edit'),
      icon: <EditOutlined />,
      onClick: handleEdit
    },
    {
      key: 'execute',
      label: t('agent.workflow.execute'),
      icon: <PlayCircleOutlined />,
      disabled: !workflow.is_published,
      onClick: handleExecute
    },
    {
      key: 'publish',
      label: workflow.is_published ? t('agent.workflow.unpublish') : t('agent.workflow.publish'),
      icon: workflow.is_published ? <CloseCircleOutlined /> : <CheckCircleOutlined />,
      onClick: handleTogglePublish
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: t('agent.workflow.delete'),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: handleDelete
    }
  ]
  
  // 点击卡片进入编辑器
  const handleCardClick = () => {
    navigate(`/agent/editor/${workflow.id}`)
  }
  
  // 阻止Dropdown区域的点击事件冒泡
  const handleDropdownAreaClick = (e) => {
    e.stopPropagation()
  }
  
  return (
    <div className="workflow-card" onClick={handleCardClick}>
      {/* 卡片头部：图标、名称、状态 */}
      <div className="workflow-card-header">
        <div className="workflow-icon">
          <RobotOutlined />
        </div>
        <div className="workflow-title-area">
          <div className="workflow-name">{workflow.name}</div>
          <Tag className="workflow-type-tag">工作流</Tag>
        </div>
        {workflow.is_published && (
          <Tag color="success" className="workflow-status-tag">
            <CheckCircleOutlined /> 已发布
          </Tag>
        )}
      </div>
      
      {/* 卡片描述 */}
      <div className="workflow-card-body">
        <div className="workflow-description">
          {workflow.description || '暂无介绍'}
        </div>
      </div>
      
      {/* 卡片底部：版本、时间、更多操作 */}
      <div className="workflow-card-footer">
        <div className="workflow-meta">
          <span className="workflow-version">v{workflow.version || 1}</span>
          <span className="workflow-time">
            <ClockCircleOutlined /> {formatRelativeTime(workflow.updated_at)}
          </span>
        </div>
        {/* 用div包裹Dropdown，阻止事件冒泡 */}
        <div onClick={handleDropdownAreaClick}>
          <Dropdown
            menu={{ items: menuItems }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button 
              type="text" 
              icon={<MoreOutlined />} 
              className="workflow-more-btn"
            />
          </Dropdown>
        </div>
      </div>
    </div>
  )
}

/**
 * 工作流列表主组件
 */
const WorkflowList = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  
  // 从store获取状态和方法
  const {
    workflows,
    workflowsLoading,
    workflowsPagination,
    fetchWorkflows,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    togglePublish
  } = useAgentStore()
  
  // 本地状态
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // all, published, draft
  const [form] = Form.useForm()
  
  // v2.2 重命名弹窗状态
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [workflowToRename, setWorkflowToRename] = useState(null)
  const [renameForm] = Form.useForm()
  const [renaming, setRenaming] = useState(false)
  
  // 初始加载
  useEffect(() => {
    fetchWorkflows({ current: 1, pageSize: 50 })
  }, [])
  
  // 筛选后的工作流列表
  const filteredWorkflows = useMemo(() => {
    let result = workflows || []
    
    // 按搜索文本筛选
    if (searchText) {
      const lowerSearch = searchText.toLowerCase()
      result = result.filter(w => 
        w.name.toLowerCase().includes(lowerSearch) ||
        (w.description && w.description.toLowerCase().includes(lowerSearch))
      )
    }
    
    // 按发布状态筛选
    if (filterStatus === 'published') {
      result = result.filter(w => w.is_published)
    } else if (filterStatus === 'draft') {
      result = result.filter(w => !w.is_published)
    }
    
    return result
  }, [workflows, searchText, filterStatus])
  
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
  
  // 编辑工作流（进入画布）
  const handleEdit = (workflow) => {
    navigate(`/agent/editor/${workflow.id}`)
  }
  
  // v2.2 打开重命名弹窗
  const handleRenameClick = (workflow) => {
    setWorkflowToRename(workflow)
    renameForm.setFieldsValue({
      name: workflow.name,
      description: workflow.description || ''
    })
    setRenameModalVisible(true)
  }
  
  // v2.2 确认重命名
  const handleRenameConfirm = async (values) => {
    if (!workflowToRename) return
    
    setRenaming(true)
    try {
      await updateWorkflow(workflowToRename.id, {
        name: values.name,
        description: values.description || ''
      })
      
      setRenameModalVisible(false)
      setWorkflowToRename(null)
      renameForm.resetFields()
      message.success('工作流信息已更新')
    } catch (error) {
      console.error('重命名失败:', error)
    } finally {
      setRenaming(false)
    }
  }
  
  // 删除工作流 - 显示确认弹窗
  const handleDeleteClick = (workflow) => {
    setWorkflowToDelete(workflow)
    setDeleteConfirmVisible(true)
  }
  
  // 确认删除
  const handleDeleteConfirm = async () => {
    if (!workflowToDelete) return
    
    try {
      await deleteWorkflow(workflowToDelete.id)
      setDeleteConfirmVisible(false)
      setWorkflowToDelete(null)
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
  const handleExecute = (workflow) => {
    if (!workflow.is_published) {
      message.warning('请先发布工作流后再执行')
      return
    }
    navigate(`/agent/execute/${workflow.id}`)
  }
  
  // 刷新列表
  const handleRefresh = () => {
    fetchWorkflows({ current: 1, pageSize: 50 })
  }
  
  return (
    <div className="workflow-list-container">
      {/* 顶部操作栏 */}
      <div className="workflow-list-header">
        <div className="header-left">
          <h2 className="page-title">
            <AppstoreOutlined /> {t('agent.workflow.list')}
          </h2>
        </div>
        <div className="header-right">
          <Input
            placeholder="搜索工作流..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="search-input"
            allowClear
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            className="refresh-btn"
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
            className="create-btn"
          >
            {t('agent.workflow.create')}
          </Button>
        </div>
      </div>
      
      {/* 筛选标签 */}
      <div className="workflow-list-filter">
        <Segmented
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { label: '全部', value: 'all' },
            { label: '已发布', value: 'published' },
            { label: '未发布', value: 'draft' }
          ]}
        />
        <span className="workflow-count">
          共 {filteredWorkflows.length} 个工作流
        </span>
      </div>
      
      {/* 工作流卡片网格 */}
      <div className="workflow-list-content">
        {workflowsLoading ? (
          <div className="loading-container">
            <Spin size="large" tip="加载中..." />
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              searchText || filterStatus !== 'all' 
                ? '没有找到匹配的工作流' 
                : '还没有创建工作流'
            }
          >
            {!searchText && filterStatus === 'all' && (
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setCreateModalVisible(true)}
              >
                创建第一个工作流
              </Button>
            )}
          </Empty>
        ) : (
          <Row gutter={[16, 16]} className="workflow-grid">
            {filteredWorkflows.map((workflow) => (
              <Col 
                key={workflow.id} 
                xs={24} 
                sm={12} 
                md={8} 
                lg={6}
                xl={6}
              >
                <WorkflowCard
                  workflow={workflow}
                  onEdit={handleEdit}
                  onRename={handleRenameClick}
                  onDelete={handleDeleteClick}
                  onTogglePublish={handleTogglePublish}
                  onExecute={handleExecute}
                />
              </Col>
            ))}
          </Row>
        )}
      </div>
      
      {/* 创建工作流弹窗 */}
      <Modal
        title={
          <Space>
            <RobotOutlined />
            {t('agent.workflow.create')}
          </Space>
        }
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
        width={520}
        className="create-workflow-modal"
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
            label="描述（可选）"
            rules={[
              { max: 500, message: '描述不能超过500个字符' }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder="描述这个工作流的用途..."
              showCount
              maxLength={500}
            />
          </Form.Item>
          
          <Form.Item
            name="is_published"
            label="创建后立即发布"
            valuePropName="checked"
            tooltip="发布后才能执行工作流"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* v2.2 重命名工作流弹窗 */}
      <Modal
        title={
          <Space>
            <FormOutlined />
            重命名工作流
          </Space>
        }
        open={renameModalVisible}
        onCancel={() => {
          setRenameModalVisible(false)
          setWorkflowToRename(null)
          renameForm.resetFields()
        }}
        onOk={() => renameForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={renaming}
        width={520}
        className="rename-workflow-modal"
      >
        <Form
          form={renameForm}
          layout="vertical"
          onFinish={handleRenameConfirm}
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
            label="描述（可选）"
            rules={[
              { max: 500, message: '描述不能超过500个字符' }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder="描述这个工作流的用途..."
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* 删除确认弹窗 */}
      <Modal
        title="确认删除"
        open={deleteConfirmVisible}
        onCancel={() => {
          setDeleteConfirmVisible(false)
          setWorkflowToDelete(null)
        }}
        onOk={handleDeleteConfirm}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要删除工作流 <strong>"{workflowToDelete?.name}"</strong> 吗？</p>
        <p style={{ color: '#999', fontSize: '12px' }}>删除后无法恢复，相关的执行历史也会被删除。</p>
      </Modal>
    </div>
  )
}

export default WorkflowList
