/**
 * Agent工作流列表页 v2.5
 * 卡片式网格布局，FastGPT风格
 * 支持创建、编辑、重命名、删除、执行、发布等操作
 *
 * v2.1 修复：Dropdown菜单点击事件冒泡问题
 * v2.2 新增：重命名功能，可以在列表中修改工作流名称和描述
 * v2.3 P3优化：dayjs语言跟随i18n设置
 * v2.4 移除"运行"按钮的发布限制：未发布的工作流也可以直接运行
 * v2.5 国际化彻底修复：
 *   - 移除全部 t(key, '中文兜底') 的第二个参数
 *     原因：原代码中 16 个键（rename/totalCount/nameLabel/deleteConfirmMsg 等）
 *     在 agent.json 里并不存在，i18next 遇到缺失键会直接返回第二参数（中文兜底值），
 *     导致界面切换到英文后这些位置仍然显示中文。
 *   - 上述键已全部在 zh-CN/en-US 的 agent.json 中补齐。
 *   - 通用按钮文案统一使用 agent.actions.* 命名空间，
 *     避免依赖 common.json 中不确定是否存在的键。
 */

import React, { useEffect, useState, useMemo } from 'react'
import {
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
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

// 注册 dayjs 相对时间插件（具体语言在组件内根据 i18n 动态设置）
dayjs.extend(relativeTime)

/**
 * 工作流卡片组件
 *
 * @param {Object} workflow - 工作流数据对象
 * @param {Function} onEdit - 进入编辑器回调
 * @param {Function} onRename - 打开重命名弹窗回调
 * @param {Function} onDelete - 打开删除确认回调
 * @param {Function} onTogglePublish - 切换发布状态回调
 * @param {Function} onExecute - 运行工作流回调
 */
const WorkflowCard = ({ workflow, onEdit, onRename, onDelete, onTogglePublish, onExecute }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  /**
   * 格式化更新时间为相对时间描述
   * 规则：当天显示"时:分"，昨天显示"昨天"，7天内显示"N天前"，更早显示"月-日"
   *
   * @param {string} date - 日期字符串
   * @returns {string} 格式化后的时间文本
   */
  const formatRelativeTime = (date) => {
    const now = dayjs()
    const target = dayjs(date)
    const diffDays = now.diff(target, 'day')

    if (diffDays === 0) {
      return target.format('HH:mm')
    } else if (diffDays === 1) {
      return t('agent.workflow.yesterday')
    } else if (diffDays < 7) {
      return t('agent.workflow.daysAgo', { count: diffDays })
    } else {
      return target.format('MM-DD')
    }
  }

  // 处理编辑（进入画布编辑器）
  const handleEdit = (e) => {
    e.domEvent?.stopPropagation()
    onEdit(workflow)
  }

  // 处理重命名
  const handleRename = (e) => {
    e.domEvent?.stopPropagation()
    onRename(workflow)
  }

  // 处理执行（不检查发布状态，未发布也可运行）
  const handleExecute = (e) => {
    e.domEvent?.stopPropagation()
    onExecute(workflow)
  }

  // 处理发布 / 取消发布
  const handleTogglePublish = (e) => {
    e.domEvent?.stopPropagation()
    onTogglePublish(workflow.id)
  }

  // 处理删除
  const handleDelete = (e) => {
    e.domEvent?.stopPropagation()
    onDelete(workflow)
  }

  // 更多操作下拉菜单项定义
  const menuItems = [
    {
      key: 'rename',
      label: t('agent.workflow.rename'),
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
      label: workflow.is_published
        ? t('agent.workflow.unpublish')
        : t('agent.workflow.publish'),
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

  // 点击卡片主体进入编辑器
  const handleCardClick = () => {
    navigate(`/agent/editor/${workflow.id}`)
  }

  // 阻止 Dropdown 区域点击冒泡到卡片，避免误进编辑器
  const handleDropdownAreaClick = (e) => {
    e.stopPropagation()
  }

  return (
    <div className="workflow-card" onClick={handleCardClick}>
      {/* 卡片头部：图标、名称、发布状态标签 */}
      <div className="workflow-card-header">
        <div className="workflow-icon">
          <RobotOutlined />
        </div>
        <div className="workflow-title-area">
          <div className="workflow-name">{workflow.name}</div>
          <Tag className="workflow-type-tag">{t('agent.workflow.type')}</Tag>
        </div>
        {!!workflow.is_published && (
          <Tag color="success" className="workflow-status-tag">
            <CheckCircleOutlined /> {t('agent.workflow.published')}
          </Tag>
        )}
      </div>

      {/* 卡片描述区 */}
      <div className="workflow-card-body">
        <div className="workflow-description">
          {workflow.description || t('agent.workflow.noDescription')}
        </div>
      </div>

      {/* 卡片底部：版本号、更新时间、更多操作按钮 */}
      <div className="workflow-card-footer">
        <div className="workflow-meta">
          <span className="workflow-version">v{workflow.version || 1}</span>
          <span className="workflow-time">
            <ClockCircleOutlined /> {formatRelativeTime(workflow.updated_at)}
          </span>
        </div>
        {/* 用 div 包裹 Dropdown 阻止事件冒泡 */}
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

  /**
   * dayjs 语言跟随 i18n 设置
   * 保证相对时间等日期文案与界面语言一致
   */
  useEffect(() => {
    const lang = i18n.language || 'zh-CN'
    dayjs.locale(lang.startsWith('zh') ? 'zh-cn' : 'en')
  }, [i18n.language])

  // 从 store 获取状态与方法
  const {
    workflows,
    workflowsLoading,
    fetchWorkflows,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    togglePublish
  } = useAgentStore()

  // 创建弹窗状态
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [form] = Form.useForm()

  // 删除确认弹窗状态
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState(null)

  // 搜索与筛选状态
  const [searchText, setSearchText] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // all | published | draft

  // 重命名弹窗状态
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [workflowToRename, setWorkflowToRename] = useState(null)
  const [renameForm] = Form.useForm()
  const [renaming, setRenaming] = useState(false)

  // 首次加载工作流列表
  useEffect(() => {
    fetchWorkflows({ current: 1, pageSize: 50 })
  }, [])

  /**
   * 按搜索关键字与发布状态筛选后的工作流列表
   * 使用 useMemo 缓存，避免每次渲染重复过滤
   */
  const filteredWorkflows = useMemo(() => {
    let result = workflows || []

    // 按名称 / 描述模糊搜索
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

  /**
   * 创建工作流
   * 成功后直接跳转到画布编辑器
   */
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

      navigate(`/agent/editor/${newWorkflow.id}`)
    } catch (error) {
      // 用户可见的错误提示由 store 层统一处理，此处只记录日志
      console.error('[WorkflowList] 创建工作流失败:', error)
    }
  }

  // 编辑工作流（进入画布）
  const handleEdit = (workflow) => {
    navigate(`/agent/editor/${workflow.id}`)
  }

  // 打开重命名弹窗并回填当前名称与描述
  const handleRenameClick = (workflow) => {
    setWorkflowToRename(workflow)
    renameForm.setFieldsValue({
      name: workflow.name,
      description: workflow.description || ''
    })
    setRenameModalVisible(true)
  }

  /**
   * 确认重命名
   */
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
      message.success(t('agent.workflow.renameSuccess'))
    } catch (error) {
      console.error('[WorkflowList] 重命名工作流失败:', error)
    } finally {
      setRenaming(false)
    }
  }

  // 点击删除，弹出二次确认框
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
      console.error('[WorkflowList] 删除工作流失败:', error)
    }
  }

  // 切换发布状态
  const handleTogglePublish = async (id) => {
    try {
      await togglePublish(id)
    } catch (error) {
      console.error('[WorkflowList] 切换发布状态失败:', error)
    }
  }

  // 运行工作流（不检查发布状态，直接跳转执行页）
  const handleExecute = (workflow) => {
    navigate(`/agent/execute/${workflow.id}`)
  }

  // 刷新列表
  const handleRefresh = () => {
    fetchWorkflows({ current: 1, pageSize: 50 })
  }

  return (
    <div className="workflow-list-container">
      {/* 顶部操作栏：标题、搜索、刷新、创建 */}
      <div className="workflow-list-header">
        <div className="header-left">
          <h2 className="page-title">
            <AppstoreOutlined /> {t('agent.workflow.list')}
          </h2>
        </div>
        <div className="header-right">
          <Input
            placeholder={t('agent.workflow.searchPlaceholder')}
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
            title={t('agent.actions.refresh')}
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

      {/* 筛选标签与总数统计 */}
      <div className="workflow-list-filter">
        <Segmented
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { label: t('agent.workflow.filterAll'), value: 'all' },
            { label: t('agent.workflow.filterPublished'), value: 'published' },
            { label: t('agent.workflow.filterDraft'), value: 'draft' }
          ]}
        />
        <span className="workflow-count">
          {t('agent.workflow.totalCount', { count: filteredWorkflows.length })}
        </span>
      </div>

      {/* 工作流卡片网格区 */}
      <div className="workflow-list-content">
        {workflowsLoading ? (
          <div className="loading-container">
            <Spin size="large" tip={t('agent.actions.loading')} />
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              searchText || filterStatus !== 'all'
                ? t('agent.workflow.noMatch')
                : t('agent.workflow.empty')
            }
          >
            {/* 仅在无搜索无筛选的真正空状态下，显示引导创建按钮 */}
            {!searchText && filterStatus === 'all' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateModalVisible(true)}
              >
                {t('agent.workflow.createFirst')}
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
        okText={t('agent.actions.create')}
        cancelText={t('agent.actions.cancel')}
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
            label={t('agent.workflow.nameLabel')}
            rules={[
              { required: true, message: t('agent.workflow.nameRequired') },
              { max: 100, message: t('agent.workflow.nameMaxLength') }
            ]}
          >
            <Input placeholder={t('agent.workflow.namePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="description"
            label={t('agent.workflow.descriptionLabel')}
            rules={[
              { max: 500, message: t('agent.workflow.descMaxLength') }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder={t('agent.workflow.descPlaceholder')}
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名工作流弹窗 */}
      <Modal
        title={
          <Space>
            <FormOutlined />
            {t('agent.workflow.renameTitle')}
          </Space>
        }
        open={renameModalVisible}
        onCancel={() => {
          setRenameModalVisible(false)
          setWorkflowToRename(null)
          renameForm.resetFields()
        }}
        onOk={() => renameForm.submit()}
        okText={t('agent.actions.save')}
        cancelText={t('agent.actions.cancel')}
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
            label={t('agent.workflow.nameLabel')}
            rules={[
              { required: true, message: t('agent.workflow.nameRequired') },
              { max: 100, message: t('agent.workflow.nameMaxLength') }
            ]}
          >
            <Input placeholder={t('agent.workflow.namePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="description"
            label={t('agent.workflow.descriptionLabel')}
            rules={[
              { max: 500, message: t('agent.workflow.descMaxLength') }
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder={t('agent.workflow.descPlaceholder')}
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal
        title={t('agent.workflow.deleteConfirmTitle')}
        open={deleteConfirmVisible}
        onCancel={() => {
          setDeleteConfirmVisible(false)
          setWorkflowToDelete(null)
        }}
        onOk={handleDeleteConfirm}
        okText={t('agent.workflow.confirmDelete')}
        cancelText={t('agent.actions.cancel')}
        okButtonProps={{ danger: true }}
      >
        <p>
          {t('agent.workflow.deleteConfirmMsg', { name: workflowToDelete?.name })}
        </p>
        <p style={{ color: '#999', fontSize: '12px' }}>
          {t('agent.workflow.deleteWarning')}
        </p>
      </Modal>
    </div>
  )
}

export default WorkflowList
