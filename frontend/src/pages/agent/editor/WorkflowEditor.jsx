/**
 * Agent工作流可视化编辑器
 * v3.0 - 浮动节点面板+可删除边+大吸附范围
 * v4.0 - 质感升级：修复双重提示+抽屉加宽
 * v4.1 - 测试运行不再要求必须先保存
 * v4.2 - 保存时校验连线完整性（警告模式）
 * v4.3 - 保存时校验连线完整性（阻止模式）：
 *   缺少上游连线的节点直接阻止保存，用户必须补充连线后才能保存
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

/** 注册自定义节点类型（组件外部定义，避免重复创建） */
const nodeTypes = {
  start: StartNode,
  llm: LLMNode,
  end: EndNode,
  knowledge: KnowledgeNode,
  classifier: ClassifierNode
}

/** 节点类型默认标签映射 */
const defaultLabels = {
  start: '开始',
  llm: 'AI对话',
  end: '结束',
  knowledge: '知识检索',
  classifier: '问题分类'
}

/** 节点类型中文名映射（用于校验提示） */
const nodeTypeNames = {
  llm: 'AI模型',
  knowledge: '知识检索',
  classifier: '问题分类',
  end: '结束'
}

/**
 * 自定义可删除边组件
 */
const DeletableEdge = ({ 
  id, sourceX, sourceY, targetX, targetY, 
  sourcePosition, targetPosition, style, markerEnd, selected, data 
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition
  })

  const handleDelete = useCallback((event) => {
    event.stopPropagation()
    if (data?.onDelete) data.onDelete(id)
  }, [id, data])

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <foreignObject
        width={24} height={24}
        x={labelX - 12} y={labelY - 12}
        className="edge-delete-foreignobject"
        requiredExtensions="http://www.w3.org/1999/xhtml"
      >
        <div className="edge-delete-btn" onClick={handleDelete} title="删除连线">×</div>
      </foreignObject>
    </>
  )
}

const edgeTypes = { deletable: DeletableEdge }

/**
 * 工作流编辑器内部组件
 */
