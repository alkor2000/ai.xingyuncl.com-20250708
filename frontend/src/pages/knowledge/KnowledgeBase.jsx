/**
 * 万智魔方 - iOS风格模块组装页面
 * v2.3: 模块卡片显示"被X个组合使用"引用数
 * v2.2: 支持用户自定义卡槽数量（1-20个），localStorage持久化
 * 支持国际化(i18n)
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
  LockOutlined,
  UnlockOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PlusCircleOutlined,
  FileTextOutlined,
  WarningOutlined,
  MinusOutlined,
  ApartmentOutlined
} from '@ant-design/icons'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import KnowledgeModuleFormModal from '../../components/knowledge/KnowledgeModuleFormModal'
import { formatTokenCount, getTokenStatus } from '../../utils/tokenCalculator'
import './KnowledgeBase.less'

const { Content } = Layout
const { Search } = Input

// 卡槽数量常量
const SLOT_MIN     = 1   // 最少卡槽数
const SLOT_MAX     = 20  // 最多卡槽数
const SLOT_DEFAULT = 5   // 默认卡槽数

/**
 * 获取用户卡槽数量的 localStorage key（按用户ID隔离）
 */
const getSlotCountKey = (userId) => `knowledge_slot_count_${userId}`

// ==========================================
// 卡槽中的模块组件
// ==========================================
const SlotModule = ({ module, onRemove, index }) => {
  const { t } = useTranslation()
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging
  } = useSortable({ id: module.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 1000 : 1
  }

  const getModuleColor = () => {
    switch (module.module_scope) {
      case 'personal': return 'slot-module-blue'
      case 'team':     return 'slot-module-green'
      case 'system':   return 'slot-module-orange'
      default:         return 'slot-module-blue'
    }
  }

  const getScopeIcon = () => {
    switch (module.module_scope) {
      case 'personal': return <UserOutlined />
      case 'team':     return <TeamOutlined />
      case 'system':   return <GlobalOutlined />
      default:         return <UserOutlined />
    }
  }

  const getScopeText = () => {
    switch (module.module_scope) {
      case 'personal': return t('knowledge.scope.personal')
      case 'team':     return t('knowledge.scope.team')
      case 'system':   return t('knowledge.scope.system')
      default:         return t('knowledge.scope.personal')
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
      <div className="module-badges-bar">
        {module.prompt_type === 'system' && (
          <Tag className="system-prompt-tag">
            <ThunderboltOutlined /> {t('knowledge.systemLevel')}
          </Tag>
        )}
        <span className="lock-status">
          {module.content_visible
            ? <UnlockOutlined className="unlock-icon" />
            : <LockOutlined className="lock-icon" />
          }
        </span>
        <Tag className="scope-tag">
          {getScopeIcon()} {getScopeText()}
        </Tag>
        {module.token_count > 0 && (
          <Tag className="token-tag">
            <FileTextOutlined />
            {formatTokenCount(module.token_count)}
          </Tag>
        )}
      </div>

      <div className="module-content">
        <div className="module-icon">{getScopeIcon()}</div>
        <div className="module-name">{module.name}</div>
      </div>

      <button className="module-remove" onClick={() => onRemove(module.id)}>
        <CloseOutlined />
      </button>
    </div>
  )
}

// ==========================================
// 模块广场卡片 - v2.3 新增引用数显示
// ==========================================
const ModuleCard = ({ module, onDragStart, onEdit, onDelete, canEdit, canDelete }) => {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)

  const getModuleColor = () => {
    switch (module.module_scope) {
      case 'personal': return 'card-blue'
      case 'team':     return 'card-green'
      case 'system':   return 'card-orange'
      default:         return 'card-blue'
    }
  }

  const getScopeIcon = () => {
    switch (module.module_scope) {
      case 'personal': return <UserOutlined />
      case 'team':     return <TeamOutlined />
      case 'system':   return <GlobalOutlined />
      default:         return <UserOutlined />
    }
  }

  const getScopeText = () => {
    switch (module.module_scope) {
      case 'personal': return t('knowledge.scope.personal')
      case 'team':     return t('knowledge.scope.team')
      case 'system':   return t('knowledge.scope.system')
      default:         return t('knowledge.scope.personal')
    }
  }

  // 操作菜单
  const menuItems = []
  if (canEdit)   menuItems.push({ key: 'edit',   label: t('knowledge.edit'),   icon: <EditOutlined /> })
  if (canDelete) menuItems.push({ key: 'delete', label: t('knowledge.delete'), icon: <DeleteOutlined />, danger: true })

  const handleMenuClick = ({ key }) => {
    if (key === 'edit'   && onEdit)   onEdit(module)
    if (key === 'delete' && onDelete) onDelete(module.id)
  }

  // 引用数：被多少个组合使用
  const combinationCount = module.combination_count || 0

  return (
    <div
      className={`square-module-card ${getModuleColor()} ${isDragging ? 'dragging' : ''} ${!module.is_active ? 'inactive' : ''}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('module', JSON.stringify(module))
        e.dataTransfer.setData('type', 'module')
        onDragStart(module)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      {/* 顶部标签：系统级 / 锁 / 范围 / Token */}
      <div className="module-badges">
        {module.prompt_type === 'system' && (
          <Tag className="type-tag type-tag-purple">{t('knowledge.systemLevel')}</Tag>
        )}
        <Tooltip title={module.content_visible ? t('knowledge.contentVisible') : t('knowledge.contentHidden')}>
          {module.content_visible
            ? <UnlockOutlined className="unlock-icon" />
            : <LockOutlined className="lock-icon" />
          }
        </Tooltip>
        <Tag className={`type-tag type-tag-${getModuleColor().replace('card-', '')}`}>
          {getScopeText()}
        </Tag>
        {module.token_count > 0 && (
          <Tag className="token-tag">
            <FileTextOutlined />
            {formatTokenCount(module.token_count)}
          </Tag>
        )}
      </div>

      {/* 右上角更多操作 */}
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

      {/* 图标 + 名称 */}
      <div className="card-main">
        <div className="card-icon">{getScopeIcon()}</div>
        <div className="card-name">{module.name}</div>
        {!module.is_active && (
          <Tag className="inactive-tag" color="warning">{t('knowledge.inactive')}</Tag>
        )}
      </div>

      {/* 底部引用数 - v2.3 新增 */}
      <Tooltip title={t('knowledge.combinationUsage', { count: combinationCount })}>
        <div className={`card-usage-bar ${combinationCount > 0 ? 'has-usage' : 'no-usage'}`}>
          <ApartmentOutlined className="usage-icon" />
          <span className="usage-count">
            {combinationCount > 0
              ? t('knowledge.usedInCombinations', { count: combinationCount })
              : t('knowledge.notUsed')
            }
          </span>
        </div>
      </Tooltip>
    </div>
  )
}

// ==========================================
// 组合卡片
// ==========================================
const CombinationCard = ({ combination, onEdit, onDelete }) => {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)
  const totalTokens = combination.estimated_tokens || 0

  const menuItems = [
    { key: 'edit',   label: t('knowledge.loadEdit'), icon: <EditOutlined /> },
    { key: 'delete', label: t('knowledge.delete'),   icon: <DeleteOutlined />, danger: true }
  ]

  const handleMenuClick = ({ key }) => {
    if (key === 'edit')   onEdit(combination)
    if (key === 'delete') onDelete(combination.id)
  }

  return (
    <div
      className={`combination-card-ios ${isDragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('combination', JSON.stringify(combination))
        e.dataTransfer.setData('type', 'combination')
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="card-content">
        <div className="card-icon-large"><AppstoreOutlined /></div>
        <div className="card-info">
          <div className="card-title">{combination.name}</div>
          <div className="card-meta">
            <span>{combination.module_count || 0}{t('knowledge.modules')}</span>
            <span>{combination.usage_count || 0}{t('knowledge.usageCount')}</span>
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
        <button className="card-more"><MoreOutlined /></button>
      </Dropdown>
    </div>
  )
}

// ==========================================
// 主组件
// ==========================================
const KnowledgeBase = () => {
  const { t } = useTranslation()
  const { user, hasRole } = useAuthStore()
  const {
    modules, combinations, loading,
    getModules, getCombinations,
    createCombination, updateCombination, deleteCombination,
    deleteModule, updateModule
  } = useKnowledgeStore()

  const [canvasModules, setCanvasModules]           = useState([])
  const [searchText, setSearchText]                 = useState('')
  const [filterScope, setFilterScope]               = useState('all')
  const [showInactive, setShowInactive]             = useState(false)
  const [draggedModule, setDraggedModule]           = useState(null)
  const [currentCombination, setCurrentCombination] = useState(null)
  const [moduleModalVisible, setModuleModalVisible] = useState(false)
  const [editingModule, setEditingModule]           = useState(null)
  const [saveCombinationName, setSaveCombinationName] = useState('')
  const [saveDescription, setSaveDescription]       = useState('')
  const [showSaveModal, setShowSaveModal]           = useState(false)
  const [isDragOver, setIsDragOver]                 = useState(false)

  /**
   * 卡槽数量：从 localStorage 读取（按用户ID），默认5，范围1-20
   */
  const [slotCount, setSlotCount] = useState(() => {
    if (!user?.id) return SLOT_DEFAULT
    const saved = localStorage.getItem(getSlotCountKey(user.id))
    if (saved) {
      const num = parseInt(saved, 10)
      if (!isNaN(num) && num >= SLOT_MIN && num <= SLOT_MAX) return num
    }
    return SLOT_DEFAULT
  })

  const canvasRef = useRef(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const canCreateTeamModule   = !!user.group_id
  const canCreateSystemModule = hasRole(['super_admin'])

  // 组装区总Token
  const totalCanvasTokens = useMemo(
    () => canvasModules.reduce((sum, m) => sum + (m.token_count || 0), 0),
    [canvasModules]
  )

  const tokenStatus = useMemo(
    () => getTokenStatus(totalCanvasTokens, 100000),
    [totalCanvasTokens]
  )

  useEffect(() => {
    loadData()
  }, [showInactive])

  const loadData = async () => {
    try {
      await Promise.all([
        getModules(showInactive),
        getCombinations(false)
      ])
    } catch (error) {
      message.error(t('knowledge.loadingData'))
    }
  }

  // 增加卡槽
  const handleAddSlot = () => {
    if (slotCount >= SLOT_MAX) {
      message.warning(t('knowledge.slotMax', { max: SLOT_MAX }))
      return
    }
    const next = slotCount + 1
    setSlotCount(next)
    if (user?.id) localStorage.setItem(getSlotCountKey(user.id), String(next))
  }

  // 减少卡槽（不能低于已填充数）
  const handleRemoveSlot = () => {
    if (slotCount <= SLOT_MIN) {
      message.warning(t('knowledge.slotMin', { min: SLOT_MIN }))
      return
    }
    if (slotCount <= canvasModules.length) {
      message.warning(t('knowledge.slotCannotReduce'))
      return
    }
    const next = slotCount - 1
    setSlotCount(next)
    if (user?.id) localStorage.setItem(getSlotCountKey(user.id), String(next))
  }

  const canEditModule = (module) => {
    if (hasRole(['super_admin'])) return true
    if (module.creator_id === user.id) return true
    if (module.module_scope === 'team' && module.group_id === user.group_id && hasRole(['admin'])) return true
    return false
  }

  const canDeleteModule = (module) => {
    if (hasRole(['super_admin'])) return true
    if (module.creator_id === user.id) return true
    return false
  }

  const handleEditModule = (module) => {
    setEditingModule(module)
    setModuleModalVisible(true)
  }

  const handleDeleteModule = async (moduleId) => {
    Modal.confirm({
      title:   t('knowledge.confirmDelete'),
      content: t('knowledge.confirmDeleteContent', { type: t('knowledge.module') }),
      onOk:    async () => {
        try {
          await deleteModule(moduleId)
          message.success(t('knowledge.deleteSuccess'))
          getModules(showInactive)
        } catch (error) {
          message.error(t('knowledge.deleteFailed'))
        }
      }
    })
  }

  // 过滤模块列表
  const filteredModules = modules.filter(module => {
    if (!showInactive && !module.is_active) return false
    if (searchText && !module.name.toLowerCase().includes(searchText.toLowerCase())) return false
    if (filterScope !== 'all' && module.module_scope !== filterScope) return false
    if (canvasModules.find(m => m.id === module.id)) return false
    return true
  })

  const handleDragStart = (module) => setDraggedModule(module)

  // 组装区拖入
  const handleCanvasDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)

    const dragType = e.dataTransfer.getData('type')

    if (dragType === 'module') {
      const moduleData = e.dataTransfer.getData('module')
      if (!moduleData) return
      const module = JSON.parse(moduleData)

      if (canvasModules.find(m => m.id === module.id)) return

      if (canvasModules.length >= slotCount) {
        message.warning(t('knowledge.maxModules'))
        return
      }

      const newTotalTokens = totalCanvasTokens + (module.token_count || 0)
      if (newTotalTokens > 100000) {
        message.warning(t('knowledge.tokenExceeded', {
          moduleTokens: formatTokenCount(module.token_count),
          totalTokens:  formatTokenCount(newTotalTokens)
        }))
        return
      }

      setCanvasModules([...canvasModules, module])
      message.success(t('knowledge.moduleAdded'))

    } else if (dragType === 'combination') {
      const combinationData = e.dataTransfer.getData('combination')
      if (!combinationData) return
      handleLoadCombination(JSON.parse(combinationData))
    }
  }

  const handleCanvasDragOver  = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }
  const handleCanvasDragLeave = () => setIsDragOver(false)

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
      title:   t('knowledge.confirmClear'),
      content: t('knowledge.confirmClearContent'),
      onOk:    () => {
        setCanvasModules([])
        setCurrentCombination(null)
      }
    })
  }

  const handleSaveCombination = async () => {
    if (canvasModules.length === 0) {
      message.warning(t('knowledge.pleaseAddModules'))
      return
    }
    if (totalCanvasTokens > 100000) {
      message.warning(t('knowledge.tokenLimitExceeded', { tokens: formatTokenCount(totalCanvasTokens) }))
      return
    }

    if (currentCombination) {
      Modal.confirm({
        title:   t('knowledge.updateCombination'),
        content: t('knowledge.confirmUpdate', { name: currentCombination.name }),
        onOk:    async () => {
          try {
            await updateCombination(currentCombination.id, { module_ids: canvasModules.map(m => m.id) })
            message.success(t('knowledge.updateSuccess'))
            getCombinations(false)
          } catch (error) {
            message.error(t('knowledge.updateFailed'))
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
      message.warning(t('knowledge.combinationNameRequired'))
      return
    }
    try {
      await createCombination({
        name:        saveCombinationName,
        description: saveDescription,
        module_ids:  canvasModules.map(m => m.id),
        is_active:   true
      })
      message.success(t('knowledge.saveSuccess'))
      setShowSaveModal(false)
      setSaveCombinationName('')
      setSaveDescription('')
      // 保存后刷新模块列表，更新引用数
      await Promise.all([getCombinations(false), getModules(showInactive)])
    } catch (error) {
      message.error(t('knowledge.saveFailed'))
    }
  }

  // 加载组合到组装区（自动扩展卡槽）
  const handleLoadCombination = (combination) => {
    if (combination.modules && combination.modules.length > 0) {
      if (combination.modules.length > slotCount) {
        const needed = Math.min(combination.modules.length, SLOT_MAX)
        setSlotCount(needed)
        if (user?.id) localStorage.setItem(getSlotCountKey(user.id), String(needed))
      }
      setCanvasModules([...combination.modules])
      setCurrentCombination(combination)
      message.success(t('knowledge.loadedCombination', { name: combination.name }))
    }
  }

  const handleDeleteCombination = async (combinationId) => {
    Modal.confirm({
      title:   t('knowledge.confirmDelete'),
      content: t('knowledge.confirmDeleteContent', { type: t('knowledge.combination') }),
      onOk:    async () => {
        try {
          await deleteCombination(combinationId)
          message.success(t('knowledge.deleteSuccess'))
          // 删除组合后刷新模块列表，更新引用数
          await Promise.all([getCombinations(false), getModules(showInactive)])
          if (currentCombination?.id === combinationId) setCurrentCombination(null)
        } catch (error) {
          message.error(t('knowledge.deleteFailed'))
        }
      }
    })
  }

  // ==========================================
  // 渲染
  // ==========================================
  return (
    <div className="knowledge-wizard-ios">
      {/* 顶部标题栏 */}
      <div className="wizard-header">
        <div className="header-left">
          <h1>{t('knowledge.title')}</h1>
        </div>
      </div>

      <div className="wizard-body">

        {/* ====== 左侧：模块广场 ====== */}
        <div className="panel-left">
          <div className="panel-header">
            <h3>{t('knowledge.moduleSquare')}</h3>
            <Space size={4}>
              <Badge count={filteredModules.length} showZero />
              <Tooltip title={t('knowledge.newModule')}>
                <Button
                  size="small"
                  type="text"
                  icon={<PlusCircleOutlined />}
                  onClick={() => {
                    setEditingModule(null)
                    setModuleModalVisible(true)
                  }}
                  style={{ color: '#666', fontSize: '16px', width: '24px', height: '24px' }}
                />
              </Tooltip>
            </Space>
          </div>

          {/* 搜索 + 过滤 + 隐藏开关 */}
          <div className="panel-toolbar">
            <Search
              placeholder={t('knowledge.searchModule')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ marginBottom: 6 }}
              size="small"
              prefix={<SearchOutlined />}
              allowClear
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="filter-tags" style={{ display: 'flex', gap: 4 }}>
                {['all', 'personal', 'team', 'system'].map(scope => (
                  <Tag
                    key={scope}
                    className={`filter-tag ${filterScope === scope ? 'active' : ''}`}
                    onClick={() => setFilterScope(scope)}
                    style={{ cursor: 'pointer', fontSize: '11px', padding: '2px 6px', lineHeight: '16px' }}
                  >
                    {t(`knowledge.filter.${scope}`)}
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

          {/* 模块卡片网格 */}
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
                <Empty description={
                  showInactive ? t('knowledge.noModules') : t('knowledge.noActiveModules')
                } />
              )}
            </div>
          </div>
        </div>

        {/* ====== 中间：模块组装区 ====== */}
        <div className="panel-center">
          <div className="panel-header">
            <div className="header-title">
              <h3>{t('knowledge.moduleAssembly')}</h3>
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
                  {t('knowledge.save')}
                </Button>
                <Button
                  size="small"
                  type="text"
                  icon={<ClearOutlined />}
                  onClick={handleClearCanvas}
                  style={{ fontSize: '12px' }}
                >
                  {t('knowledge.clear')}
                </Button>
              </Space>
            </div>
          </div>

          {/* Token进度条 */}
          <div className="token-progress-area">
            <div className="token-progress-wrapper">
              <div className="token-label">
                <FileTextOutlined />
                {t('knowledge.tokenUsage')}
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
                {t('knowledge.tokenLimit')}
              </div>
            )}
          </div>

          {/* 当前组合信息 */}
          <div className="panel-toolbar" style={{
            padding: '8px 12px', minHeight: '40px',
            borderBottom: '0.5px solid rgba(0,0,0,0.06)',
            backgroundColor: 'rgba(248,248,250,0.5)',
            display: 'flex', alignItems: 'center'
          }}>
            {currentCombination ? (
              <Space>
                <span style={{ color: '#666', fontSize: '12px' }}>{t('knowledge.currentAssembly')}</span>
                <Tag color="blue" style={{ margin: 0 }}>{currentCombination.name}</Tag>
                <span style={{ color: '#999', fontSize: '11px' }}>
                  {t('knowledge.originalModules', { count: currentCombination.module_count })}
                </span>
              </Space>
            ) : (
              <span style={{ color: '#999', fontSize: '12px' }}>
                {t('knowledge.dragModuleHint')}
              </span>
            )}
          </div>

          {/* 卡槽区域 */}
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
                    {Array.from({ length: slotCount }, (_, index) => (
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
                            <div className="slot-hint">{t('knowledge.dragToSlot')}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {/* 卡槽数量控制器 */}
              <div className="slot-count-control">
                <Tooltip title={
                  slotCount <= canvasModules.length
                    ? t('knowledge.slotCannotReduce')
                    : slotCount <= SLOT_MIN
                      ? t('knowledge.slotMin', { min: SLOT_MIN })
                      : t('knowledge.slotRemove')
                }>
                  <button
                    className="slot-ctrl-btn slot-ctrl-minus"
                    onClick={handleRemoveSlot}
                    disabled={slotCount <= SLOT_MIN || slotCount <= canvasModules.length}
                  >
                    <MinusOutlined />
                  </button>
                </Tooltip>

                <div className="slot-ctrl-info">
                  <span className="slot-ctrl-count">{slotCount}</span>
                  <span className="slot-ctrl-label">
                    {t('knowledge.slotCount', { max: SLOT_MAX })}
                  </span>
                </div>

                <Tooltip title={
                  slotCount >= SLOT_MAX
                    ? t('knowledge.slotMax', { max: SLOT_MAX })
                    : t('knowledge.slotAdd')
                }>
                  <button
                    className="slot-ctrl-btn slot-ctrl-plus"
                    onClick={handleAddSlot}
                    disabled={slotCount >= SLOT_MAX}
                  >
                    <PlusOutlined />
                  </button>
                </Tooltip>
              </div>

            </div>
          </div>
        </div>

        {/* ====== 右侧：我的组合 ====== */}
        <div className="panel-right">
          <div className="panel-header">
            <h3>{t('knowledge.myCombinations')}</h3>
            <Badge count={combinations.length} showZero />
          </div>

          <div className="panel-toolbar" style={{
            padding: '8px 12px', minHeight: '57px',
            borderBottom: '0.5px solid rgba(0,0,0,0.06)',
            backgroundColor: 'rgba(248,248,250,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <span style={{ color: '#999', fontSize: '11px', textAlign: 'center' }}>
              <InfoCircleOutlined /> {t('knowledge.dragCombinationHint')}
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
                <Empty description={t('knowledge.noCombinations')} />
              )}
            </div>
          </div>
        </div>

      </div>

      {/* 模块编辑弹窗 */}
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
        title={t('knowledge.saveCombination')}
        open={showSaveModal}
        onOk={handleConfirmSave}
        onCancel={() => setShowSaveModal(false)}
        className="ios-modal"
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            {t('knowledge.combinationName')} <span style={{ color: '#ff4d4f' }}>*</span>
          </label>
          <Input
            placeholder={t('knowledge.combinationNamePlaceholder')}
            value={saveCombinationName}
            onChange={(e) => setSaveCombinationName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            {t('knowledge.combinationDescription')}
          </label>
          <Input.TextArea
            placeholder={t('knowledge.combinationDescriptionPlaceholder')}
            value={saveDescription}
            onChange={(e) => setSaveDescription(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#666' }}>
            {t('knowledge.tokenStatistics')}
          </label>
          <div style={{
            padding: '8px 12px', background: '#f5f5f5', borderRadius: '4px',
            color: tokenStatus.color, fontWeight: 600, fontSize: '13px'
          }}>
            {t('knowledge.totalTokens', { tokens: formatTokenCount(totalCanvasTokens) })}
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default KnowledgeBase
