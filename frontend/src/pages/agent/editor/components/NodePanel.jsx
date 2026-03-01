/**
 * 节点面板 - 浮动弹窗模式
 * v2.1 - 扩展节点彩色显示
 * v2.2 - 添加问题分类节点
 * v2.3 - 改为拖拽添加节点
 * v3.0 - UX优化：改为浮动弹窗，左上角+按钮触发
 *   不再占用固定280px侧边栏，画布空间更大
 *   弹窗可关闭，拖拽节点到画布后自动关闭
 */

import React from 'react'
import { Button, Space, Divider, message, Tooltip } from 'antd'
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

/**
 * 节点面板组件
 * v3.0: 新增 open/onToggle/onClose 属性，支持浮动弹窗模式
 * @param {Array} nodeTypes - 从数据库加载的自定义节点类型
 * @param {Function} onAddNode - 添加节点的回调函数
 * @param {boolean} open - 弹窗是否打开
 * @param {Function} onToggle - 切换弹窗开关
 * @param {Function} onClose - 关闭弹窗
 */
const NodePanel = ({ nodeTypes, onAddNode, open, onToggle, onClose }) => {
  /**
   * 基础节点类型定义
   */
  const builtInNodes = [
    {
      type: 'start',
      label: '开始',
      icon: <PlayCircleOutlined />,
      color: '#52c41a',
      description: '工作流入口',
      available: true
    },
    {
      type: 'llm',
      label: 'LLM对话',
      icon: <RobotOutlined />,
      color: '#1890ff',
      description: 'AI大模型对话',
      available: true
    },
    {
      type: 'knowledge',
      label: '知识检索',
      icon: <DatabaseOutlined />,
      color: '#722ed1',
      description: '从知识库检索',
      available: true
    },
    {
      type: 'classifier',
      label: '问题分类',
      icon: <BranchesOutlined />,
      color: '#faad14',
      description: 'AI智能分类',
      available: true
    }
  ]
  
  /**
   * 扩展节点定义（暂未开放）
   */
  const extensionNodes = [
    { type: 'mcp', label: 'MCP 服务', icon: <ApiOutlined />, color: '#13c2c2', description: '连接外部MCP服务', available: false },
    { type: 'a2a', label: 'A2A 调用', icon: <TeamOutlined />, color: '#eb2f96', description: 'Agent间协作调用', available: false },
    { type: 'text2image', label: '文生图', icon: <PictureOutlined />, color: '#fa8c16', description: 'AI图像生成', available: false },
    { type: 'mysql', label: 'MySQL', icon: <CloudServerOutlined />, color: '#1677ff', description: '数据库查询', available: false },
    { type: 'http', label: 'HTTP请求', icon: <GlobalOutlined />, color: '#52c41a', description: '调用外部API', available: false },
    { type: 'code', label: '代码执行', icon: <CodeOutlined />, color: '#2f54eb', description: '运行Python/JS', available: false },
    { type: 'loop', label: '循环遍历', icon: <SyncOutlined />, color: '#722ed1', description: '批量处理数据', available: false },
    { type: 'timer', label: '定时触发', icon: <ClockCircleOutlined />, color: '#8c8c8c', description: '定时执行任务', available: false },
    { type: 'email', label: '邮件发送', icon: <MailOutlined />, color: '#f5222d', description: '发送通知邮件', available: false },
    { type: 'document', label: '文档解析', icon: <FileTextOutlined />, color: '#13c2c2', description: 'PDF/Word提取', available: false },
    { type: 'vector', label: '向量检索', icon: <SearchOutlined />, color: '#9254de', description: '语义相似搜索', available: false }
  ]
  
  /**
   * 处理拖拽开始事件
   */
  const handleDragStart = (event, node) => {
    if (!node.available) {
      event.preventDefault()
      message.warning({ content: '请申请模块权限', icon: <LockOutlined style={{ color: '#faad14' }} /> })
      return
    }
    event.dataTransfer.setData('application/reactflow', node.type)
    event.dataTransfer.effectAllowed = 'move'
  }
  
  /**
   * 渲染节点项（精简版，适配弹窗小空间）
   */
  const renderNodeItem = (node) => (
    <Tooltip 
      key={node.type} 
      title={!node.available ? '请申请模块权限' : '拖拽到画布添加'}
      placement="right"
    >
      <div
        className={`floating-node-item ${node.available ? 'available' : 'locked'}`}
        style={{ '--node-color': node.color }}
        draggable={node.available}
        onDragStart={(e) => handleDragStart(e, node)}
        onClick={() => !node.available && message.warning('请申请模块权限')}
      >
        <div className="floating-node-icon" style={{ color: node.color }}>
          {node.icon}
        </div>
        <div className="floating-node-info">
          <div className="floating-node-label" style={{ color: node.color }}>{node.label}</div>
          <div className="floating-node-desc">{node.description}</div>
        </div>
        <div className="floating-node-action">
          {node.available ? <DragOutlined /> : <LockOutlined style={{ color: node.color }} />}
        </div>
      </div>
    </Tooltip>
  )
  
  return (
    <>
      {/* v3.0: 左上角浮动+按钮 */}
      <div className="node-panel-trigger">
        <Tooltip title={open ? '关闭节点库' : '添加节点'} placement="right">
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
      
      {/* v3.0: 浮动节点面板 */}
      {open && (
        <div className="floating-node-panel" onClick={(e) => e.stopPropagation()}>
          {/* 面板头部 */}
          <div className="floating-panel-header">
            <span className="floating-panel-title">节点库</span>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
          </div>
          
          {/* 面板内容 - 可滚动 */}
          <div className="floating-panel-body">
            {/* 基础节点 */}
            <div className="floating-panel-section">
              <div className="floating-section-title">基础节点</div>
              {builtInNodes.map(renderNodeItem)}
            </div>
            
            <Divider style={{ margin: '8px 0' }} />
            
            {/* 扩展节点 */}
            <div className="floating-panel-section">
              <div className="floating-section-title">扩展节点</div>
              {extensionNodes.map(renderNodeItem)}
            </div>
            
            {/* 自定义节点 */}
            {nodeTypes && nodeTypes.length > 0 && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <div className="floating-panel-section">
                  <div className="floating-section-title">自定义节点</div>
                  {nodeTypes.map(nt => renderNodeItem({
                    type: nt.type_key,
                    label: nt.display_name,
                    icon: <DatabaseOutlined />,
                    color: '#1890ff',
                    description: nt.description || '',
                    available: true
                  }))}
                </div>
              </>
            )}
          </div>
          
          {/* 面板底部提示 */}
          <div className="floating-panel-footer">
            <DragOutlined /> 拖拽节点到画布
          </div>
        </div>
      )}
    </>
  )
}

export default NodePanel
