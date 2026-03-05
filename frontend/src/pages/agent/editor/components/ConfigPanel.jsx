/**
 * 配置面板 - 显示选中节点的配置选项
 * v2.7 - 新建LLM/分类节点时自动填充系统默认模型
 * v2.8 - 保存按钮改为"节点配置已同步"状态指示：
 *   1. 节点配置通过 onValuesChange 实时同步到画布，无需手动保存
 *   2. 顶部状态栏仅显示同步状态，不再有保存按钮
 *   3. 提示用户"修改已实时生效，请通过工具栏保存工作流"
 */

import React, { useEffect, useState } from 'react'
import { 
  Form, Input, Select, InputNumber, Empty, Spin, Slider, Divider, 
  Button, Space, Tag, List, Tooltip, Typography, message 
} from 'antd'
import { 
  SettingOutlined,
  InfoCircleOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  DeleteOutlined,
  PlusOutlined,
  BranchesOutlined,
  TagOutlined,
  SyncOutlined
} from '@ant-design/icons'
import useAgentStore from '../../../../stores/agentStore'
import './ConfigPanel.less'

const { Text } = Typography

const ConfigPanel = ({ 
  selectedNode, 
  onUpdateConfig, 
  onSave,
  saving = false,
  hasUnsavedChanges = false,
  inDrawer = false 
}) => {
  const [form] = Form.useForm()
  
  const { 
    availableModels, modelsLoading, fetchAvailableModels,
    wikiItems, wikiItemsLoading, fetchWikiItems
  } = useAgentStore()
  
  const [selectedWikis, setSelectedWikis] = useState([])
  const [categories, setCategories] = useState([])
  
  /* 加载可用模型列表 */
  useEffect(() => {
    if (availableModels.length === 0) fetchAvailableModels()
  }, [])
  
  /* 节点选中时同步表单数据 */
  useEffect(() => {
    if (selectedNode) {
      const config = selectedNode.data?.config || {}
      form.setFieldsValue(config)
      
      /* 知识库节点：恢复已选知识库 */
      if (selectedNode.type === 'knowledge' && config.wiki_ids) {
        if (config.selected_wikis && config.selected_wikis.length > 0) {
          setSelectedWikis(config.selected_wikis)
        } else {
          const selected = (config.wiki_ids || []).map(id => {
            const item = wikiItems.find(w => w.id === id)
            return item || { id, title: `知识库 #${id}`, tokens_display: '未知', tokens: 0 }
          }).filter(Boolean)
          setSelectedWikis(selected)
        }
      } else {
        setSelectedWikis([])
      }
      
      /* 分类节点：恢复分类列表 */
      if (selectedNode.type === 'classifier' && config.categories) {
        setCategories(config.categories || [])
      } else {
        setCategories([])
      }
    } else {
      form.resetFields()
      setSelectedWikis([])
      setCategories([])
    }
  }, [selectedNode, form, wikiItems])
  
  /**
   * v2.7: 当模型列表加载完成后，自动为LLM/分类节点填充默认模型
   */
  useEffect(() => {
    if (!selectedNode || availableModels.length === 0) return
    
    const needsDefaultModel = selectedNode.type === 'llm' || selectedNode.type === 'classifier'
    const currentModel = selectedNode.data?.config?.model
    
    if (needsDefaultModel && !currentModel) {
      const defaultModel = availableModels[0]?.name
      if (defaultModel) {
        form.setFieldsValue({ model: defaultModel })
        const allValues = form.getFieldsValue()
        allValues.model = defaultModel
        if (selectedNode.type === 'classifier') {
          allValues.categories = categories
        }
        onUpdateConfig(selectedNode.id, allValues)
      }
    }
  }, [selectedNode, availableModels])
  
  /* 知识库节点自动加载知识库列表 */
  useEffect(() => {
    if (selectedNode?.type === 'knowledge' && wikiItems.length === 0) fetchWikiItems()
  }, [selectedNode?.type])
  
  /** 构建知识库元数据 */
  const buildWikiMetadata = (wikis) => wikis.map(w => ({
    id: w.id, title: w.title, scope: w.scope,
    tokens: w.tokens || 0, tokens_display: w.tokens_display || '未知'
  }))
  
  /** 表单值变化回调 - 实时同步到画布节点 */
  const handleValuesChange = (changedValues, allValues) => {
    if (selectedNode) {
      if (selectedNode.type === 'knowledge') {
        allValues.wiki_ids = selectedWikis.map(w => w.id)
        allValues.selected_wikis = buildWikiMetadata(selectedWikis)
      }
      if (selectedNode.type === 'classifier') {
        allValues.categories = categories
      }
      onUpdateConfig(selectedNode.id, allValues)
    }
  }
  
  /** 添加知识库 */
  const handleAddWiki = (wikiId) => {
    const wiki = wikiItems.find(w => w.id === wikiId)
    if (wiki && !selectedWikis.find(w => w.id === wikiId)) {
      const newSelected = [...selectedWikis, wiki]
      setSelectedWikis(newSelected)
      const currentValues = form.getFieldsValue()
      currentValues.wiki_ids = newSelected.map(w => w.id)
      currentValues.selected_wikis = buildWikiMetadata(newSelected)
      onUpdateConfig(selectedNode.id, currentValues)
    }
  }
  
  /** 移除知识库 */
  const handleRemoveWiki = (wikiId) => {
    const newSelected = selectedWikis.filter(w => w.id !== wikiId)
    setSelectedWikis(newSelected)
    const currentValues = form.getFieldsValue()
    currentValues.wiki_ids = newSelected.map(w => w.id)
    currentValues.selected_wikis = buildWikiMetadata(newSelected)
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  /** 添加分类 */
  const handleAddCategory = () => {
    if (categories.length >= 100) { message.warning('最多支持100个分类'); return }
    const newCategory = { id: `cat-${Date.now()}`, name: `分类${categories.length + 1}`, description: '' }
    const newCategories = [...categories, newCategory]
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  /** 更新分类 */
  const handleUpdateCategory = (index, field, value) => {
    const newCategories = [...categories]
    newCategories[index] = { ...newCategories[index], [field]: value }
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  /** 删除分类 */
  const handleRemoveCategory = (index) => {
    const newCategories = categories.filter((_, i) => i !== index)
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  /* 计算知识库总Token */
  const totalTokens = selectedWikis.reduce((sum, w) => sum + (w.tokens || 0), 0)
  const formatTotalTokens = (t) => t === 0 ? '0' : t < 1000 ? `${t}` : `${(t/1000).toFixed(1)}K`
  
  /* 范围图标映射 */
  const scopeIcons = {
    personal: <UserOutlined style={{ color: '#1890ff' }} />,
    team: <TeamOutlined style={{ color: '#52c41a' }} />,
    global: <GlobalOutlined style={{ color: '#fa8c16' }} />
  }
  
  /* 节点类型对应的主题色 */
  const nodeThemeColors = {
    start: '#52c41a', llm: '#1890ff', end: '#ff4d4f',
    knowledge: '#722ed1', classifier: '#d48806'
  }
  const themeColor = nodeThemeColors[selectedNode?.type] || '#1890ff'
  
  /* 空状态 */
  if (!selectedNode) {
    return (
      <div className="cp-empty">
        <Empty description="请选择一个节点" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }
  
  /**
   * v2.8: 状态栏 - 不再有保存按钮
   * 节点配置通过表单 onValuesChange 实时同步到画布
   * 用户只需通过顶部工具栏的"保存工作流"来持久化所有更改
   */
  const renderStatusBar = () => {
    if (!inDrawer) return null
    return (
      <div className="cp-save-bar">
        <span className="cp-save-status">
          {hasUnsavedChanges ? (
            <span className="cp-unsaved"><SyncOutlined spin /> 节点配置已修改，请保存工作流</span>
          ) : (
            <span className="cp-saved"><CheckCircleOutlined /> 已保存</span>
          )}
        </span>
      </div>
    )
  }
  
  /** 知识库配置区域 */
  const renderKnowledgeConfig = () => (
    <>
      <div className="cp-section-header">
        <DatabaseOutlined style={{ color: '#722ed1' }} /> 知识库配置
      </div>
      
      <Form.Item label="数据来源" name="source" initialValue="wiki">
        <Select>
          <Select.Option value="wiki">
            <Space><FileTextOutlined /><span>知识库文档（Wiki）</span></Space>
          </Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item label="加载模式" name="mode" initialValue="direct">
        <Select>
          <Select.Option value="direct">直接加载（完整内容）</Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item label="选择知识库" tooltip="可选择多个知识库，内容合并后传递给下游节点">
        {wikiItemsLoading ? <Spin size="small" /> : (
          <Select placeholder="搜索并选择知识库..." showSearch optionFilterProp="label"
            value={null} onChange={handleAddWiki} style={{ width: '100%' }}
            options={wikiItems.filter(w => !selectedWikis.find(s => s.id === w.id)).map(wiki => ({
              value: wiki.id,
              label: `${wiki.title} (${wiki.tokens_display} tokens)`
            }))}
          />
        )}
      </Form.Item>
      
      {selectedWikis.length > 0 && (
        <div className="cp-wiki-list">
          <div className="cp-wiki-list-header">
            <Text type="secondary" style={{ fontSize: '12px' }}>
              已选 {selectedWikis.length}个，共 {formatTotalTokens(totalTokens)} tokens
            </Text>
          </div>
          <List size="small" bordered dataSource={selectedWikis}
            className="cp-wiki-items"
            renderItem={(wiki) => (
              <List.Item style={{ padding: '8px 12px' }}
                actions={[
                  <Button type="text" danger size="small" key="rm"
                    icon={<DeleteOutlined />} onClick={() => handleRemoveWiki(wiki.id)} />
                ]}
              >
                <List.Item.Meta
                  avatar={scopeIcons[wiki.scope] || <FileTextOutlined />}
                  title={<span style={{ fontSize: '13px' }}>{wiki.title}</span>}
                  description={<Tag color="processing" style={{ fontSize: '11px' }}>{wiki.tokens_display} tokens</Tag>}
                />
              </List.Item>
            )}
          />
          <div className="cp-info-card purple">
            <InfoCircleOutlined /> 总计 <strong>{formatTotalTokens(totalTokens)}</strong> tokens 作为上下文传递给下游LLM
          </div>
        </div>
      )}
    </>
  )
  
  /** 分类配置区域 */
  const renderClassifierConfig = () => (
    <>
      <div className="cp-section-header">
        <BranchesOutlined style={{ color: '#d48806' }} /> 分类配置
      </div>
      
      <Form.Item label="AI模型" name="model" rules={[{ required: true, message: '请选择AI模型' }]}
        tooltip="选择用于分类的AI模型（推荐轻量模型）">
        {modelsLoading ? <Spin size="small" /> : (
          <Select placeholder="选择AI模型" showSearch optionFilterProp="children">
            {availableModels.map((m) => (
              <Select.Option key={m.name} value={m.name}>{m.display_name}</Select.Option>
            ))}
          </Select>
        )}
      </Form.Item>
      
      <Form.Item label="背景知识" name="background_knowledge"
        tooltip="提供给AI的背景信息，帮助更准确分类">
        <Input.TextArea rows={3} placeholder="例如：这是一个电商客服系统..." />
      </Form.Item>
      
      <Form.Item label="聊天记录" name="history_turns" initialValue={6}
        tooltip="参考的历史对话轮数">
        <InputNumber min={0} max={20} style={{ width: '100%' }} addonAfter="轮" />
      </Form.Item>
      
      <div className="cp-section-header">
        <TagOutlined style={{ color: '#d48806' }} /> 分类列表 ({categories.length}/100)
      </div>
      
      <div className="cp-category-list">
        {categories.map((cat, index) => (
          <div key={cat.id} className="cp-category-item">
            <div className="cp-category-item-header">
              <Tag color="orange">{index + 1}</Tag>
              <Input placeholder="分类名称" value={cat.name}
                onChange={(e) => handleUpdateCategory(index, 'name', e.target.value)}
                style={{ flex: 1 }} />
              <Button type="text" danger size="small"
                icon={<DeleteOutlined />} onClick={() => handleRemoveCategory(index)} />
            </div>
            <Input.TextArea placeholder="分类描述（可选，帮助AI理解分类标准）"
              value={cat.description}
              onChange={(e) => handleUpdateCategory(index, 'description', e.target.value)}
              rows={2} className="cp-category-desc" />
          </div>
        ))}
        
        <Button type="dashed" block icon={<PlusOutlined />}
          onClick={handleAddCategory} disabled={categories.length >= 100}
          className="cp-add-category-btn">
          添加分类
        </Button>
        
        {categories.length === 0 && (
          <div className="cp-info-card amber">
            <InfoCircleOutlined /> 请至少添加一个分类类别
          </div>
        )}
      </div>
    </>
  )
  
  /** 主配置表单 */
  const renderConfigForm = () => (
    <Form form={form} layout="vertical" onValuesChange={handleValuesChange}
      size="middle" className="cp-form">
      
      <Form.Item label="节点名称" name="label" initialValue={selectedNode.data?.label}>
        <Input placeholder="输入节点名称" />
      </Form.Item>
      
      {/* LLM节点配置 */}
      {selectedNode.type === 'llm' && (
        <>
          <div className="cp-section-header">
            <SettingOutlined style={{ color: '#1890ff' }} /> AI配置
          </div>
          
          <Form.Item label="系统提示词" name="system_prompt" tooltip="设定AI的角色和行为">
            <Input.TextArea rows={4} placeholder="例如: 你是一个专业的AI助手..." />
          </Form.Item>
          
          <Form.Item label="AI模型" name="model" rules={[{ required: true, message: '请选择AI模型' }]}>
            {modelsLoading ? <Spin size="small" /> : (
              <Select placeholder="选择AI模型" showSearch optionFilterProp="children">
                {availableModels.map((m) => (
                  <Select.Option key={m.name} value={m.name}>
                    {m.display_name} ({m.credits_display || `${m.credits_per_chat} 积分/次`})
                  </Select.Option>
                ))}
              </Select>
            )}
          </Form.Item>
          
          <Form.Item label="历史轮数" name="history_turns" initialValue={10}
            tooltip="对话测试时保留的历史轮数">
            <Slider min={0} max={100}
              marks={{ 0: '0', 10: '10', 50: '50', 100: '100' }}
              tooltip={{ formatter: (v) => `${v}轮` }}
            />
          </Form.Item>
          
          <Form.Item label="温度" name="temperature" initialValue={0.7}
            tooltip="控制回复随机性（0=精确，2=创意）">
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          
          <Form.Item label="最大Token数" name="max_tokens" initialValue={2000}
            tooltip="单次回复最大长度（取决于模型支持的上限）">
            <InputNumber min={100} max={100000} style={{ width: '100%' }} />
          </Form.Item>
        </>
      )}
      
      {/* 开始节点配置 */}
      {selectedNode.type === 'start' && (
        <>
          <div className="cp-section-header">
            <InfoCircleOutlined style={{ color: '#52c41a' }} /> 入口配置
          </div>
          <Form.Item label="欢迎语" name="welcome_message" tooltip="测试时显示的欢迎消息">
            <Input.TextArea rows={3} placeholder="你好！我是AI助手，有什么可以帮你的吗？" />
          </Form.Item>
          <Form.Item label="输入参数" name="input_schema" tooltip="定义工作流输入参数（JSON，可选）">
            <Input.TextArea rows={3} placeholder='{"param1": "value1"}' />
          </Form.Item>
        </>
      )}
      
      {/* 结束节点配置 */}
      {selectedNode.type === 'end' && (
        <>
          <div className="cp-section-header">
            <InfoCircleOutlined style={{ color: '#ff4d4f' }} /> 输出配置
          </div>
          <Form.Item label="输出映射" name="output_mapping" tooltip="定义如何映射最终输出">
            <Input.TextArea rows={3} placeholder="result" />
          </Form.Item>
        </>
      )}
      
      {selectedNode.type === 'knowledge' && renderKnowledgeConfig()}
      {selectedNode.type === 'classifier' && renderClassifierConfig()}
    </Form>
  )
  
  /** 节点信息卡片 */
  const renderNodeInfo = () => (
    <div className="cp-node-info" style={{ borderLeftColor: themeColor }}>
      <div className="cp-node-info-item">
        <span className="cp-node-info-label">节点ID</span>
        <span className="cp-node-info-value">{selectedNode.id}</span>
      </div>
      <div className="cp-node-info-item">
        <span className="cp-node-info-label">类型</span>
        <Tag color={themeColor} style={{ margin: 0 }}>{selectedNode.type}</Tag>
      </div>
    </div>
  )
  
  if (inDrawer) {
    return (
      <div className="cp-content">
        {renderStatusBar()}
        {renderConfigForm()}
        {renderNodeInfo()}
      </div>
    )
  }
  
  return (
    <div className="workflow-editor-config-panel">
      {renderConfigForm()}
      {renderNodeInfo()}
    </div>
  )
}

export default ConfigPanel
