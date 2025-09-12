/**
 * 万智魔方 - iOS风格模块组装页面
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  Switch,
  Divider,
  Progress
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
  EyeOutlined,
  InfoCircleOutlined,
  FilterOutlined,
  PlusCircleOutlined,
  FileTextOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import KnowledgeModuleFormModal from '../../components/knowledge/KnowledgeModuleFormModal'
import { formatTokenCount, getTokenStatus } from '../../utils/tokenCalculator'
import './KnowledgeBase.less'

const { Content } = Layout
const { Search } = Input

// 卡槽中的模块组件 - Token显示在顶部
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
      {/* 顶部标签区域 - 显示所有信息包括token */}
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
        
        {/* Token显示 - 移到顶部标签栏 */}
        {module.token_count > 0 && (
          <Tag className="token-tag">
            <FileTextOutlined />
            {formatTokenCount(module.token_count)}
          </Tag>
        )}
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

// 模块广场卡片 - Token显示在顶部
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
        e.dataTransfer.setData('type', 'module')  // 标识拖拽类型
        onDragStart(module)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      {/* 顶部显示所有信息 - 包括token */}
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
        
        {/* Token显示 - 移到顶部 */}
        {module.token_count > 0 && (
          <Tag className="token-tag">
            <FileTextOutlined />
            {formatTokenCount(module.token_count)}
          </Tag>
        )}
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

