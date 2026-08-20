/**
 * Agent工作流可视化编辑器 v2.4
 * 集成ReactFlow画布、配置面板、测试抽屉、API接入管理
 *
 * v2.1 - 拖入LLM/分类节点时自动填充默认模型
 * v2.2 - 拖拽放置节点后不自动收起节点面板
 * v2.3 - 分类节点默认2个分类 + updateNodeInternals修复Handle位置
 * v2.4 - 国际化改造：
 *   1) 接入 useTranslation，将 17 处硬编码中文全部替换为 agent.* 翻译键
 *      （加载提示、工作流不存在、连线删除、节点添加、保存成功/失败、
 *        校验提示、测试提示、离开确认、抽屉标题、删除连线按钮 title 等）
 *   2) 节点默认标签不再使用模块级中文常量 defaultLabels，
 *      改为通过 getDefaultNodeLabel(nodeType, t) 按当前语言生成，
 *      避免新建节点时把中文写入数据库；
 *   3) 配置抽屉标题与校验提示中的节点名称，统一经 resolveNodeLabel 解析，
 *      使历史遗留的中文默认标签也能随语言切换显示；
 *   4) 校验提示中的节点类型名改用 agent.node.* 翻译键，
 *      不再依赖原先的 nodeTypeNames 中文映射表。
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { message, Spin, Drawer } from 'antd'
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  MarkerType, useReactFlow, ReactFlowProvider,
  getBezierPath, BaseEdge,
  useUpdateNodeInternals
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useTranslation } from 'react-i18next'

import useAgentStore from '../../../stores/agentStore'
import Toolbar from './components/Toolbar'
import NodePanel from './components/NodePanel'
import ConfigPanel from './components/ConfigPanel'
import TestDrawer from './components/TestDrawer'
import ApiAccessDrawer from './components/ApiAccessDrawer'
import StartNode from './nodes/StartNode'
import LLMNode from './nodes/LLMNode'
import EndNode from './nodes/EndNode'
import KnowledgeNode from './nodes/KnowledgeNode'
import ClassifierNode from './nodes/ClassifierNode'
import { resolveNodeLabel, getDefaultNodeLabel } from './utils/nodeLabelHelper'
import './styles/editor.css'

/** 注册自定义节点类型 */
const nodeTypes = {
  start: StartNode, llm: LLMNode, end: EndNode,
  knowledge: KnowledgeNode, classifier: ClassifierNode
}

/**
 * 自定义可删除边组件
 * 在连线中点渲染一个删除按钮，点击后回调 data.onDelete
 *
 * 注意：删除按钮的 title 文案需要国际化，
 * 但边组件由 ReactFlow 内部渲染、无法直接接收 props，
 * 因此通过 data.deleteTitle 由父组件传入已翻译好的文本。
 */
const DeletableEdge = ({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, markerEnd, selected, data
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition
  })

  const handleDelete = useCallback((event) => {
    event.stopPropagation()
    if (data?.onDelete) data.onDelete(id)
  }, [id, data])

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <foreignObject width={24} height={24} x={labelX - 12} y={labelY - 12}
        className="edge-delete-foreignobject"
        requiredExtensions="http://www.w3.org/1999/xhtml">
        <div
          className="edge-delete-btn"
          onClick={handleDelete}
          title={data?.deleteTitle || ''}
        >
          ×
        </div>
      </foreignObject>
    </>
  )
}

const edgeTypes = { deletable: DeletableEdge }

