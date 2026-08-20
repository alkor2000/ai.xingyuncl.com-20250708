/**
 * 节点面板 - 浮动弹窗模式 v3.1
 *
 * v2.1 - 扩展节点彩色显示
 * v2.2 - 添加问题分类节点
 * v2.3 - 改为拖拽添加节点
 * v3.0 - UX优化：改为浮动弹窗，左上角+按钮触发，不再占用固定280px侧边栏
 * v3.1 - 国际化改造：
 *   接入 useTranslation，将节点定义中的 label / description 从硬编码中文
 *   改为 i18n 翻译键。关键实现要点：
 *   - 节点定义数组改为 useMemo 内构建，依赖 t 函数，
 *     这样语言切换后数组会重新生成，面板文案实时更新；
 *     若像原先那样定义为组件外常量或组件内普通变量，
 *     切换语言时文案不会刷新（常量在模块加载时已固化）。
 *   - 面板标题、分组标题、拖拽提示、权限提示等 6 处文案一并国际化。
 */

import React, { useMemo } from 'react'
import { Button, Divider, message, Tooltip } from 'antd'
import {
  PlusOutlined,
  CloseOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  DatabaseOutlined,
  ApiOutlined,
  TeamOutlined,
  PictureOutlined,
  CloudServerOutlined,
  GlobalOutlined,
  CodeOutlined,
  BranchesOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  MailOutlined,
  FileTextOutlined,
  SearchOutlined,
  LockOutlined,
  DragOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

/**
 * 节点面板组件
 *
 * @param {Array} nodeTypes - 从数据库加载的自定义节点类型列表
 * @param {Function} onAddNode - 添加节点的回调函数（点击方式添加时使用）
 * @param {boolean} open - 浮动面板是否打开
 * @param {Function} onToggle - 切换面板开关
 * @param {Function} onClose - 关闭面板
 */
const NodePanel = ({ nodeTypes, onAddNode, open, onToggle, onClose }) => {
  const { t } = useTranslation()

  /**
   * 基础节点类型定义（已开放使用）
   *
   * 使用 useMemo 并依赖 t：语言切换时 t 函数引用变化，
   * 数组重新构建，面板内文案随之刷新。
   */
  const builtInNodes = useMemo(() => [
    {
      type: 'start',
      label: t('agent.node.start'),
      icon: <PlayCircleOutlined />,
      color: '#52c41a',
      description: t('agent.nodeDesc.start'),
      available: true
    },
    {
      type: 'llm',
      label: t('agent.node.llm'),
      icon: <RobotOutlined />,
      color: '#1890ff',
      description: t('agent.nodeDesc.llm'),
      available: true
    },
    {
      type: 'knowledge',
      label: t('agent.node.knowledge'),
      icon: <DatabaseOutlined />,
      color: '#722ed1',
      description: t('agent.nodeDesc.knowledge'),
      available: true
    },
    {
      type: 'classifier',
      label: t('agent.node.classifier'),
      icon: <BranchesOutlined />,
      color: '#faad14',
      description: t('agent.nodeDesc.classifier'),
      available: true
    }
  ], [t])

  /**
   * 扩展节点定义（暂未开放，需申请模块权限）
   */
  const extensionNodes = useMemo(() => [
    {
      type: 'mcp',
      label: t('agent.extensionNodes.mcp'),
      icon: <ApiOutlined />,
      color: '#13c2c2',
      description: t('agent.extensionNodes.mcpDesc'),
      available: false
    },
    {
      type: 'a2a',
      label: t('agent.extensionNodes.a2a'),
      icon: <TeamOutlined />,
      color: '#eb2f96',
      description: t('agent.extensionNodes.a2aDesc'),
      available: false
    },
    {
      type: 'text2image',
      label: t('agent.extensionNodes.text2image'),
      icon: <PictureOutlined />,
      color: '#fa8c16',
      description: t('agent.extensionNodes.text2imageDesc'),
      available: false
    },
    {
      type: 'mysql',
      label: t('agent.extensionNodes.mysql'),
      icon: <CloudServerOutlined />,
      color: '#1677ff',
      description: t('agent.extensionNodes.mysqlDesc'),
      available: false
    },
    {
      type: 'http',
      label: t('agent.extensionNodes.http'),
      icon: <GlobalOutlined />,
      color: '#52c41a',
      description: t('agent.extensionNodes.httpDesc'),
      available: false
    },
    {
      type: 'code',
      label: t('agent.extensionNodes.code'),
      icon: <CodeOutlined />,
      color: '#2f54eb',
      description: t('agent.extensionNodes.codeDesc'),
      available: false
    },
    {
      type: 'loop',
      label: t('agent.extensionNodes.loop'),
      icon: <SyncOutlined />,
      color: '#722ed1',
      description: t('agent.extensionNodes.loopDesc'),
      available: false
    },
    {
      type: 'timer',
      label: t('agent.extensionNodes.timer'),
      icon: <ClockCircleOutlined />,
      color: '#8c8c8c',
      description: t('agent.extensionNodes.timerDesc'),
      available: false
    },
    {
      type: 'email',
      label: t('agent.extensionNodes.email'),
      icon: <MailOutlined />,
      color: '#f5222d',
      description: t('agent.extensionNodes.emailDesc'),
      available: false
    },
    {
      type: 'document',
      label: t('agent.extensionNodes.document'),
      icon: <FileTextOutlined />,
      color: '#13c2c2',
      description: t('agent.extensionNodes.documentDesc'),
      available: false
    },
    {
      type: 'vector',
      label: t('agent.extensionNodes.vector'),
      icon: <SearchOutlined />,
      color: '#9254de',
      description: t('agent.extensionNodes.vectorDesc'),
      available: false
    }
  ], [t])

  /**
   * 处理拖拽开始事件
   * 未开放的节点阻止拖拽并提示申请权限
   */
  const handleDragStart = (event, node) => {
    if (!node.available) {
      event.preventDefault()
      message.warning({
        content: t('agent.nodePanel.requestPermission'),
        icon: <LockOutlined style={{ color: '#faad14' }} />
      })
      return
    }
    event.dataTransfer.setData('application/reactflow', node.type)
    event.dataTransfer.effectAllowed = 'move'
  }

  /**
   * 渲染单个节点项（精简版，适配浮动弹窗的紧凑空间）
   */
  const renderNodeItem = (node) => (
    <Tooltip
      key={node.type}
      title={
        !node.available
          ? t('agent.nodePanel.requestPermission')
          : t('agent.nodePanel.dragToAdd')
      }
      placement="right"
    >
      <div
        className={`floating-node-item ${node.available ? 'available' : 'locked'}`}
        style={{ '--node-color': node.color }}
        draggable={node.available}
        onDragStart={(e) => handleDragStart(e, node)}
        onClick={() =>
          !node.available && message.warning(t('agent.nodePanel.requestPermission'))
        }
      >
        <div className="floating-node-icon" style={{ color: node.color }}>
          {node.icon}
        </div>
        <div className="floating-node-info">
          <div className="floating-node-label" style={{ color: node.color }}>
            {node.label}
          </div>
          <div className="floating-node-desc">{node.description}</div>
        </div>
        <div className="floating-node-action">
          {node.available ? (
            <DragOutlined />
          ) : (
            <LockOutlined style={{ color: node.color }} />
          )}
        </div>
      </div>
    </Tooltip>
  )

  return (
    <>
      {/* 左上角浮动触发按钮 */}
      <div className="node-panel-trigger">
        <Tooltip
          title={
            open
              ? t('agent.nodePanel.closeLibrary')
              : t('agent.nodePanel.addNode')
          }
          placement="right"
        >
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={open ? <CloseOutlined /> : <PlusOutlined />}
            onClick={onToggle}
            className={`node-panel-trigger-btn ${open ? 'active' : ''}`}
          />
        </Tooltip>
      </div>

      {/* 浮动节点面板主体 */}
      {open && (
        <div className="floating-node-panel" onClick={(e) => e.stopPropagation()}>
          {/* 面板头部：标题 + 关闭按钮 */}
          <div className="floating-panel-header">
            <span className="floating-panel-title">
              {t('agent.nodePanel.title')}
            </span>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={onClose}
            />
          </div>

          {/* 面板内容区（可滚动） */}
          <div className="floating-panel-body">
            {/* 基础节点分组 */}
            <div className="floating-panel-section">
              <div className="floating-section-title">
                {t('agent.node.basic')}
              </div>
              {builtInNodes.map(renderNodeItem)}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            {/* 扩展节点分组 */}
            <div className="floating-panel-section">
              <div className="floating-section-title">
                {t('agent.node.extension')}
              </div>
              {extensionNodes.map(renderNodeItem)}
            </div>

            {/* 自定义节点分组：仅在数据库中配置了自定义节点类型时显示 */}
            {nodeTypes && nodeTypes.length > 0 && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <div className="floating-panel-section">
                  <div className="floating-section-title">
                    {t('agent.node.custom')}
                  </div>
                  {nodeTypes.map(nt =>
                    renderNodeItem({
                      type: nt.type_key,
                      /* 自定义节点的名称与描述由管理员在后台录入，属于业务数据，不做翻译 */
                      label: nt.display_name,
                      icon: <DatabaseOutlined />,
                      color: '#1890ff',
                      description: nt.description || '',
                      available: true
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {/* 面板底部拖拽提示 */}
          <div className="floating-panel-footer">
            <DragOutlined /> {t('agent.nodePanel.dragHint')}
          </div>
        </div>
      )}
    </>
  )
}

export default NodePanel
