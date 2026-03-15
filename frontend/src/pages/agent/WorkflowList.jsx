/**
 * Agent工作流列表页 v2.4
 * 卡片式网格布局，FastGPT风格
 * 支持创建、编辑、删除、执行、发布等操作
 * 
 * v2.1 修复：Dropdown菜单点击事件冒泡问题
 * v2.2 新增：重命名功能，可以在列表中修改工作流名称和描述
 * v2.3 P3优化：dayjs语言跟随i18n设置，去除硬编码中文
 * v2.4 移除"运行"按钮的发布限制：未发布的工作流也可以直接运行
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
import 'dayjs/locale/en'
import './WorkflowList.less'

// 配置dayjs插件（语言在组件内动态设置）
dayjs.extend(relativeTime)

/**
 * 工作流卡片组件
 */
const WorkflowCard = ({ workflow, onEdit, onRename, onDelete, onTogglePublish, onExecute }) => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  
  /**
   * 格式化更新时间为相对时间
   * v2.3: 使用i18n翻译键替代硬编码中文
   * @param {string} date - 日期字符串
   * @returns {string} 格式化后的相对时间
   */
  const formatRelativeTime = (date) => {
    const now = dayjs()
    const target = dayjs(date)
    const diffDays = now.diff(target, 'day')
    
    if (diffDays === 0) {
      return target.format('HH:mm')
    } else if (diffDays === 1) {
      return t('agent.workflow.yesterday', '昨天')
    } else if (diffDays < 7) {
      return t('agent.workflow.daysAgo', '{{count}}天前', { count: diffDays })
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
  
  // 处理执行 - v2.4: 不再检查发布状态
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
  
  // 更多操作菜单 - v2.4: "运行"不再受发布状态限制
  const menuItems = [
    {
      key: 'rename',
      label: t('agent.workflow.rename', '重命名'),
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
          <Tag className="workflow-type-tag">{t('agent.workflow.type', '工作流')}</Tag>
        </div>
        {!!workflow.is_published && (
          <Tag color="success" className="workflow-status-tag">
            <CheckCircleOutlined /> {t('agent.workflow.published', '已发布')}
          </Tag>
        )}
      </div>
      
      {/* 卡片描述 */}
      <div className="workflow-card-body">
        <div className="workflow-description">
          {workflow.description || t('agent.workflow.noDescription', '暂无介绍')}
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
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  
  // v2.3: dayjs语言跟随i18n设置
  useEffect(() => {
    const lang = i18n.language || 'zh'
    dayjs.locale(lang.startsWith('zh') ? 'zh-cn' : 'en')
  }, [i18n.language])
  
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
        is_published: false
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
      message.success(t('agent.workflow.renameSuccess', '工作流信息已更新'))
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
  
  // 执行工作流 - v2.4: 不再检查发布状态，直接跳转执行页
  const handleExecute = (workflow) => {
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
            placeholder={t('agent.workflow.searchPlaceholder', '搜索工作流...')}
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
            { label: t('agent.workflow.filterAll', '全部'), value: 'all' },
            { label: t('agent.workflow.filterPublished', '已发布'), value: 'published' },
            { label: t('agent.workflow.filterDraft', '未发布'), value: 'draft' }
          ]}
        />
        <span className="workflow-count">
          {t('agent.workflow.totalCount', '共 {{count}} 个工作流', { count: filteredWorkflows.length })}
        </span>
      </div>
      
      {/* 工作流卡片网格 */}
      <div className="workflow-list-content">
        {workflowsLoading ? (
          <div className="loading-container">
            <Spin size="large" tip={t('common.loading', '加载中...')} />
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              searchText || filterStatus !== 'all' 
                ? t('agent.workflow.noMatch', '没有找到匹配的工作流') 
                : t('agent.workflow.empty', '还没有创建工作流')
            }
          >
            {!searchText && filterStatus === 'all' && (
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setCreateModalVisible(true)}
              >
                {t('agent.workflow.createFirst', '创建第一个工作流')}
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
      
      {/* 创建工作流弹窗 - v2.4: 移除"创建后立即发布"开关 */}
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
        okText={t('common.create', '创建')}
        cancelText={t('common.cancel', '取消')}
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
            label={t('agent.workflow.nameLabel', '工作流名称')}
            rules={[
              { required: true, message: t('agent.workflow.nameRequired', '请输入工作流名称') },
              { max: 100, message: t('agent.workflow.nameMaxLength', '名称不能超过100个字符') }
            ]}
          >
            <Input placeholder={t('agent.workflow.namePlaceholder', '例如：AI客服自动回复')} />
          </Form.Item>
          
          <Form.Item
            name="description"
            label={t('agent.workflow.descriptionLabel', '描述（可选）')}
            rules={[
              { max: 500, message: t('agent.workflow.descMaxLength', '描述不能超过500个字符') }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder={t('agent.workflow.descPlaceholder', '描述这个工作流的用途...')}
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* v2.2 重命名工作流弹窗 */}
      <Modal
        title={
          <Space>
            <FormOutlined />
            {t('agent.workflow.rename', '重命名工作流')}
          </Space>
        }
        open={renameModalVisible}
        onCancel={() => {
          setRenameModalVisible(false)
          setWorkflowToRename(null)
          renameForm.resetFields()
        }}
        onOk={() => renameForm.submit()}
        okText={t('common.save', '保存')}
        cancelText={t('common.cancel', '取消')}
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
            label={t('agent.workflow.nameLabel', '工作流名称')}
            rules={[
              { required: true, message: t('agent.workflow.nameRequired', '请输入工作流名称') },
              { max: 100, message: t('agent.workflow.nameMaxLength', '名称不能超过100个字符') }
            ]}
          >
            <Input placeholder={t('agent.workflow.namePlaceholder', '例如：AI客服自动回复')} />
          </Form.Item>
          
          <Form.Item
            name="description"
            label={t('agent.workflow.descriptionLabel', '描述（可选）')}
            rules={[
              { max: 500, message: t('agent.workflow.descMaxLength', '描述不能超过500个字符') }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder={t('agent.workflow.descPlaceholder', '描述这个工作流的用途...')}
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* 删除确认弹窗 */}
      <Modal
        title={t('agent.workflow.deleteConfirmTitle', '确认删除')}
        open={deleteConfirmVisible}
        onCancel={() => {
          setDeleteConfirmVisible(false)
          setWorkflowToDelete(null)
        }}
        onOk={handleDeleteConfirm}
        okText={t('agent.workflow.confirmDelete', '确认删除')}
        cancelText={t('common.cancel', '取消')}
        okButtonProps={{ danger: true }}
      >
        <p>{t('agent.workflow.deleteConfirmMsg', '确定要删除工作流 "{{name}}" 吗？', { name: workflowToDelete?.name })}</p>
        <p style={{ color: '#999', fontSize: '12px' }}>{t('agent.workflow.deleteWarning', '删除后无法恢复，相关的执行历史也会被删除。')}</p>
      </Modal>
    </div>
  )
}

export default WorkflowList