/** 工作流编辑器内部组件（需置于 ReactFlowProvider 内部） */
const WorkflowEditorInner = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef(null)

  /**
   * useUpdateNodeInternals - 通知ReactFlow重新计算节点Handle位置
   * 当分类节点的分类数量变化时，Handle数量和CSS位置都会变，
   * 但ReactFlow不会自动感知CSS变量的变化，需要手动触发重新测量
   */
  const updateNodeInternals = useUpdateNodeInternals()

  const {
    currentWorkflow, currentWorkflowLoading,
    fetchWorkflowById, updateWorkflow, clearCurrentWorkflow,
    fetchNodeTypes, nodeTypes: availableNodeTypes,
    availableModels, fetchAvailableModels
  } = useAgentStore()

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false)
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [nodePanelOpen, setNodePanelOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * 连线删除按钮的提示文案（已翻译）
   * 通过 edge.data 传给 DeletableEdge，因其无法直接访问 t 函数
   */
  const edgeDeleteTitle = useMemo(() => t('agent.editor.deleteEdge'), [t])

  /** 删除指定边 */
  const handleDeleteEdge = useCallback((edgeId) => {
    setEdges((eds) => eds.filter(e => e.id !== edgeId))
    setSelectedEdge(null)
    setHasUnsavedChanges(true)
    message.success(t('agent.editor.edgeDeleted'))
  }, [setEdges, t])

  /** 加载工作流数据与节点类型 */
  useEffect(() => {
    if (id) { fetchWorkflowById(id); fetchNodeTypes() }
    return () => { clearCurrentWorkflow() }
  }, [id])

  /** 确保模型列表在编辑器加载时就已获取（供节点默认模型填充使用） */
  useEffect(() => {
    if (availableModels.length === 0) fetchAvailableModels()
  }, [])

  /** 初始化画布数据：把后端 flow_data 转换为 ReactFlow 所需结构 */
  useEffect(() => {
    if (currentWorkflow?.flow_data) {
      const { nodes: flowNodes = [], edges: flowEdges = [] } = currentWorkflow.flow_data

      setNodes(flowNodes.map(node => ({
        id: node.id, type: node.type,
        position: node.position || { x: 0, y: 0 },
        data: { label: node.data?.label || node.type, config: node.data?.config || {} }
      })))

      setEdges(flowEdges.map(edge => ({
        id: edge.id, source: edge.source, target: edge.target,
        sourceHandle: edge.sourceHandle || null, targetHandle: edge.targetHandle || null,
        type: 'deletable', animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { onDelete: handleDeleteEdge, deleteTitle: edgeDeleteTitle }
      })))
    }
  }, [currentWorkflow, handleDeleteEdge, edgeDeleteTitle])

  /** 连接节点 */
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params, type: 'deletable', animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { onDelete: handleDeleteEdge, deleteTitle: edgeDeleteTitle }
    }, eds))
    setHasUnsavedChanges(true)
  }, [setEdges, handleDeleteEdge, edgeDeleteTitle])

  const onNodeClick = useCallback((e, node) => {
    setSelectedNode(node); setSelectedEdge(null); setConfigDrawerOpen(true)
  }, [])
  const onEdgeClick = useCallback((e, edge) => {
    setSelectedEdge(edge); setSelectedNode(null); setConfigDrawerOpen(false)
  }, [])
  const onPaneClick = useCallback(() => {
    setSelectedNode(null); setSelectedEdge(null)
    setConfigDrawerOpen(false); setNodePanelOpen(false)
  }, [])
  const onCloseConfigDrawer = useCallback(() => { setConfigDrawerOpen(false) }, [])

  const onDragOver = useCallback((e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
  }, [])

  /**
   * 为需要模型的节点类型构建默认配置
   * - LLM/分类节点：自动填充第一个可用模型
   * - 分类节点：预设2个默认分类（分类名随当前语言生成）
   */
  const buildDefaultConfig = useCallback((nodeType) => {
    const config = {}
    const needsModel = nodeType === 'llm' || nodeType === 'classifier'

    if (needsModel && availableModels.length > 0) {
      const defaultModel = availableModels[0]
      config.model = defaultModel.name
      config.model_display_name = defaultModel.display_name || defaultModel.name
    }

    /* 分类节点预设2个默认分类，分类名按当前界面语言生成 */
    if (nodeType === 'classifier') {
      config.categories = [
        {
          id: `cat-${Date.now()}-1`,
          name: t('agent.editor.categoryDefault', { index: 1 }),
          description: ''
        },
        {
          id: `cat-${Date.now()}-2`,
          name: t('agent.editor.categoryDefault', { index: 2 }),
          description: ''
        }
      ]
    }

    return config
  }, [availableModels, t])

  /** 拖拽放置节点到画布 */
  const onDrop = useCallback((event) => {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('application/reactflow')
    if (!nodeType) return
    const bounds = reactFlowWrapper.current?.getBoundingClientRect()
    if (!bounds) return
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX - bounds.left, y: event.clientY - bounds.top
    })
    const defaultConfig = buildDefaultConfig(nodeType)
    /* 默认标签按当前语言生成，避免把固定中文写入数据库 */
    const defaultLabel = getDefaultNodeLabel(nodeType, t)

    setNodes((nds) => [...nds, {
      id: `${nodeType}-${Date.now()}`, type: nodeType, position,
      data: { label: defaultLabel, config: defaultConfig }
    }])
    setHasUnsavedChanges(true)
    message.success(t('agent.editor.nodeAdded', { name: defaultLabel }))
  }, [reactFlowInstance, setNodes, buildDefaultConfig, t])

  /** 通过点击方式添加新节点（携带默认模型配置） */
  const onAddNode = useCallback((nodeType, position) => {
    const defaultConfig = buildDefaultConfig(nodeType)
    const defaultLabel = getDefaultNodeLabel(nodeType, t)

    setNodes((nds) => [...nds, {
      id: `${nodeType}-${Date.now()}`, type: nodeType,
      position: position || { x: 100, y: 100 },
      data: { label: defaultLabel, config: defaultConfig }
    }])
    setHasUnsavedChanges(true)
  }, [setNodes, buildDefaultConfig, t])

  /** 删除当前选中的节点或连线 */
  const onDelete = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter(n => n.id !== selectedNode.id))
      setEdges((eds) => eds.filter(
        e => e.source !== selectedNode.id && e.target !== selectedNode.id
      ))
      setSelectedNode(null); setConfigDrawerOpen(false); setHasUnsavedChanges(true)
    }
    if (selectedEdge) {
      setEdges((eds) => eds.filter(e => e.id !== selectedEdge.id))
      setSelectedEdge(null); setHasUnsavedChanges(true)
    }
  }, [selectedNode, selectedEdge, setNodes, setEdges])

  /**
   * 更新节点配置
   * 对分类节点，配置更新后延迟调用 updateNodeInternals，
   * 让 ReactFlow 重新测量 Handle 位置，修复连线起点错位
   */
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

    /* 延迟到下一帧执行，等 React 渲染完成、DOM 已更新后再通知 ReactFlow */
    requestAnimationFrame(() => {
      updateNodeInternals(nodeId)
    })
  }, [setNodes, updateNodeInternals])

  /**
   * 校验连线完整性
   * 除开始节点外，所有节点都必须有上游连线
   * @returns {Array<string>} 缺少上游连线的节点描述列表（已国际化）
   */
  const validateConnections = useCallback(() => {
    const disconnected = []
    for (const node of nodes) {
      if (node.type === 'start') continue
      const hasIncoming = edges.some(e => e.target === node.id)
      if (!hasIncoming) {
        /* 节点类型名走 i18n；找不到对应翻译键时回退为类型标识本身 */
        const typeName = t(`agent.node.${node.type}`, node.type)
        /* 节点名称经 resolveNodeLabel 解析，历史中文默认标签也能随语言显示 */
        const rawLabel = node.data?.label || node.data?.config?.label
        const nodeName = resolveNodeLabel(rawLabel, node.type, t)
        disconnected.push(
          t('agent.editor.disconnectedNode', { type: typeName, name: nodeName })
        )
      }
    }
    return disconnected
  }, [nodes, edges, t])

  /** 保存工作流 */
  const onSave = useCallback(async () => {
    if (!currentWorkflow) return

    /* 保存前先校验连线完整性，避免产生无法执行的工作流 */
    const disconnected = validateConnections()
    if (disconnected.length > 0) {
      message.error(
        t('agent.editor.saveBlocked', { list: disconnected.join('、') }),
        5
      )
      return
    }

    setSaving(true)
    try {
      const flowData = {
        nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map(e => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null
        }))
      }
      await updateWorkflow(currentWorkflow.id, { flow_data: flowData })
      setHasUnsavedChanges(false)
      message.success(t('agent.editor.saveSuccess'))
    } catch (error) {
      console.error('[WorkflowEditor] 保存工作流失败:', error)
      message.error(t('agent.editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [currentWorkflow, nodes, edges, updateWorkflow, validateConnections, t])

  /** 打开测试运行抽屉 */
  const onTest = useCallback(() => {
    if (hasUnsavedChanges) {
      message.info(t('agent.editor.testUnsavedHint'))
    }
    setTestDrawerOpen(true)
  }, [hasUnsavedChanges, t])

  /** 打开API接入管理抽屉 */
  const onApiAccess = useCallback(() => {
    setApiDrawerOpen(true)
  }, [])

  /** 返回工作流列表（有未保存更改时二次确认） */
  const onBack = useCallback(() => {
    if (hasUnsavedChanges) {
      if (window.confirm(t('agent.editor.confirmLeave'))) navigate('/agent')
    } else {
      navigate('/agent')
    }
  }, [hasUnsavedChanges, navigate, t])

  /**
   * 配置抽屉标题
   * 选中节点时显示"{节点名} 配置"，未选中时显示通用标题
   */
  const configDrawerTitle = useMemo(() => {
    if (!selectedNode) return t('agent.editor.nodeConfig')
    const resolvedLabel = resolveNodeLabel(
      selectedNode.data?.label,
      selectedNode.type,
      t
    )
    return t('agent.editor.nodeConfigTitle', { name: resolvedLabel })
  }, [selectedNode, t])

  /* 加载中状态 */
  if (currentWorkflowLoading) {
    return (
      <div className="workflow-editor-loading">
        <Spin size="large" tip={t('agent.editor.loading')} />
      </div>
    )
  }

  /* 工作流不存在状态 */
  if (!currentWorkflow) {
    return (
      <div className="workflow-editor-error">
        <p>{t('agent.editor.notFound')}</p>
      </div>
    )
  }

  return (
    <div className="workflow-editor">
      <Toolbar
        workflow={currentWorkflow} hasUnsavedChanges={hasUnsavedChanges}
        onSave={onSave} onBack={onBack} onDelete={onDelete}
        onTest={onTest} onApiAccess={onApiAccess}
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
            connectionRadius={40} snapToGrid snapGrid={[16, 16]}
          >
            <Background color="#d0d5dd" gap={20} size={1.5} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const colors = {
                  start: '#52c41a', llm: '#1890ff', end: '#ff4d4f',
                  knowledge: '#722ed1', classifier: '#faad14'
                }
                return colors[n.type] || '#ccc'
              }}
              style={{ borderRadius: 10 }}
            />
          </ReactFlow>
        </div>

        {/* 节点配置抽屉：置于画布内部，不遮挡工具栏 */}
        <Drawer
          title={configDrawerTitle}
          placement="right" width={400}
          onClose={onCloseConfigDrawer} open={configDrawerOpen}
          mask={false} getContainer={false} style={{ position: 'absolute' }}
        >
          <ConfigPanel
            selectedNode={selectedNode} onUpdateConfig={onUpdateNodeConfig}
            onSave={onSave} saving={saving}
            hasUnsavedChanges={hasUnsavedChanges} inDrawer
          />
        </Drawer>
      </div>

      <TestDrawer
        open={testDrawerOpen}
        onClose={() => setTestDrawerOpen(false)}
        workflow={currentWorkflow} nodes={nodes}
      />

      <ApiAccessDrawer
        open={apiDrawerOpen}
        onClose={() => setApiDrawerOpen(false)}
        workflow={currentWorkflow}
      />
    </div>
  )
}

const WorkflowEditor = () => (
  <ReactFlowProvider><WorkflowEditorInner /></ReactFlowProvider>
)

export default WorkflowEditor
