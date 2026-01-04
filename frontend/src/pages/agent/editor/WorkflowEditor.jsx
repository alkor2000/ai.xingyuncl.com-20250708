/**
 * Agent工作流可视化编辑器
 * 基于 ReactFlow 实现拖拽式工作流编排
 * v2.2 - 修复节点名称同步问题
 * v2.3 - 添加问题分类节点 ClassifierNode
 * v2.4 - 修复边的 sourceHandle/targetHandle 保存和加载问题
 * v2.5 - 支持从节点面板拖拽放置节点到画布
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { message, Spin, Drawer } from 'antd'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  useReactFlow,
  ReactFlowProvider
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
import ClassifierNode from './nodes/ClassifierNode'
import './styles/editor.css'

/**
 * 注册自定义节点类型
 * v2.3 添加 classifier 问题分类节点
 */
const nodeTypes = {
  start: StartNode,
  llm: LLMNode,
  end: EndNode,
  knowledge: KnowledgeNode,
  classifier: ClassifierNode
}

/**
 * 节点类型默认标签映射
 */
const defaultLabels = {
  start: '开始',
  llm: 'AI对话',
  end: '结束',
  knowledge: '知识检索',
  classifier: '问题分类'
}

/**
 * 工作流编辑器内部组件
 * 需要在 ReactFlowProvider 内部使用 useReactFlow hook
 */
const WorkflowEditorInner = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  
  // 获取 ReactFlow 实例（用于坐标转换）
  const reactFlowInstance = useReactFlow()
  
  // 画布容器引用（用于拖拽放置坐标计算）
  const reactFlowWrapper = useRef(null)
  
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
  
  /**
   * 加载工作流数据
   */
  useEffect(() => {
    if (id) {
      fetchWorkflowById(id)
      fetchNodeTypes()
    }
    
    return () => {
      clearCurrentWorkflow()
    }
  }, [id])
  
  /**
   * 初始化画布数据
   * 从工作流数据中恢复节点和边
   */
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
      
      // v2.4 修复：转换边数据格式时保留 sourceHandle 和 targetHandle
      const initialEdges = flowEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // v2.4: 保留 sourceHandle 和 targetHandle（用于条件分支）
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
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
  
  /**
   * 连接节点
   * v2.4: 连接时自动包含 sourceHandle 和 targetHandle
   */
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
  
  /**
   * 节点选中 - 打开配置抽屉
   */
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    // 打开配置抽屉
    setConfigDrawerOpen(true)
  }, [])
  
  /**
   * 边选中
   */
  const onEdgeClick = useCallback((event, edge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    // 关闭配置抽屉（边没有配置）
    setConfigDrawerOpen(false)
  }, [])
  
  /**
   * 画布点击（取消选中）
   */
  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedEdge(null)
    // 关闭配置抽屉
    setConfigDrawerOpen(false)
  }, [])
  
  /**
   * 关闭配置抽屉
   */
  const onCloseConfigDrawer = useCallback(() => {
    setConfigDrawerOpen(false)
    // 不取消节点选中，保持高亮状态
  }, [])
  
  /**
   * v2.5: 处理拖拽经过事件
   * 必须调用 preventDefault 才能允许放置
   */
  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])
  
  /**
   * v2.5: 处理拖拽放置事件
   * 从 dataTransfer 获取节点类型，计算放置位置，添加节点
   */
  const onDrop = useCallback((event) => {
    event.preventDefault()
    
    // 获取拖拽的节点类型
    const nodeType = event.dataTransfer.getData('application/reactflow')
    
    // 验证节点类型
    if (!nodeType) {
      return
    }
    
    // 获取画布容器的边界
    const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect()
    if (!reactFlowBounds) {
      return
    }
    
    // 计算放置位置：将屏幕坐标转换为画布坐标
    // screenToFlowPosition 会考虑画布的缩放和平移
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top
    })
    
    // 创建新节点
    const newNode = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position: position,
      data: {
        label: defaultLabels[nodeType] || nodeType.toUpperCase(),
        config: {}
      }
    }
    
    // 添加到画布
    setNodes((nds) => [...nds, newNode])
    setHasUnsavedChanges(true)
    
    // 提示用户
    message.success(`已添加 ${defaultLabels[nodeType] || nodeType} 节点`)
  }, [reactFlowInstance, setNodes])
  
  /**
   * 添加新节点（保留此方法用于其他方式添加节点）
   * @param {string} nodeType - 节点类型
   * @param {Object} position - 节点位置
   */
  const onAddNode = useCallback((nodeType, position) => {
    const newNode = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position: position || { x: 100, y: 100 },
      data: {
        label: defaultLabels[nodeType] || nodeType.toUpperCase(),
        config: {}
      }
    }
    
    setNodes((nds) => [...nds, newNode])
    setHasUnsavedChanges(true)
  }, [setNodes])
  
  /**
   * 删除选中的节点/边
   */
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
  
  /**
   * 更新节点配置
   * v2.2 修复：同时更新 label 和 config
   */
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
  
  /**
   * 保存工作流
   * v2.4 修复：保存时包含 sourceHandle 和 targetHandle
   */
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
        // v2.4: 保存边时包含 sourceHandle 和 targetHandle
        edges: edges.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null
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
  
  /**
   * 打开测试抽屉
   */
  const onTest = useCallback(() => {
    if (hasUnsavedChanges) {
      message.warning('请先保存工作流再进行测试')
      return
    }
    setTestDrawerOpen(true)
  }, [hasUnsavedChanges])
  
  /**
   * 返回列表
   */
  const onBack = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('有未保存的更改，确定要离开吗？')) {
        navigate('/agent')
      }
    } else {
      navigate('/agent')
    }
  }, [hasUnsavedChanges, navigate])
  
  // 加载中状态
  if (currentWorkflowLoading) {
    return (
      <div className="workflow-editor-loading">
        <Spin size="large" tip="加载工作流中..." />
      </div>
    )
  }
  
  // 工作流不存在
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
        
        {/* 中间画布 - v2.5: 添加拖拽放置支持 */}
        <div 
          className="workflow-editor-canvas workflow-editor-canvas-full"
          ref={reactFlowWrapper}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
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
                  case 'classifier':
                    return '#faad14'
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

/**
 * 工作流编辑器主组件
 * 必须用 ReactFlowProvider 包裹才能使用 useReactFlow hook
 */
const WorkflowEditor = () => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  )
}

export default WorkflowEditor
