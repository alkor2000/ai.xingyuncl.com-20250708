/**
 * Agent工作流可视化编辑器
 * 基于 ReactFlow 实现拖拽式工作流编排
 * v2.2 - 修复节点名称同步问题
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { message, Spin, Drawer } from 'antd'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from 'reactflow'
import 'reactflow/dist/style.css'

import useAgentStore from '../../../stores/agentStore'
import Toolbar from './components/Toolbar'
import NodePanel from './components/NodePanel'
import ConfigPanel from './components/ConfigPanel'
import TestDrawer from './components/TestDrawer'
import StartNode from './nodes/StartNode'
import LLMNode from './nodes/LLMNode'
import EndNode from './nodes/EndNode'
import KnowledgeNode from './nodes/KnowledgeNode'
import './styles/editor.css'

// 注册自定义节点类型（保留end以兼容旧数据）
const nodeTypes = {
  start: StartNode,
  llm: LLMNode,
  end: EndNode,
  knowledge: KnowledgeNode
}

const WorkflowEditor = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const {
    currentWorkflow,
    currentWorkflowLoading,
    fetchWorkflowById,
    updateWorkflow,
    clearCurrentWorkflow,
    fetchNodeTypes,
    nodeTypes: availableNodeTypes
  } = useAgentStore()
  
  // ReactFlow 状态
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  
  // 选中的节点/边
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  
  // 是否有未保存的更改
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  
  // 测试抽屉状态
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  
  // 配置面板抽屉状态
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  
  // 保存中状态
  const [saving, setSaving] = useState(false)
  
  // 加载工作流数据
  useEffect(() => {
    if (id) {
      fetchWorkflowById(id)
      fetchNodeTypes()
    }
    
    return () => {
      clearCurrentWorkflow()
    }
  }, [id])
  
  // 初始化画布数据
  useEffect(() => {
    if (currentWorkflow?.flow_data) {
      const { nodes: flowNodes = [], edges: flowEdges = [] } = currentWorkflow.flow_data
      
      // 转换节点数据格式
      const initialNodes = flowNodes.map(node => ({
        id: node.id,
        type: node.type,
        position: node.position || { x: 0, y: 0 },
        data: {
          label: node.data?.label || node.type,
          config: node.data?.config || {}
        }
      }))
      
      // 转换边数据格式
      const initialEdges = flowEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed
        }
      }))
      
      setNodes(initialNodes)
      setEdges(initialEdges)
    }
  }, [currentWorkflow])
  
  // 连接节点
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      type: 'smoothstep',
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed
      }
    }, eds))
    setHasUnsavedChanges(true)
  }, [setEdges])
  
  // 节点选中 - 打开配置抽屉
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    // 打开配置抽屉
    setConfigDrawerOpen(true)
  }, [])
  
  // 边选中
  const onEdgeClick = useCallback((event, edge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    // 关闭配置抽屉（边没有配置）
    setConfigDrawerOpen(false)
  }, [])
  
  // 画布点击（取消选中）
  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedEdge(null)
    // 关闭配置抽屉
    setConfigDrawerOpen(false)
  }, [])
  
  // 关闭配置抽屉
  const onCloseConfigDrawer = useCallback(() => {
    setConfigDrawerOpen(false)
    // 不取消节点选中，保持高亮状态
  }, [])
  
  // 添加新节点（从节点面板拖拽）
  const onAddNode = useCallback((nodeType, position) => {
    const newNode = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position: position || { x: 100, y: 100 },
      data: {
        label: nodeType.toUpperCase(),
        config: {}
      }
    }
    
    setNodes((nds) => [...nds, newNode])
    setHasUnsavedChanges(true)
  }, [setNodes])
  
  // 删除选中的节点/边
  const onDelete = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter(n => n.id !== selectedNode.id))
      setEdges((eds) => eds.filter(e => 
        e.source !== selectedNode.id && e.target !== selectedNode.id
      ))
      setSelectedNode(null)
      setConfigDrawerOpen(false)
      setHasUnsavedChanges(true)
    }
    
    if (selectedEdge) {
      setEdges((eds) => eds.filter(e => e.id !== selectedEdge.id))
      setSelectedEdge(null)
      setHasUnsavedChanges(true)
    }
  }, [selectedNode, selectedEdge, setNodes, setEdges])
  
  // 更新节点配置（修复：同时更新label和config）
  const onUpdateNodeConfig = useCallback((nodeId, config) => {
    setNodes((nds) => 
      nds.map(node => {
        if (node.id !== nodeId) return node
        
        // 如果配置中有label，同时更新node.data.label
        const newLabel = config.label || node.data.label
        
        return {
          ...node,
          data: {
            ...node.data,
            label: newLabel,  // 同步更新显示的label
            config: config    // 保存完整配置
          }
        }
      })
    )
    
    // 同步更新selectedNode，使配置面板显示最新数据
    setSelectedNode(prev => {
      if (!prev || prev.id !== nodeId) return prev
      const newLabel = config.label || prev.data.label
      return {
        ...prev,
        data: {
          ...prev.data,
          label: newLabel,
          config: config
        }
      }
    })
    
    setHasUnsavedChanges(true)
  }, [setNodes])
  
  // 保存工作流
  const onSave = useCallback(async () => {
    if (!currentWorkflow) return
    
    setSaving(true)
    try {
      const flowData = {
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data
        })),
        edges: edges.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target
        }))
      }
      
      await updateWorkflow(currentWorkflow.id, {
        flow_data: flowData
      })
      
      setHasUnsavedChanges(false)
      message.success('工作流保存成功')
    } catch (error) {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [currentWorkflow, nodes, edges, updateWorkflow])
  
  // 打开测试抽屉
  const onTest = useCallback(() => {
    if (hasUnsavedChanges) {
      message.warning('请先保存工作流再进行测试')
      return
    }
    setTestDrawerOpen(true)
  }, [hasUnsavedChanges])
  
  // 返回列表
  const onBack = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('有未保存的更改，确定要离开吗？')) {
        navigate('/agent')
      }
    } else {
      navigate('/agent')
    }
  }, [hasUnsavedChanges, navigate])
  
  if (currentWorkflowLoading) {
    return (
      <div className="workflow-editor-loading">
        <Spin size="large" tip="加载工作流中..." />
      </div>
    )
  }
  
  if (!currentWorkflow) {
    return (
      <div className="workflow-editor-error">
        <p>工作流不存在</p>
      </div>
    )
  }
  
  return (
    <div className="workflow-editor">
      {/* 顶部工具栏 */}
      <Toolbar
        workflow={currentWorkflow}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={onSave}
        onBack={onBack}
        onDelete={onDelete}
        onTest={onTest}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
      />
      
      <div className="workflow-editor-body">
        {/* 左侧节点面板 */}
        <NodePanel
          nodeTypes={availableNodeTypes}
          onAddNode={onAddNode}
        />
        
        {/* 中间画布 - 现在占据更大空间 */}
        <div className="workflow-editor-canvas workflow-editor-canvas-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{
              padding: 0.3,
              maxZoom: 0.8
            }}
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
          >
            <Background color="#aaa" gap={16} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                switch (node.type) {
                  case 'start':
                    return '#52c41a'
                  case 'llm':
                    return '#1890ff'
                  case 'end':
                    return '#ff4d4f'
                  case 'knowledge':
                    return '#722ed1'
                  default:
                    return '#ccc'
                }
              }}
            />
          </ReactFlow>
        </div>
        
        {/* 右侧配置面板 - Drawer抽屉 */}
        <Drawer
          title={selectedNode ? `${selectedNode.data?.label || selectedNode.type} 配置` : '节点配置'}
          placement="right"
          width={360}
          onClose={onCloseConfigDrawer}
          open={configDrawerOpen}
          mask={false}
          getContainer={false}
          style={{ position: 'absolute' }}
          styles={{ body: { padding: '16px' } }}
        >
          <ConfigPanel
            selectedNode={selectedNode}
            onUpdateConfig={onUpdateNodeConfig}
            onSave={onSave}
            saving={saving}
            hasUnsavedChanges={hasUnsavedChanges}
            inDrawer={true}
          />
        </Drawer>
      </div>
      
      {/* 测试抽屉 */}
      <TestDrawer
        open={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        workflow={currentWorkflow}
        nodes={nodes}
      />
    </div>
  )
}

export default WorkflowEditor