const WorkflowEditorInner = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef(null)
  
  const {
    currentWorkflow, currentWorkflowLoading,
    fetchWorkflowById, updateWorkflow, clearCurrentWorkflow,
    fetchNodeTypes, nodeTypes: availableNodeTypes
  } = useAgentStore()
  
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [nodePanelOpen, setNodePanelOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  
  /** 删除指定边的回调 */
  const handleDeleteEdge = useCallback((edgeId) => {
    setEdges((eds) => eds.filter(e => e.id !== edgeId))
    setSelectedEdge(null)
    setHasUnsavedChanges(true)
    message.success('连线已删除')
  }, [setEdges])
  
  /** 加载工作流数据 */
  useEffect(() => {
    if (id) {
      fetchWorkflowById(id)
      fetchNodeTypes()
    }
    return () => { clearCurrentWorkflow() }
  }, [id])
  
  /** 初始化画布数据 */
  useEffect(() => {
    if (currentWorkflow?.flow_data) {
      const { nodes: flowNodes = [], edges: flowEdges = [] } = currentWorkflow.flow_data
      
      setNodes(flowNodes.map(node => ({
        id: node.id,
        type: node.type,
        position: node.position || { x: 0, y: 0 },
        data: { label: node.data?.label || node.type, config: node.data?.config || {} }
      })))
      
      setEdges(flowEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        type: 'deletable',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { onDelete: handleDeleteEdge }
      })))
    }
  }, [currentWorkflow, handleDeleteEdge])
  
  /** 连接节点 */
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
  
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node); setSelectedEdge(null); setConfigDrawerOpen(true)
  }, [])
  
  const onEdgeClick = useCallback((event, edge) => {
    setSelectedEdge(edge); setSelectedNode(null); setConfigDrawerOpen(false)
  }, [])
  
  const onPaneClick = useCallback(() => {
    setSelectedNode(null); setSelectedEdge(null)
    setConfigDrawerOpen(false); setNodePanelOpen(false)
  }, [])
  
  const onCloseConfigDrawer = useCallback(() => { setConfigDrawerOpen(false) }, [])
  
  const onDragOver = useCallback((event) => {
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'
  }, [])
  
  /** 拖拽放置节点 */
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
    setNodes((nds) => [...nds, {
      id: `${nodeType}-${Date.now()}`, type: nodeType, position,
      data: { label: defaultLabels[nodeType] || nodeType.toUpperCase(), config: {} }
    }])
    setHasUnsavedChanges(true)
    message.success(`已添加 ${defaultLabels[nodeType] || nodeType} 节点`)
    setNodePanelOpen(false)
  }, [reactFlowInstance, setNodes])
  
  /** 添加新节点 */
  const onAddNode = useCallback((nodeType, position) => {
    setNodes((nds) => [...nds, {
      id: `${nodeType}-${Date.now()}`, type: nodeType,
      position: position || { x: 100, y: 100 },
      data: { label: defaultLabels[nodeType] || nodeType.toUpperCase(), config: {} }
    }])
    setHasUnsavedChanges(true)
  }, [setNodes])
  
  /** 删除选中的节点/边 */
  const onDelete = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter(n => n.id !== selectedNode.id))
      setEdges((eds) => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
      setSelectedNode(null); setConfigDrawerOpen(false); setHasUnsavedChanges(true)
    }
    if (selectedEdge) {
      setEdges((eds) => eds.filter(e => e.id !== selectedEdge.id))
      setSelectedEdge(null); setHasUnsavedChanges(true)
    }
  }, [selectedNode, selectedEdge, setNodes, setEdges])
  
  /** 更新节点配置 */
  const onUpdateNodeConfig = useCallback((nodeId, config) => {
    setNodes((nds) => nds.map(node => {
      if (node.id !== nodeId) return node
      return { ...node, data: { ...node.data, label: config.label || node.data.label, config } }
    }))
    setSelectedNode(prev => {
      if (!prev || prev.id !== nodeId) return prev
      return { ...prev, data: { ...prev.data, label: config.label || prev.data.label, config } }
    })
    setHasUnsavedChanges(true)
  }, [setNodes])
  
  /**
   * v4.3: 校验工作流连线完整性
   * 检查所有非开始节点是否都有上游连线
   * @returns {string[]} 缺少连线的节点描述列表（空数组=全部合格）
   */
  const validateConnections = useCallback(() => {
    const disconnected = []
    for (const node of nodes) {
      if (node.type === 'start') continue
      const hasIncoming = edges.some(e => e.target === node.id)
      if (!hasIncoming) {
        const typeName = nodeTypeNames[node.type] || node.type
        const nodeName = node.data?.label || node.data?.config?.label || typeName
        disconnected.push(`${typeName}节点「${nodeName}」`)
      }
    }
    return disconnected
  }, [nodes, edges])
  
  /**
   * 保存工作流
   * v4.3: 校验连线完整性，缺少上游连线时阻止保存
   */
  const onSave = useCallback(async () => {
    if (!currentWorkflow) return
    
    /* v4.3: 校验连线完整性 - 阻止保存 */
    const disconnected = validateConnections()
    if (disconnected.length > 0) {
      message.error(
        `无法保存：${disconnected.join('、')} 缺少上游连线，请先补充连线`,
        5
      )
      return
    }
    
    setSaving(true)
    try {
      const flowData = {
        nodes: nodes.map(node => ({
          id: node.id, type: node.type, position: node.position, data: node.data
        })),
        edges: edges.map(edge => ({
          id: edge.id, source: edge.source, target: edge.target,
          sourceHandle: edge.sourceHandle || null, targetHandle: edge.targetHandle || null
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
  }, [currentWorkflow, nodes, edges, updateWorkflow, validateConnections])
  
  /** 测试运行（v4.1: 不阻止，仅提示） */
  const onTest = useCallback(() => {
    if (hasUnsavedChanges) {
      message.info('提示：当前有未保存的更改，测试运行的是上次保存的版本')
    }
    setTestDrawerOpen(true)
  }, [hasUnsavedChanges])
  
  /** 返回列表 */
  const onBack = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm('有未保存的更改，确定要离开吗？')) navigate('/agent')
    } else {
      navigate('/agent')
    }
  }, [hasUnsavedChanges, navigate])
  
  if (currentWorkflowLoading) {
    return <div className="workflow-editor-loading"><Spin size="large" tip="加载工作流中..." /></div>
  }
  
  if (!currentWorkflow) {
    return <div className="workflow-editor-error"><p>工作流不存在</p></div>
  }
  
  return (
    <div className="workflow-editor">
      <Toolbar
        workflow={currentWorkflow} hasUnsavedChanges={hasUnsavedChanges}
        onSave={onSave} onBack={onBack} onDelete={onDelete} onTest={onTest}
        selectedNode={selectedNode} selectedEdge={selectedEdge}
      />
      
      <div className="workflow-editor-body">
        <NodePanel
          nodeTypes={availableNodeTypes} onAddNode={onAddNode}
          open={nodePanelOpen}
          onToggle={() => setNodePanelOpen(!nodePanelOpen)}
          onClose={() => setNodePanelOpen(false)}
        />
        
        <div className="workflow-editor-canvas" ref={reactFlowWrapper}
          onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
            minZoom={0.1} maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
            connectionRadius={40} snapToGrid={true} snapGrid={[16, 16]}
          >
            <Background color="#d0d5dd" gap={20} size={1.5} />
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
              style={{ borderRadius: 10 }}
            />
          </ReactFlow>
        </div>
        
        <Drawer
          title={selectedNode ? `${selectedNode.data?.label || selectedNode.type} 配置` : '节点配置'}
          placement="right" width={400}
          onClose={onCloseConfigDrawer} open={configDrawerOpen}
          mask={false} getContainer={false} style={{ position: 'absolute' }}
        >
          <ConfigPanel
            selectedNode={selectedNode} onUpdateConfig={onUpdateNodeConfig}
            onSave={onSave} saving={saving}
            hasUnsavedChanges={hasUnsavedChanges} inDrawer={true}
          />
        </Drawer>
      </div>
      
      <TestDrawer
        open={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        workflow={currentWorkflow} nodes={nodes}
      />
    </div>
  )
}

const WorkflowEditor = () => (
  <ReactFlowProvider><WorkflowEditorInner /></ReactFlowProvider>
)

export default WorkflowEditor
