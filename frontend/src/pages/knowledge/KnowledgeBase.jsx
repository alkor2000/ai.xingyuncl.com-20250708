/**
 * 万智魔方 - iOS风格模块组装页面
 */

import React, { useState, useEffect, useRef } from 'react'
import { 
  Layout, 
  Card, 
  Button, 
  Input,
  Space, 
  Empty,
  Spin,
  message,
  Badge,
  Tag,
  Modal,
  Dropdown,
  Tooltip,
  Popconfirm,
  Switch
} from 'antd'
import {
  AppstoreOutlined,
  PlusOutlined,
  SaveOutlined,
  ClearOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  MoreOutlined,
  CloseOutlined,
  CheckOutlined,
  LockOutlined,
  UnlockOutlined,
  EyeInvisibleOutlined,
  EyeOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import KnowledgeModuleFormModal from '../../components/knowledge/KnowledgeModuleFormModal'
import './KnowledgeBase.less'

const { Content } = Layout
const { Search } = Input

// 卡槽中的模块组件 - 修复显示三个信息
const SlotModule = ({ module, onRemove, index }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: module.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 1000 : 1
  }

  // 获取模块颜色 - 只根据module_scope决定
  const getModuleColor = () => {
    switch (module.module_scope) {
      case 'personal': return 'slot-module-blue'
      case 'team': return 'slot-module-green'
      case 'system': return 'slot-module-orange'
      default: return 'slot-module-blue'
    }
  }

  // 获取范围图标
  const getScopeIcon = () => {
    switch (module.module_scope) {
      case 'personal': return <UserOutlined />
      case 'team': return <TeamOutlined />
      case 'system': return <GlobalOutlined />
      default: return <UserOutlined />
    }
  }

  // 获取范围文本 - 系统改为全局
  const getScopeText = () => {
    switch (module.module_scope) {
      case 'personal': return '个人'
      case 'team': return '团队'
      case 'system': return '全局'  // 改为全局
      default: return '个人'
    }
  }

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`slot-module ${getModuleColor()} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      {/* 顶部标签区域 - 显示三个信息 */}
      <div className="module-badges-bar">
        {/* 系统级标识 - 这个是prompt_type，保持不变 */}
        {module.prompt_type === 'system' && (
          <Tag className="system-prompt-tag">
            <ThunderboltOutlined /> 系统级
          </Tag>
        )}
        
        {/* 锁定状态 */}
        <span className="lock-status">
          {module.content_visible ? (
            <UnlockOutlined className="unlock-icon" />
          ) : (
            <LockOutlined className="lock-icon" />
          )}
        </span>
        
        {/* 使用范围 */}
        <Tag className="scope-tag">
          {getScopeIcon()} {getScopeText()}
        </Tag>
      </div>
      
      <div className="module-content">
        <div className="module-icon">
          {getScopeIcon()}
        </div>
        <div className="module-name">{module.name}</div>
      </div>
      
      <button className="module-remove" onClick={() => onRemove(module.id)}>
        <CloseOutlined />
      </button>
    </div>
  )
}

// 模块广场卡片 - 修复颜色和信息显示
const ModuleCard = ({ module, onDragStart, onEdit, onDelete, canEdit, canDelete }) => {
  const [isDragging, setIsDragging] = useState(false)
  
  // 获取模块颜色 - 只根据module_scope决定
  const getModuleColor = () => {
    switch (module.module_scope) {
      case 'personal': return 'card-blue'
      case 'team': return 'card-green'
      case 'system': return 'card-orange'
      default: return 'card-blue'
    }
  }

  // 获取范围图标
  const getScopeIcon = () => {
    switch (module.module_scope) {
      case 'personal': return <UserOutlined />
      case 'team': return <TeamOutlined />
      case 'system': return <GlobalOutlined />
      default: return <UserOutlined />
    }
  }

  // 获取范围文本 - 系统改为全局
  const getScopeText = () => {
    switch (module.module_scope) {
      case 'personal': return '个人'
      case 'team': return '团队'
      case 'system': return '全局'  // 改为全局
      default: return '个人'
    }
  }

  // 操作菜单项
  const menuItems = []
  if (canEdit) {
    menuItems.push({
      key: 'edit',
      label: '编辑',
      icon: <EditOutlined />
    })
  }
  if (canDelete) {
    menuItems.push({
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      danger: true
    })
  }

  const handleMenuClick = ({ key }) => {
    if (key === 'edit' && onEdit) {
      onEdit(module)
    } else if (key === 'delete' && onDelete) {
      onDelete(module.id)
    }
  }

  return (
    <div 
      className={`square-module-card ${getModuleColor()} ${isDragging ? 'dragging' : ''} ${!module.is_active ? 'inactive' : ''}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('module', JSON.stringify(module))
        onDragStart(module)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      {/* 左上角显示三个信息 */}
      <div className="module-badges">
        {/* 系统级标识 - 这个是prompt_type，保持不变 */}
        {module.prompt_type === 'system' && (
          <Tag className="type-tag type-tag-purple">
            系统级
          </Tag>
        )}
        
        {/* 锁定状态 */}
        <Tooltip title={module.content_visible ? '内容可见' : '内容已隐藏'}>
          {module.content_visible ? (
            <UnlockOutlined className="unlock-icon" />
          ) : (
            <LockOutlined className="lock-icon" />
          )}
        </Tooltip>
        
        {/* 使用范围 */}
        <Tag className={`type-tag type-tag-${getModuleColor().replace('card-', '')}`}>
          {getScopeText()}
        </Tag>
      </div>

      {/* 右上角操作按钮 */}
      {menuItems.length > 0 && !isDragging && (
        <Dropdown
          menu={{ items: menuItems, onClick: handleMenuClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <button className="module-more-btn" onClick={(e) => e.stopPropagation()}>
            <MoreOutlined />
          </button>
        </Dropdown>
      )}

      {/* 模块主体内容 */}
      <div className="card-main">
        <div className="card-icon">
          {getScopeIcon()}
        </div>
        <div className="card-name">{module.name}</div>
        {/* 未激活标识 */}
        {!module.is_active && (
          <Tag className="inactive-tag" color="warning">
            已隐藏
          </Tag>
        )}
      </div>
    </div>
  )
}

// 组合卡片
const CombinationCard = ({ combination, onApply, onEdit, onDelete }) => {
  const menuItems = [
    { key: 'apply', label: '应用', icon: <CheckOutlined /> },
    { key: 'edit', label: '编辑', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
  ]

  const handleMenuClick = ({ key }) => {
    switch (key) {
      case 'apply': onApply(combination); break
      case 'edit': onEdit(combination); break
      case 'delete': onDelete(combination.id); break
    }
  }

  return (
    <div className="combination-card-ios">
      <div className="card-content">
        <div className="card-icon-large">
          <AppstoreOutlined />
        </div>
        <div className="card-info">
          <div className="card-title">{combination.name}</div>
          <div className="card-meta">
            <span>{combination.module_count || 0}个模块</span>
            <span>{combination.usage_count || 0}次使用</span>
          </div>
        </div>
      </div>
      <Dropdown 
        menu={{ items: menuItems, onClick: handleMenuClick }} 
        trigger={['click']}
        placement="bottomRight"
      >
        <button className="card-more">
          <MoreOutlined />
        </button>
      </Dropdown>
    </div>
  )
}

const KnowledgeBase = () => {
  const { user, hasRole } = useAuthStore()
  const { 
    modules, 
    combinations, 
    loading,
    getModules,
    getCombinations,
    createCombination,
    updateCombination,
    deleteCombination,
    deleteModule,
    updateModule
  } = useKnowledgeStore()

  const [canvasModules, setCanvasModules] = useState([])
  const [searchText, setSearchText] = useState('')
  const [filterScope, setFilterScope] = useState('all')
  const [showInactive, setShowInactive] = useState(false) // 添加显示隐藏模块的开关
  const [draggedModule, setDraggedModule] = useState(null)
  const [currentCombination, setCurrentCombination] = useState(null)
  const [moduleModalVisible, setModuleModalVisible] = useState(false)
  const [editingModule, setEditingModule] = useState(null)
  const [saveCombinationName, setSaveCombinationName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const canvasRef = useRef(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const canCreateTeamModule = hasRole(['super_admin', 'admin'])
  const canCreateSystemModule = hasRole(['super_admin'])

  useEffect(() => {
    loadData()
  }, [showInactive]) // 当开关变化时重新加载数据

  const loadData = async () => {
    try {
      await Promise.all([
        getModules(showInactive), // 传入是否包含隐藏模块
        getCombinations(false)
      ])
    } catch (error) {
      message.error('加载数据失败')
    }
  }

  // 判断是否可以编辑模块
  const canEditModule = (module) => {
    // 创建者可以编辑
    if (module.creator_id === user.id) return true
    // 团队管理员可以编辑团队模块
    if (module.module_scope === 'team' && canCreateTeamModule) return true
    // 超级管理员可以编辑全局模块
    if (module.module_scope === 'system' && canCreateSystemModule) return true
    return false
  }

  // 判断是否可以删除模块
  const canDeleteModule = (module) => {
    // 创建者可以删除
    if (module.creator_id === user.id) return true
    // 超级管理员可以删除任何模块
    if (canCreateSystemModule) return true
    return false
  }

  // 处理编辑模块
  const handleEditModule = (module) => {
    setEditingModule(module)
    setModuleModalVisible(true)
  }

  // 处理删除模块
  const handleDeleteModule = async (moduleId) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个模块吗？',
      onOk: async () => {
        try {
          await deleteModule(moduleId)
          message.success('删除成功')
          getModules(showInactive)
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 过滤模块
  const filteredModules = modules.filter(module => {
    // 根据开关决定是否显示隐藏的模块
    if (!showInactive && !module.is_active) return false
    
    if (searchText && !module.name.toLowerCase().includes(searchText.toLowerCase())) {
      return false
    }
    if (filterScope !== 'all' && module.module_scope !== filterScope) {
      return false
    }
    if (canvasModules.find(m => m.id === module.id)) {
      return false
    }
    return true
  })

  // 处理拖拽
  const handleDragStart = (module) => {
    setDraggedModule(module)
  }

  const handleCanvasDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const moduleData = e.dataTransfer.getData('module')
    if (moduleData) {
      const module = JSON.parse(moduleData)
      if (!canvasModules.find(m => m.id === module.id)) {
        if (canvasModules.length >= 5) {
          message.warning('最多只能添加5个模块')
          return
        }
        setCanvasModules([...canvasModules, module])
        message.success('模块已添加')
      }
    }
  }

  const handleCanvasDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleCanvasDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      const oldIndex = canvasModules.findIndex(m => m.id === active.id)
      const newIndex = canvasModules.findIndex(m => m.id === over.id)
      setCanvasModules(arrayMove(canvasModules, oldIndex, newIndex))
    }
  }

  const handleRemoveModule = (moduleId) => {
    setCanvasModules(canvasModules.filter(m => m.id !== moduleId))
  }

  const handleClearCanvas = () => {
    Modal.confirm({
      title: '确认清空',
      content: '确定要清空所有模块吗？',
      onOk: () => {
        setCanvasModules([])
        setCurrentCombination(null)
      }
    })
  }

  const handleSaveCombination = async () => {
    if (canvasModules.length === 0) {
      message.warning('请先添加模块')
      return
    }
    
    if (currentCombination) {
      Modal.confirm({
        title: '更新组合',
        content: `确定要更新"${currentCombination.name}"吗？`,
        onOk: async () => {
          try {
            await updateCombination(currentCombination.id, {
              module_ids: canvasModules.map(m => m.id)
            })
            message.success('更新成功')
            getCombinations(false)
          } catch (error) {
            message.error('更新失败')
          }
        }
      })
    } else {
      setSaveCombinationName('')
      setSaveDescription('')
      setShowSaveModal(true)
    }
  }

  const handleConfirmSave = async () => {
    if (!saveCombinationName.trim()) {
      message.warning('请输入组合名称')
      return
    }

    try {
      await createCombination({
        name: saveCombinationName,
        description: saveDescription,
        module_ids: canvasModules.map(m => m.id),
        is_active: true
      })
      message.success('保存成功')
      setShowSaveModal(false)
      setSaveCombinationName('')
      setSaveDescription('')
      getCombinations(false)
    } catch (error) {
      message.error('保存失败')
    }
  }

  const handleApplyCombination = (combination) => {
    if (combination.modules && combination.modules.length > 0) {
      setCanvasModules([...combination.modules])
      setCurrentCombination(combination)
      message.success(`已应用：${combination.name}`)
    }
  }

  const handleDeleteCombination = async (combinationId) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个组合吗？',
      onOk: async () => {
        try {
          await deleteCombination(combinationId)
          message.success('删除成功')
          getCombinations(false)
          if (currentCombination?.id === combinationId) {
            setCurrentCombination(null)
          }
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  return (
    <div className="knowledge-wizard-ios">
      {/* 顶部标题栏 */}
      <div className="wizard-header">
        <div className="header-left">
          <h1>万智魔方</h1>
          {currentCombination && (
            <Tag color="blue">编辑: {currentCombination.name}</Tag>
          )}
        </div>
      </div>

      {/* 主体区域 */}
      <div className="wizard-body">
        {/* 左侧模块广场 */}
        <div className="panel-left">
          <div className="panel-header">
            <h3>模块广场</h3>
            <Badge count={filteredModules.length} showZero />
          </div>
          
          <div className="panel-content">
            <Search
              placeholder="搜索模块"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="search-input"
            />
            
            <div className="filter-controls">
              <div className="filter-tags">
                {/* 过滤器标签 - 系统改为全局 */}
                {['all', 'personal', 'team', 'system'].map(scope => (
                  <Tag
                    key={scope}
                    className={`filter-tag ${filterScope === scope ? 'active' : ''}`}
                    onClick={() => setFilterScope(scope)}
                  >
                    {scope === 'all' ? '全部' : 
                     scope === 'personal' ? '个人' :
                     scope === 'team' ? '团队' : '全局'}
                  </Tag>
                ))}
              </div>
              
              {/* 显示隐藏模块的开关 */}
              <div className="show-inactive-switch">
                <Switch
                  size="small"
                  checked={showInactive}
                  onChange={setShowInactive}
                  checkedChildren={<EyeOutlined />}
                  unCheckedChildren={<EyeInvisibleOutlined />}
                />
                <span className="switch-label">显示隐藏模块</span>
              </div>
            </div>
            
            <div className="module-grid">
              {loading ? (
                <div className="loading-center">
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} />} />
                </div>
              ) : filteredModules.length > 0 ? (
                filteredModules.map(module => (
                  <ModuleCard
                    key={module.id}
                    module={module}
                    onDragStart={handleDragStart}
                    onEdit={handleEditModule}
                    onDelete={handleDeleteModule}
                    canEdit={canEditModule(module)}
                    canDelete={canDeleteModule(module)}
                  />
                ))
              ) : (
                <Empty description={showInactive ? "暂无模块" : "暂无激活的模块"} />
              )}
            </div>
          </div>
        </div>

        {/* 中间模块组装 */}
        <div className="panel-center">
          <div className="panel-header">
            <div className="header-title">
              <h3>模块组装</h3>
              {canvasModules.length > 0 && (
                <Badge count={canvasModules.length} style={{ backgroundColor: '#52c41a' }} />
              )}
            </div>
            <div className="header-actions">
              <Button 
                size="small"
                icon={<PlusOutlined />} 
                onClick={() => {
                  setEditingModule(null)
                  setModuleModalVisible(true)
                }}
              >
                新建
              </Button>
              <Button 
                size="small"
                type="primary"
                icon={<SaveOutlined />} 
                onClick={handleSaveCombination}
              >
                保存
              </Button>
              <Button 
                size="small"
                icon={<ClearOutlined />} 
                onClick={handleClearCanvas}
              >
                清空
              </Button>
            </div>
          </div>
          
          <div 
            className={`slots-container ${isDragOver ? 'drag-over' : ''}`}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={canvasModules.map(m => m.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="slots-wrapper">
                  {/* 渲染5个卡槽 */}
                  {[0, 1, 2, 3, 4].map(index => (
                    <div key={`slot-${index}`} className="module-slot">
                      {canvasModules[index] ? (
                        <SlotModule 
                          module={canvasModules[index]}
                          onRemove={handleRemoveModule}
                          index={index}
                        />
                      ) : (
                        <div className="empty-slot">
                          <div className="slot-number">{index + 1}</div>
                          <div className="slot-hint">拖拽模块到此处</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* 右侧组合列表 */}
        <div className="panel-right">
          <div className="panel-header">
            <h3>我的组合</h3>
            <Badge count={combinations.length} showZero />
          </div>
          
          <div className="panel-content">
            <div className="combination-grid">
              {loading ? (
                <div className="loading-center">
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} />} />
                </div>
              ) : combinations.length > 0 ? (
                combinations.map(combination => (
                  <CombinationCard
                    key={combination.id}
                    combination={combination}
                    onApply={handleApplyCombination}
                    onEdit={(c) => {
                      handleApplyCombination(c)
                      message.info('已加载到组装区')
                    }}
                    onDelete={handleDeleteCombination}
                  />
                ))
              ) : (
                <Empty description="暂无组合" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 模块表单 */}
      <KnowledgeModuleFormModal
        visible={moduleModalVisible}
        module={editingModule}
        onCancel={() => {
          setModuleModalVisible(false)
          setEditingModule(null)
        }}
        onSuccess={() => {
          setModuleModalVisible(false)
          setEditingModule(null)
          getModules(showInactive)
        }}
        canCreateTeam={canCreateTeamModule}
        canCreateSystem={canCreateSystemModule}
      />

      {/* 保存组合弹窗 */}
      <Modal
        title="保存组合"
        open={showSaveModal}
        onOk={handleConfirmSave}
        onCancel={() => setShowSaveModal(false)}
        className="ios-modal"
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            组合名称 <span style={{ color: '#ff4d4f' }}>*</span>
          </label>
          <Input
            placeholder="请输入组合名称"
            value={saveCombinationName}
            onChange={(e) => setSaveCombinationName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            组合描述
          </label>
          <Input.TextArea
            placeholder="请输入组合描述（选填）"
            value={saveDescription}
            onChange={(e) => setSaveDescription(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}

export default KnowledgeBase
