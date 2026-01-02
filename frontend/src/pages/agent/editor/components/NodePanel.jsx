/**
 * 节点面板 - 显示可用的节点类型
 * v2.1 - 扩展节点彩色显示，点击提示"请申请模块权限"
 * v2.2 - 添加问题分类节点
 * 用户可以点击添加到画布
 */

import React from 'react'
import { Card, Space, Button, Divider, message, Tooltip } from 'antd'
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
  LockOutlined
} from '@ant-design/icons'

const NodePanel = ({ nodeTypes, onAddNode }) => {
  // 基础节点类型（v2.2 添加问题分类）
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
  
  // 扩展节点（彩色显示，点击提示申请权限）
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
  
  // 处理节点点击
  const handleAddNode = (node) => {
    if (!node.available) {
      // 扩展节点提示申请权限
      message.warning({
        content: '请申请模块权限',
        icon: <LockOutlined style={{ color: '#faad14' }} />
      })
      return
    }
    
    // 在画布中心位置添加节点
    const position = {
      x: Math.random() * 300 + 100,
      y: Math.random() * 300 + 100
    }
    onAddNode(node.type, position)
  }
  
  // 渲染节点按钮
  const renderNodeButton = (node) => {
    // 无论是否可用，都使用彩色样式
    const buttonStyle = {
      borderColor: node.color,
      color: node.color,
      textAlign: 'left',
      height: 'auto',
      padding: '8px 12px',
      background: node.available ? '#fff' : `${node.color}08`
    }
    
    return (
      <Tooltip 
        key={node.type} 
        title={!node.available ? '请申请模块权限' : null}
        placement="right"
      >
        <Button
          block
          icon={node.icon}
          style={buttonStyle}
          onClick={() => handleAddNode(node)}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>{node.label}</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                {node.description}
              </div>
            </div>
            {!node.available && (
              <LockOutlined style={{ color: node.color, fontSize: '14px', opacity: 0.6 }} />
            )}
          </div>
        </Button>
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
        {/* 基础节点 */}
        <div className="node-panel-section">
          <h4>基础节点</h4>
          <Space direction="vertical" style={{ width: '100%' }}>
            {builtInNodes.map(renderNodeButton)}
          </Space>
        </div>
        
        <Divider style={{ margin: '12px 0' }} />
        
        {/* 扩展节点（彩色显示） */}
        <div className="node-panel-section">
          <h4>扩展节点</h4>
          <Space direction="vertical" style={{ width: '100%' }}>
            {extensionNodes.map(renderNodeButton)}
          </Space>
        </div>
        
        {/* 从数据库加载的自定义节点类型 */}
        {nodeTypes && nodeTypes.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <div className="node-panel-section">
              <h4>自定义节点</h4>
              <Space direction="vertical" style={{ width: '100%' }}>
                {nodeTypes.map((node) => (
                  <Button
                    key={node.type_key}
                    block
                    icon={<DatabaseOutlined />}
                    onClick={() => onAddNode(node.type_key)}
                  >
                    {node.display_name}
                  </Button>
                ))}
              </Space>
            </div>
          </>
        )}
        
        <Divider style={{ margin: '12px 0' }} />
        <div className="node-panel-tips">
          <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
            💡 点击节点添加到画布
          </p>
        </div>
      </Card>
    </div>
  )
}

export default NodePanel
