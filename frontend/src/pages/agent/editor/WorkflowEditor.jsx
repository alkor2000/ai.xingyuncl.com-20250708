/**
 * Agent工作流可视化编辑器
 * 基于 ReactFlow 实现拖拽式工作流编排
 * v2.2 - 修复节点名称同步问题
 * v2.3 - 添加问题分类节点 ClassifierNode
 * v2.4 - 修复边的 sourceHandle/targetHandle 保存和加载问题
 * v2.5 - 支持从节点面板拖拽放置节点到画布
 * v3.0 - UX大优化：
 *   1. 节点库改为浮动弹窗（左上角+按钮）
 *   2. 连线上显示X删除按钮（自定义边）
 *   3. 增大连接点吸附范围（connectionRadius）
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
  ReactFlowProvider,
  getBezierPath,
  BaseEdge
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
 * v3.0 自定义可删除边组件
 * 在连线中间显示X按钮，点击可直接删除连线
 * 不需要再找右上角的删除按钮
 */
const DeletableEdge = ({ 
  id, sourceX, sourceY, targetX, targetY, 
  sourcePosition, targetPosition, style, markerEnd, selected,
  data 
}) => {
  // 计算贝塞尔曲线路径
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition
  })

  // 删除边的处理函数（通过data.onDelete回调）
  const handleDelete = useCallback((event) => {
    event.stopPropagation()
    if (data?.onDelete) {
      data.onDelete(id)
    }
  }, [id, data])

  return (
    <>
      {/* 绘制连线路径 */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      
      {/* 连线中间的删除按钮（悬浮时显示） */}
      <foreignObject
        width={24}
        height={24}
        x={labelX - 12}
        y={labelY - 12}
        className="edge-delete-foreignobject"
        requiredExtensions="http://www.w3.org/1999/xhtml"
      >
        <div className="edge-delete-btn" onClick={handleDelete} title="删除连线">
          ×
        </div>
      </foreignObject>
    </>
  )
}

/**
 * 注册自定义边类型
 */
const edgeTypes = {
  deletable: DeletableEdge
}

/**
 * 工作流编辑器内部组件
 */
const WorkflowEditorInner = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  
  // 获取 ReactFlow 实例（用于坐标转换）
  const reactFlowInstance = useReactFlow()
  
  // 画布容器引用
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
  
  // 未保存更改标记
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  
  // 测试抽屉状态
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  
  // 配置面板抽屉状态
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  
  // v3.0: 节点面板弹窗状态
  const [nodePanelOpen, setNodePanelOpen] = useState(false)
  
  // 保存中状态
  const [saving, setSaving] = useState(false)
  
  /**
   * v3.0: 删除指定边的回调
   * 传递给自定义DeletableEdge组件使用
   */
  const handleDeleteEdge = useCallback((edgeId) => {
    setEdges((eds) => eds.filter(e => e.id !== edgeId))
    setSelectedEdge(null)
    setHasUnsavedChanges(true)
    message.success('连线已删除')
  }, [setEdges])
  
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
   */
  useEffect(() => {
    if (currentWorkflow?.flow_data) {
      const { nodes: flowNodes = [], edges: flowEdges = [] } = currentWorkflow.flow_data
      
      const initialNodes = flowNodes.map(node => ({
        id: node.id,
        type: node.type,
        position: node.position || { x: 0, y: 0 },
        data: {
          label: node.data?.label || node.type,
          config: node.data?.config || {}
        }
      }))
      
      // v3.0: 所有边使用自定义可删除边类型，注入onDelete回调
      const initialEdges = flowEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        type: 'deletable',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { onDelete: handleDeleteEdge }
      }))
      
      setNodes(initialNodes)
      setEdges(initialEdges)
    }
  }, [currentWorkflow, handleDeleteEdge])
  
  /**
   * 连接节点
   * v3.0: 新连线也使用自定义可删除边
   */
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      type: 'deletable',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { onDelete: handleDeleteEdge }
    }, eds))
    setHasUnsavedChanges(true)
  }, [setEdges, handleDeleteEdge])
  
  /**
   * 节点选中 - 打开配置抽屉
   */
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    setConfigDrawerOpen(true)
  }, [])
  
  /**
   * 边选中
   */
  const onEdgeClick = useCallback((event, edge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    setConfigDrawerOpen(false)
  }, [])
  
  /**
   * 画布点击（取消选中）
   */
  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
    setSelectedEdge(null)
    setConfigDrawerOpen(false)
    // 点击画布也关闭节点面板
    setNodePanelOpen(false)
  }, [])
  
  /**
   * 关闭配置抽屉
   */
  const onCloseConfigDrawer = useCallback(() => {
    setConfigDrawerOpen(false)
  }, [])
  
  /**
   * 处理拖拽经过事件
   */
  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])
  
  /**
   * 处理拖拽放置事件
   */
  const onDrop = useCallback((event) => {
    event.preventDefault()
    
    const nodeType = event.dataTransfer.getData('application/reactflow')
    if (!nodeType) return
    
    const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect()
    if (!reactFlowBounds) return
    
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top
    })
    
    const newNode = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position,
      data: {
        label: defaultLabels[nodeType] || nodeType.toUpperCase(),
        config: {}
      }
    }
    
    setNodes((nds) => [...nds, newNode])
    setHasUnsavedChanges(true)
    message.success(`已添加 ${defaultLabels[nodeType] || nodeType} 节点`)
    
    // 添加节点后关闭节点面板
    setNodePanelOpen(false)
  }, [reactFlowInstance, setNodes])
  
  /**
   * 添加新节点
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
   */
  const onUpdateNodeConfig = useCallback((nodeId, config) => {
    setNodes((nds) => 
      nds.map(node => {
        if (node.id !== nodeId) return node
        const newLabel = config.label || node.data.label
        return {
          ...node,
          data: {
            ...node.data,
            label: newLabel,
            config: config
          }
        }
      })
    )
    
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
        edges: edges.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null
        }))
      }
      
      await updateWorkflow(currentWorkflow.id, { flow_data: flowData })
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
  
  // 加载中
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
        {/* v3.0: 浮动节点面板（替代固定左侧面板） */}
        <NodePanel
          nodeTypes={availableNodeTypes}
          onAddNode={onAddNode}
          open={nodePanelOpen}
          onToggle={() => setNodePanelOpen(!nodePanelOpen)}
          onClose={() => setNodePanelOpen(false)}
        />
        
        {/* 画布 - 现在占满整个body区域 */}
        <div 
          className="workflow-editor-canvas"
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
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
            connectionRadius={40}
            snapToGrid={true}
            snapGrid={[16, 16]}
          >
            <Background color="#aaa" gap={16} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                switch (node.type) {
                  case 'start': return '#52c41a'
                  case 'llm': return '#1890ff'
                  case 'end': return '#ff4d4f'
                  case 'knowledge': return '#722ed1'
                  case 'classifier': return '#faad14'
                  default: return '#ccc'
                }
              }}
            />
          </ReactFlow>
        </div>
        
        {/* 右侧配置面板 - Drawer */}
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
 */
const WorkflowEditor = () => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  )
}

export default WorkflowEditor