// 组合卡片 - 可拖拽，显示token
const CombinationCard = ({ combination, onEdit, onDelete }) => {
  const [isDragging, setIsDragging] = useState(false)
  
  // 计算组合的总token数
  const totalTokens = combination.estimated_tokens || 0
  
  // 只保留编辑和删除
  const menuItems = [
    { key: 'edit', label: '加载编辑', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
  ]

  const handleMenuClick = ({ key }) => {
    switch (key) {
      case 'edit': onEdit(combination); break
      case 'delete': onDelete(combination.id); break
    }
  }

  return (
    <div 
      className={`combination-card-ios ${isDragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('combination', JSON.stringify(combination))
        e.dataTransfer.setData('type', 'combination')  // 标识拖拽类型
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="card-content">
        <div className="card-icon-large">
          <AppstoreOutlined />
        </div>
        <div className="card-info">
          <div className="card-title">{combination.name}</div>
          <div className="card-meta">
            <span>{combination.module_count || 0}个模块</span>
            <span>{combination.usage_count || 0}次使用</span>
            {totalTokens > 0 && (
              <span className="token-info">
                <FileTextOutlined /> {formatTokenCount(totalTokens)}
              </span>
            )}
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

  // 修改权限判断：所有组内用户都可以创建团队模块
  const canCreateTeamModule = !!user.group_id  // 只要用户属于某个组就可以创建团队模块
  const canCreateSystemModule = hasRole(['super_admin'])

  // 计算当前canvas中模块的总token数
  const totalCanvasTokens = useMemo(() => {
    return canvasModules.reduce((sum, module) => sum + (module.token_count || 0), 0)
  }, [canvasModules])

  // 获取token状态
  const tokenStatus = useMemo(() => {
    return getTokenStatus(totalCanvasTokens, 100000)
  }, [totalCanvasTokens])

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
  // 修复：超级管理员可以编辑所有模块
  const canEditModule = (module) => {
    // 超级管理员可以编辑所有模块
    if (hasRole(['super_admin'])) return true
    
    // 创建者可以编辑自己的模块
    if (module.creator_id === user.id) return true
    
    // 团队管理员可以编辑本组的团队模块
    if (module.module_scope === 'team' && module.group_id === user.group_id && hasRole(['admin'])) {
      return true
    }
    
    return false
  }

  // 判断是否可以删除模块
  // 修复：超级管理员可以删除所有模块
  const canDeleteModule = (module) => {
    // 超级管理员可以删除所有模块
    if (hasRole(['super_admin'])) return true
    
    // 创建者可以删除自己的模块
    if (module.creator_id === user.id) return true
    
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

  // 修改处理拖入，支持模块和组合
  const handleCanvasDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const dragType = e.dataTransfer.getData('type')
    
    if (dragType === 'module') {
      // 处理模块拖入
      const moduleData = e.dataTransfer.getData('module')
      if (moduleData) {
        const module = JSON.parse(moduleData)
        if (!canvasModules.find(m => m.id === module.id)) {
          if (canvasModules.length >= 5) {
            message.warning('最多只能添加5个模块')
            return
          }
          
          // 检查token是否超限
          const newTotalTokens = totalCanvasTokens + (module.token_count || 0)
          if (newTotalTokens > 100000) {
            message.warning(`添加此模块(${formatTokenCount(module.token_count)})后，总Token数(${formatTokenCount(newTotalTokens)})将超过限制(100K)`)
            return
          }
          
          setCanvasModules([...canvasModules, module])
          message.success('模块已添加')
        }
      }
    } else if (dragType === 'combination') {
      // 处理组合拖入
      const combinationData = e.dataTransfer.getData('combination')
      if (combinationData) {
        const combination = JSON.parse(combinationData)
        handleLoadCombination(combination)
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
    
    // 检查token是否超限
    if (totalCanvasTokens > 100000) {
      message.warning(`当前总Token数(${formatTokenCount(totalCanvasTokens)})超过限制(100K)，请减少模块`)
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

  // 加载组合到编辑区
  const handleLoadCombination = (combination) => {
    if (combination.modules && combination.modules.length > 0) {
      setCanvasModules([...combination.modules])
      setCurrentCombination(combination)
      message.success(`已加载组合：${combination.name}`)
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
      {/* 顶部标题栏 - 移除编辑状态显示 */}
      <div className="wizard-header">
        <div className="header-left">
          <h1>万智魔方</h1>
        </div>
      </div>

      {/* 主体区域 */}
      <div className="wizard-body">
        {/* 左侧模块广场 */}
        <div className="panel-left">
          <div className="panel-header">
            <h3>模块广场</h3>
            <Space size={4}>
              <Badge count={filteredModules.length} showZero />
              {/* 新建模块按钮改为图标按钮，降低视觉权重 */}
              <Tooltip title="新建模块">
                <Button 
                  size="small"
                  type="text"
                  icon={<PlusCircleOutlined />} 
                  onClick={() => {
                    setEditingModule(null)
                    setModuleModalVisible(true)
                  }}
                  style={{ 
                    color: '#666',
                    fontSize: '16px',
                    width: '24px',
                    height: '24px'
                  }}
                />
              </Tooltip>
            </Space>
          </div>
          
          {/* 添加工具栏区域，统一高度 */}
          <div className="panel-toolbar" style={{
            padding: '8px 12px',
            borderBottom: '0.5px solid rgba(0, 0, 0, 0.06)',
            backgroundColor: 'rgba(248, 248, 250, 0.5)'
          }}>
            <Search
              placeholder="搜索模块"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ marginBottom: 8 }}
              size="small"
              prefix={<SearchOutlined />}
            />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="filter-tags" style={{ display: 'flex', gap: 4 }}>
                {['all', 'personal', 'team', 'system'].map(scope => (
                  <Tag
                    key={scope}
                    className={`filter-tag ${filterScope === scope ? 'active' : ''}`}
                    onClick={() => setFilterScope(scope)}
                    style={{ 
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '2px 6px',
                      lineHeight: '16px'
                    }}
                  >
                    {scope === 'all' ? '全部' : 
                     scope === 'personal' ? '个人' :
                     scope === 'team' ? '团队' : '全局'}
                  </Tag>
                ))}
              </div>
              
              <Switch
                size="small"
                checked={showInactive}
                onChange={setShowInactive}
                checkedChildren={<EyeOutlined />}
                unCheckedChildren={<EyeInvisibleOutlined />}
              />
            </div>
          </div>
          
          <div className="panel-content">
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
              <Space size={4}>
                <Button 
                  size="small"
                  type="default"
                  icon={<SaveOutlined />} 
                  onClick={handleSaveCombination}
                  style={{ fontSize: '12px' }}
                  disabled={totalCanvasTokens > 100000}
                >
                  保存
                </Button>
                <Button 
                  size="small"
                  type="text"
                  icon={<ClearOutlined />} 
                  onClick={handleClearCanvas}
                  style={{ fontSize: '12px' }}
                >
                  清空
                </Button>
              </Space>
            </div>
          </div>
          
          {/* Token进度条 */}
          <div className="token-progress-area">
            <div className="token-progress-wrapper">
              <div className="token-label">
                <FileTextOutlined />
                Token使用
              </div>
              <Progress 
                percent={tokenStatus.percentage}
                strokeColor={tokenStatus.color}
                size="small"
                showInfo={false}
              />
              <div className="token-value" style={{ color: tokenStatus.color }}>
                {formatTokenCount(totalCanvasTokens)}/100K
              </div>
            </div>
            {totalCanvasTokens > 100000 && (
              <div className="token-warning">
                <WarningOutlined />
                Token数超过限制，请减少模块
              </div>
            )}
          </div>
          
          {/* 组合信息工具栏 */}
          <div className="panel-toolbar" style={{
            padding: '8px 12px',
            minHeight: '40px',
            borderBottom: '0.5px solid rgba(0, 0, 0, 0.06)',
            backgroundColor: 'rgba(248, 248, 250, 0.5)',
            display: 'flex',
            alignItems: 'center'
          }}>
            {currentCombination ? (
              <Space>
                <span style={{ color: '#666', fontSize: '12px' }}>当前组装：</span>
                <Tag color="blue" style={{ margin: 0 }}>{currentCombination.name}</Tag>
                <span style={{ color: '#999', fontSize: '11px' }}>
                  （原{currentCombination.module_count}个模块）
                </span>
              </Space>
            ) : (
              <span style={{ color: '#999', fontSize: '12px' }}>
                拖拽模块或组合到下方卡槽进行组装
              </span>
            )}
          </div>
          
          <div className="panel-content">
            <div 
              className={`slots-container ${isDragOver ? 'drag-over' : ''}`}
              onDrop={handleCanvasDrop}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              style={{ padding: '12px' }}
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
                            <div className="slot-hint">拖拽模块或组合到此处</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>

        {/* 右侧组合列表 */}
        <div className="panel-right">
          <div className="panel-header">
            <h3>我的组合</h3>
            <Badge count={combinations.length} showZero />
          </div>
          
          {/* 添加工具栏区域保持一致高度 */}
          <div className="panel-toolbar" style={{
            padding: '8px 12px',
            minHeight: '57px',
            borderBottom: '0.5px solid rgba(0, 0, 0, 0.06)',
            backgroundColor: 'rgba(248, 248, 250, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ 
              color: '#999', 
              fontSize: '11px',
              textAlign: 'center'
            }}>
              <InfoCircleOutlined /> 拖拽组合到中间区域可快速加载
            </span>
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
                    onEdit={handleLoadCombination}
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
        <div style={{ marginBottom: 16 }}>
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
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            Token统计
          </label>
          <div style={{ 
            padding: '8px 12px', 
            background: '#f5f5f5', 
            borderRadius: '4px',
            color: tokenStatus.color,
            fontWeight: 600,
            fontSize: '13px'
          }}>
            总计: {formatTokenCount(totalCanvasTokens)} / 100K限制
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default KnowledgeBase
