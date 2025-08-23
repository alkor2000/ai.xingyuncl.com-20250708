/**
 * 模块组合表单弹窗组件
 */

import React, { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Input,
  Switch,
  Table,
  Tag,
  Space,
  message,
  Alert,
  Card,
  Empty,
  Button,
  InputNumber,
  Tooltip,
  Progress
} from 'antd'
import {
  DeleteOutlined,
  DragOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import useKnowledgeStore from '../../stores/knowledgeStore'
import { calculateModulesTotalTokens, formatTokenCount, getTokenStatus } from '../../utils/tokenCalculator'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Search } = Input

// 可拖拽的行组件
const DraggableRow = ({ children, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props['data-row-key'],
  })

  const style = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999 } : {}),
  }

  return (
    <tr {...props} ref={setNodeRef} style={style} {...attributes}>
      {React.Children.map(children, (child) => {
        if (child.props && child.props.className === 'drag-handle') {
          return React.cloneElement(child, {
            children: (
              <div {...listeners} style={{ cursor: 'move' }}>
                <DragOutlined />
              </div>
            ),
          })
        }
        return child
      })}
    </tr>
  )
}

const ModuleCombinationFormModal = ({
  visible,
  combination,
  modules,
  onCancel,
  onSuccess
}) => {
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { createCombination, updateCombination } = useKnowledgeStore()
  const [loading, setLoading] = useState(false)
  const [selectedModules, setSelectedModules] = useState([])
  const [searchText, setSearchText] = useState('')
  const [showModuleSelector, setShowModuleSelector] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor))

  // Token上限设置为100K
  const MAX_TOKENS = 100000

  useEffect(() => {
    if (visible) {
      if (combination) {
        // 编辑模式
        form.setFieldsValue({
          name: combination.name,
          description: combination.description,
          is_active: combination.is_active
        })
        
        // 设置已选模块
        if (combination.modules && combination.modules.length > 0) {
          setSelectedModules(combination.modules.map((m, index) => ({
            ...m,
            sort_order: index
          })))
        }
      } else {
        // 创建模式
        form.resetFields()
        form.setFieldsValue({
          is_active: true
        })
        setSelectedModules([])
      }
    }
  }, [visible, combination, form])

  // 计算Token估算 - 使用新的工具函数
  const calculateEstimatedTokens = () => {
    return calculateModulesTotalTokens(selectedModules)
  }

  // 获取Token使用状态
  const getTokenUsageInfo = () => {
    const tokens = calculateEstimatedTokens()
    return getTokenStatus(tokens, MAX_TOKENS)
  }

  const handleSubmit = async (values) => {
    if (selectedModules.length === 0) {
      message.error(t('knowledge.combination.selectAtLeastOne'))
      return
    }

    // 检查Token限制
    const estimatedTokens = calculateEstimatedTokens()
    const tokenStatus = getTokenStatus(estimatedTokens, MAX_TOKENS)
    
    if (tokenStatus.isOverLimit) {
      message.error(t('knowledge.combination.tokenOverLimit', {
        current: formatTokenCount(estimatedTokens),
        max: formatTokenCount(MAX_TOKENS)
      }))
      return
    }

    setLoading(true)
    try {
      // 修正：发送简单的ID数组，字段名改为module_ids
      const moduleIds = selectedModules.map(m => m.id)

      const submitData = {
        ...values,
        module_ids: moduleIds  // 修正字段名和格式
      }

      if (combination) {
        // 更新
        await updateCombination(combination.id, submitData)
        message.success(t('common.updateSuccess'))
      } else {
        // 创建
        await createCombination(submitData)
        message.success(t('common.createSuccess'))
      }
      
      onSuccess()
    } catch (error) {
      message.error(error.message || t('common.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 添加模块
  const handleAddModule = (module) => {
    if (selectedModules.find(m => m.id === module.id)) {
      message.warning(t('knowledge.combination.moduleAlreadyAdded'))
      return
    }
    
    // 检查添加后是否会超过token限制
    const newModules = [...selectedModules, module]
    const newTokens = calculateModulesTotalTokens(newModules)
    const tokenStatus = getTokenStatus(newTokens, MAX_TOKENS)
    
    if (tokenStatus.isOverLimit) {
      message.warning(t('knowledge.combination.addModuleWillExceedLimit', {
        moduleTokens: formatTokenCount(module.token_count || 0),
        totalTokens: formatTokenCount(newTokens),
        maxTokens: formatTokenCount(MAX_TOKENS)
      }))
      return
    }
    
    setSelectedModules([...selectedModules, {
      ...module,
      sort_order: selectedModules.length
    }])
    setShowModuleSelector(false)
    setSearchText('')
  }

  // 删除模块
  const handleRemoveModule = (moduleId) => {
    setSelectedModules(selectedModules.filter(m => m.id !== moduleId))
  }

  // 拖拽排序
  const handleDragEnd = (event) => {
    const { active, over } = event

    if (active.id !== over.id) {
      const oldIndex = selectedModules.findIndex(m => m.id === active.id)
      const newIndex = selectedModules.findIndex(m => m.id === over.id)
      
      const newModules = [...selectedModules]
      const [movedItem] = newModules.splice(oldIndex, 1)
      newModules.splice(newIndex, 0, movedItem)
      
      setSelectedModules(newModules)
    }
  }

  // 过滤可选模块
  const availableModules = modules.filter(module => {
    if (!module.is_active) return false
    if (selectedModules.find(m => m.id === module.id)) return false
    if (searchText && !module.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !module.description?.toLowerCase().includes(searchText.toLowerCase())) {
      return false
    }
    return true
  })

  // 获取范围图标
  const getScopeIcon = (scope) => {
    switch (scope) {
      case 'personal':
        return <UserOutlined />
      case 'team':
        return <TeamOutlined />
      case 'system':
        return <GlobalOutlined />
      default:
        return null
    }
  }

  // 已选模块列表
  const selectedColumns = [
    {
      title: '',
      dataIndex: 'drag',
      className: 'drag-handle',
      width: 40,
      render: () => null
    },
    {
      title: t('knowledge.module.name'),
      dataIndex: 'name',
      render: (text, record) => (
        <Space size="small">
          {getScopeIcon(record.module_scope)}
          <span>{text}</span>
          {record.prompt_type === 'system' && (
            <Tag color="purple" icon={<ThunderboltOutlined />}>
              {t('knowledge.module.systemLevel')}
            </Tag>
          )}
          {!record.content_visible && record.module_scope !== 'personal' && (
            <Tag color="orange" icon={<EyeInvisibleOutlined />}>
              {t('knowledge.module.hidden')}
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: 'Tokens',
      dataIndex: 'token_count',
      width: 100,
      render: (tokens) => (
        <Tooltip title={t('knowledge.module.tokenEstimate')}>
          <span style={{ color: '#1890ff' }}>
            {formatTokenCount(tokens || 0)}
          </span>
        </Tooltip>
      )
    },
    {
      title: t('common.operation'),
      width: 60,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveModule(record.id)}
        />
      )
    }
  ]

  // 获取Token使用状态样式
  const tokenUsageInfo = getTokenUsageInfo()

  return (
    <Modal
      title={combination ? t('knowledge.combination.edit') : t('knowledge.combination.create')}
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={800}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="name"
          label={t('knowledge.combination.name')}
          rules={[{ required: true, message: t('knowledge.combination.nameRequired') }]}
        >
          <Input placeholder={t('knowledge.combination.namePlaceholder')} maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label={t('knowledge.combination.description')}
        >
          <TextArea 
            placeholder={t('knowledge.combination.descriptionPlaceholder')} 
            rows={2} 
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item label={t('knowledge.combination.includedModules')}>
          <Card size="small">
            {selectedModules.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={selectedModules.map(m => m.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table
                    dataSource={selectedModules}
                    columns={selectedColumns}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    components={{
                      body: {
                        row: DraggableRow,
                      },
                    }}
                  />
                </SortableContext>
              </DndContext>
            ) : (
              <Empty description={t('knowledge.combination.noModulesSelected')} />
            )}
            
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              {!showModuleSelector ? (
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => setShowModuleSelector(true)}
                >
                  {t('knowledge.combination.addModule')}
                </Button>
              ) : (
                <Card size="small" style={{ marginTop: 8 }}>
                  <Search
                    placeholder={t('knowledge.combination.searchModule')}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {availableModules.length > 0 ? (
                      availableModules.map(module => (
                        <div
                          key={module.id}
                          style={{ 
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f0f0f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                          onClick={() => handleAddModule(module)}
                        >
                          <div style={{ flex: 1 }}>
                            <Space size="small">
                              {getScopeIcon(module.module_scope)}
                              <span>{module.name}</span>
                              {module.prompt_type === 'system' && (
                                <Tag color="purple" size="small">
                                  {t('knowledge.module.systemLevel')}
                                </Tag>
                              )}
                            </Space>
                            {module.description && (
                              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                                {module.description}
                              </div>
                            )}
                          </div>
                          <div style={{ marginLeft: 12 }}>
                            <Tooltip title={t('knowledge.module.tokenCount')}>
                              <Tag color="blue">
                                {formatTokenCount(module.token_count || 0)}
                              </Tag>
                            </Tooltip>
                          </div>
                        </div>
                      ))
                    ) : (
                      <Empty description={t('knowledge.combination.noAvailableModules')} />
                    )}
                  </div>
                  <Button 
                    size="small" 
                    onClick={() => setShowModuleSelector(false)}
                    style={{ marginTop: 8 }}
                  >
                    {t('common.cancel')}
                  </Button>
                </Card>
              )}
            </div>
          </Card>
        </Form.Item>

        <Form.Item>
          <Alert
            message={
              <div>
                <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    <InfoCircleOutlined />
                    <span>
                      {t('knowledge.combination.tokenEstimate')}: 
                      <strong style={{ marginLeft: 8, color: tokenUsageInfo.color }}>
                        {formatTokenCount(calculateEstimatedTokens())}
                      </strong>
                      <span style={{ margin: '0 4px' }}>/</span>
                      <span>{formatTokenCount(MAX_TOKENS)}</span>
                    </span>
                  </Space>
                  <Progress 
                    percent={tokenUsageInfo.percentage} 
                    size="small" 
                    status={tokenUsageInfo.status === 'danger' ? 'exception' : 
                            tokenUsageInfo.status === 'warning' ? 'active' : 'success'}
                    strokeColor={tokenUsageInfo.color}
                    style={{ width: 200 }}
                  />
                </Space>
              </div>
            }
            type={tokenUsageInfo.status === 'danger' ? 'error' : 
                  tokenUsageInfo.status === 'warning' ? 'warning' : 'info'}
            showIcon={false}
          />
        </Form.Item>

        <Form.Item
          name="is_active"
          label={t('common.status')}
          valuePropName="checked"
        >
          <Switch 
            checkedChildren={t('common.enabled')} 
            unCheckedChildren={t('common.disabled')} 
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ModuleCombinationFormModal
