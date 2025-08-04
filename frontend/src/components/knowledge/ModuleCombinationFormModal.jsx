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
  Tooltip
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
  const { createCombination, updateCombination } = useKnowledgeStore()
  const [loading, setLoading] = useState(false)
  const [selectedModules, setSelectedModules] = useState([])
  const [searchText, setSearchText] = useState('')
  const [showModuleSelector, setShowModuleSelector] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor))

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

  // 计算Token估算
  const calculateEstimatedTokens = () => {
    let tokens = 0
    selectedModules.forEach(module => {
      // 简单估算：每个字符约0.5个token
      tokens += Math.ceil((module.content?.length || 0) * 0.5)
    })
    return tokens
  }

  const handleSubmit = async (values) => {
    if (selectedModules.length === 0) {
      message.error('请至少选择一个模块')
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
        message.success('更新成功')
      } else {
        // 创建
        await createCombination(submitData)
        message.success('创建成功')
      }
      
      onSuccess()
    } catch (error) {
      message.error(error.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  // 添加模块
  const handleAddModule = (module) => {
    if (selectedModules.find(m => m.id === module.id)) {
      message.warning('该模块已添加')
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
      title: '模块名称',
      dataIndex: 'name',
      render: (text, record) => (
        <Space size="small">
          {getScopeIcon(record.module_scope)}
          <span>{text}</span>
          {record.prompt_type === 'system' && (
            <Tag color="purple" icon={<ThunderboltOutlined />}>系统级</Tag>
          )}
          {!record.content_visible && record.module_scope !== 'personal' && (
            <Tag color="orange" icon={<EyeInvisibleOutlined />}>隐藏</Tag>
          )}
        </Space>
      )
    },
    {
      title: '操作',
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

  return (
    <Modal
      title={combination ? '编辑模块组合' : '创建模块组合'}
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
          label="组合名称"
          rules={[{ required: true, message: '请输入组合名称' }]}
        >
          <Input placeholder="请输入组合名称" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label="组合描述"
        >
          <TextArea 
            placeholder="请输入组合描述" 
            rows={2} 
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item label="包含模块">
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
              <Empty description="暂未选择模块" />
            )}
            
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              {!showModuleSelector ? (
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => setShowModuleSelector(true)}
                >
                  添加模块
                </Button>
              ) : (
                <Card size="small" style={{ marginTop: 8 }}>
                  <Search
                    placeholder="搜索模块"
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
                            borderBottom: '1px solid #f0f0f0'
                          }}
                          onClick={() => handleAddModule(module)}
                        >
                          <Space size="small">
                            {getScopeIcon(module.module_scope)}
                            <span>{module.name}</span>
                            {module.prompt_type === 'system' && (
                              <Tag color="purple" size="small">系统级</Tag>
                            )}
                          </Space>
                          {module.description && (
                            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                              {module.description}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <Empty description="没有可用的模块" />
                    )}
                  </div>
                  <Button 
                    size="small" 
                    onClick={() => setShowModuleSelector(false)}
                    style={{ marginTop: 8 }}
                  >
                    取消
                  </Button>
                </Card>
              )}
            </div>
          </Card>
        </Form.Item>

        <Form.Item>
          <Alert
            message={
              <Space>
                <InfoCircleOutlined />
                Token 估算：{calculateEstimatedTokens()} tokens
              </Space>
            }
            type="info"
            showIcon={false}
          />
        </Form.Item>

        <Form.Item
          name="is_active"
          label="状态"
          valuePropName="checked"
        >
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ModuleCombinationFormModal
