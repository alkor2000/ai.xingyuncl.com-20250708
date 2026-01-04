/**
 * 节点面板 - 显示可用的节点类型
 * v2.1 - 扩展节点彩色显示，点击提示"请申请模块权限"
 * v2.2 - 添加问题分类节点
 * v2.3 - 改为拖拽添加节点（解决点击添加位置不可控问题）
 * 
 * 用户通过拖拽节点到画布来添加
 */

import React from 'react'
import { Card, Space, Divider, message, Tooltip } from 'antd'
import {
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
 * @param {Array} nodeTypes - 从数据库加载的自定义节点类型
 * @param {Function} onAddNode - 添加节点的回调函数（保留用于自定义节点）
 */
const NodePanel = ({ nodeTypes, onAddNode }) => {
  /**
   * 基础节点类型定义
   * v2.2 添加了问题分类节点(classifier)
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
   * 扩展节点定义
   * 这些节点暂未开放，点击会提示申请权限
   * 彩色显示增强视觉效果
   */
  const extensionNodes = [
    {
      type: 'mcp',
      label: 'MCP 服务',
      icon: <ApiOutlined />,
      color: '#13c2c2',
      description: '连接外部MCP服务',
      available: false
    },
    {
      type: 'a2a',
      label: 'A2A 调用',
      icon: <TeamOutlined />,
      color: '#eb2f96',
      description: 'Agent间协作调用',
      available: false
    },
    {
      type: 'text2image',
      label: '文生图',
      icon: <PictureOutlined />,
      color: '#fa8c16',
      description: 'AI图像生成',
      available: false
    },
    {
      type: 'mysql',
      label: 'MySQL',
      icon: <CloudServerOutlined />,
      color: '#1677ff',
      description: '数据库查询',
      available: false
    },
    {
      type: 'http',
      label: 'HTTP请求',
      icon: <GlobalOutlined />,
      color: '#52c41a',
      description: '调用外部API',
      available: false
    },
    {
      type: 'code',
      label: '代码执行',
      icon: <CodeOutlined />,
      color: '#2f54eb',
      description: '运行Python/JS',
      available: false
    },
    {
      type: 'loop',
      label: '循环遍历',
      icon: <SyncOutlined />,
      color: '#722ed1',
      description: '批量处理数据',
      available: false
    },
    {
      type: 'timer',
      label: '定时触发',
      icon: <ClockCircleOutlined />,
      color: '#8c8c8c',
      description: '定时执行任务',
      available: false
    },
    {
      type: 'email',
      label: '邮件发送',
      icon: <MailOutlined />,
      color: '#f5222d',
      description: '发送通知邮件',
      available: false
    },
    {
      type: 'document',
      label: '文档解析',
      icon: <FileTextOutlined />,
      color: '#13c2c2',
      description: 'PDF/Word提取',
      available: false
    },
    {
      type: 'vector',
      label: '向量检索',
      icon: <SearchOutlined />,
      color: '#9254de',
      description: '语义相似搜索',
      available: false
    }
  ]
  
  /**
   * 处理拖拽开始事件
   * 将节点类型信息存入 dataTransfer，供 WorkflowEditor 的 onDrop 使用
   * @param {DragEvent} event - 拖拽事件
   * @param {Object} node - 节点配置对象
   */
  const handleDragStart = (event, node) => {
    // 不可用的扩展节点不允许拖拽
    if (!node.available) {
      event.preventDefault()
      message.warning({
        content: '请申请模块权限',
        icon: <LockOutlined style={{ color: '#faad14' }} />
      })
      return
    }
    
    // 设置拖拽数据：节点类型
    event.dataTransfer.setData('application/reactflow', node.type)
    // 设置拖拽效果
    event.dataTransfer.effectAllowed = 'move'
  }
  
  /**
   * 处理扩展节点点击（显示权限提示）
   * @param {Object} node - 节点配置对象
   */
  const handleExtensionClick = (node) => {
    if (!node.available) {
      message.warning({
        content: '请申请模块权限',
        icon: <LockOutlined style={{ color: '#faad14' }} />
      })
    }
  }
  
  /**
   * 渲染可拖拽的节点项
   * @param {Object} node - 节点配置对象
   * @returns {JSX.Element} 节点按钮元素
   */
  const renderNodeItem = (node) => {
    // 样式配置：无论是否可用都使用彩色样式
    const itemStyle = {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      border: `1px solid ${node.color}`,
      borderRadius: '6px',
      background: node.available ? '#fff' : `${node.color}08`,
      cursor: node.available ? 'grab' : 'not-allowed',
      transition: 'all 0.2s',
      marginBottom: '8px'
    }
    
    // 鼠标悬停样式（仅可用节点）
    const hoverStyle = node.available ? {
      boxShadow: `0 2px 8px ${node.color}40`
    } : {}
    
    return (
      <Tooltip 
        key={node.type} 
        title={!node.available ? '请申请模块权限' : '拖拽到画布添加'}
        placement="right"
      >
        <div
          style={itemStyle}
          draggable={node.available}
          onDragStart={(e) => handleDragStart(e, node)}
          onClick={() => !node.available && handleExtensionClick(node)}
          onMouseEnter={(e) => {
            if (node.available) {
              Object.assign(e.currentTarget.style, hoverStyle)
              e.currentTarget.style.transform = 'translateX(2px)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.transform = 'none'
          }}
        >
          {/* 节点图标 */}
          <div style={{ 
            color: node.color, 
            fontSize: '20px',
            marginRight: '10px',
            display: 'flex',
            alignItems: 'center'
          }}>
            {node.icon}
          </div>
          
          {/* 节点信息 */}
          <div style={{ flex: 1 }}>
            <div style={{ 
              fontWeight: 'bold', 
              color: node.color,
              fontSize: '14px'
            }}>
              {node.label}
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: '#999',
              marginTop: '2px'
            }}>
              {node.description}
            </div>
          </div>
          
          {/* 状态图标：可用显示拖拽图标，不可用显示锁图标 */}
          <div style={{ 
            color: node.available ? '#bbb' : node.color,
            fontSize: '14px',
            opacity: 0.6
          }}>
            {node.available ? <DragOutlined /> : <LockOutlined />}
          </div>
        </div>
      </Tooltip>
    )
  }
  
  /**
   * 渲染自定义节点（从数据库加载）
   * @param {Object} node - 数据库节点配置
   * @returns {JSX.Element} 节点元素
   */
  const renderCustomNodeItem = (node) => {
    const itemStyle = {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      border: '1px solid #d9d9d9',
      borderRadius: '6px',
      background: '#fff',
      cursor: 'grab',
      transition: 'all 0.2s',
      marginBottom: '8px'
    }
    
    /**
     * 处理自定义节点拖拽开始
     */
    const handleCustomDragStart = (event) => {
      event.dataTransfer.setData('application/reactflow', node.type_key)
      event.dataTransfer.effectAllowed = 'move'
    }
    
    return (
      <Tooltip 
        key={node.type_key} 
        title="拖拽到画布添加"
        placement="right"
      >
        <div
          style={itemStyle}
          draggable
          onDragStart={handleCustomDragStart}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
            e.currentTarget.style.transform = 'translateX(2px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.transform = 'none'
          }}
        >
          <div style={{ 
            color: '#1890ff', 
            fontSize: '20px',
            marginRight: '10px'
          }}>
            <DatabaseOutlined />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: '#333' }}>
              {node.display_name}
            </div>
            {node.description && (
              <div style={{ fontSize: '12px', color: '#999' }}>
                {node.description}
              </div>
            )}
          </div>
          <div style={{ color: '#bbb', fontSize: '14px' }}>
            <DragOutlined />
          </div>
        </div>
      </Tooltip>
    )
  }
  
  return (
    <div className="workflow-editor-node-panel">
      <Card
        title="节点库"
        size="small"
        bodyStyle={{ padding: '12px' }}
      >
        {/* 基础节点区域 */}
        <div className="node-panel-section">
          <h4 style={{ 
            margin: '0 0 8px 0', 
            fontSize: '13px', 
            color: '#666',
            fontWeight: 'normal'
          }}>
            基础节点
          </h4>
          <Space direction="vertical" style={{ width: '100%' }} size={0}>
            {builtInNodes.map(renderNodeItem)}
          </Space>
        </div>
        
        <Divider style={{ margin: '12px 0' }} />
        
        {/* 扩展节点区域（彩色显示，暂不可用） */}
        <div className="node-panel-section">
          <h4 style={{ 
            margin: '0 0 8px 0', 
            fontSize: '13px', 
            color: '#666',
            fontWeight: 'normal'
          }}>
            扩展节点
          </h4>
          <Space direction="vertical" style={{ width: '100%' }} size={0}>
            {extensionNodes.map(renderNodeItem)}
          </Space>
        </div>
        
        {/* 从数据库加载的自定义节点类型 */}
        {nodeTypes && nodeTypes.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <div className="node-panel-section">
              <h4 style={{ 
                margin: '0 0 8px 0', 
                fontSize: '13px', 
                color: '#666',
                fontWeight: 'normal'
              }}>
                自定义节点
              </h4>
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                {nodeTypes.map(renderCustomNodeItem)}
              </Space>
            </div>
          </>
        )}
        
        <Divider style={{ margin: '12px 0' }} />
        
        {/* 操作提示 */}
        <div className="node-panel-tips">
          <p style={{ 
            fontSize: '12px', 
            color: '#999', 
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <DragOutlined /> 拖拽节点到画布添加
          </p>
        </div>
      </Card>
    </div>
  )
}

export default NodePanel
