/**
 * 配置面板 - 显示选中节点的配置选项
 * v2.1 - 添加保存按钮，显示保存状态
 * v2.2 - 知识库节点支持选择Wiki文档，显示Token数量
 * v2.3 - 添加问题分类节点配置（动态分类列表）
 * v2.4 - P2修复：保存知识库配置时同步保存元数据(selected_wikis)
 * 支持编辑节点参数
 */

import React, { useEffect, useState } from 'react'
import { 
  Card, Form, Input, Select, InputNumber, Empty, Spin, Slider, Divider, 
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
  TagOutlined
} from '@ant-design/icons'
import useAgentStore from '../../../../stores/agentStore'

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
  
  // 获取用户可用模型列表和知识库列表
  const { 
    availableModels, modelsLoading, fetchAvailableModels,
    wikiItems, wikiItemsLoading, fetchWikiItems
  } = useAgentStore()
  
  // 已选择的知识库列表（本地状态）
  const [selectedWikis, setSelectedWikis] = useState([])
  
  // 分类列表（本地状态）
  const [categories, setCategories] = useState([])
  
  // 加载模型列表
  useEffect(() => {
    if (availableModels.length === 0) {
      fetchAvailableModels()
    }
  }, [])
  
  // 当选中节点变化时，重置表单
  useEffect(() => {
    if (selectedNode) {
      const config = selectedNode.data?.config || {}
      form.setFieldsValue(config)
      
      // 如果是知识库节点，恢复已选择的知识库
      if (selectedNode.type === 'knowledge' && config.wiki_ids) {
        // v2.4: 优先从已保存的 selected_wikis 元数据恢复
        if (config.selected_wikis && config.selected_wikis.length > 0) {
          setSelectedWikis(config.selected_wikis)
        } else {
          // 兜底：从 wikiItems 中查找
          const selected = (config.wiki_ids || []).map(id => {
            const item = wikiItems.find(w => w.id === id)
            return item || { id, title: `知识库 #${id}`, tokens_display: '未知', tokens: 0 }
          }).filter(Boolean)
          setSelectedWikis(selected)
        }
      } else {
        setSelectedWikis([])
      }
      
      // 如果是分类节点，恢复分类列表
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
  
  // 知识库节点选中时加载知识库列表
  useEffect(() => {
    if (selectedNode?.type === 'knowledge' && wikiItems.length === 0) {
      fetchWikiItems()
    }
  }, [selectedNode?.type])
  
  /**
   * 构建知识库元数据（用于保存到节点配置和前端节点渲染）
   * v2.4 新增：每次wiki选择变化时，同步生成精简的元数据
   * @param {Array} wikis - 选中的知识库对象数组
   * @returns {Array} 精简的元数据数组
   */
  const buildWikiMetadata = (wikis) => {
    return wikis.map(w => ({
      id: w.id,
      title: w.title,
      scope: w.scope,
      tokens: w.tokens || 0,
      tokens_display: w.tokens_display || '未知'
    }))
  }
  
  // 表单值变化时更新节点配置
  const handleValuesChange = (changedValues, allValues) => {
    if (selectedNode) {
      // 如果是知识库节点，需要同步wiki_ids和元数据
      if (selectedNode.type === 'knowledge') {
        allValues.wiki_ids = selectedWikis.map(w => w.id)
        // v2.4: 同步保存元数据，供前端节点渲染使用
        allValues.selected_wikis = buildWikiMetadata(selectedWikis)
      }
      // 如果是分类节点，需要同步categories
      if (selectedNode.type === 'classifier') {
        allValues.categories = categories
      }
      onUpdateConfig(selectedNode.id, allValues)
    }
  }
  
  // 添加知识库
  const handleAddWiki = (wikiId) => {
    const wiki = wikiItems.find(w => w.id === wikiId)
    if (wiki && !selectedWikis.find(w => w.id === wikiId)) {
      const newSelected = [...selectedWikis, wiki]
      setSelectedWikis(newSelected)
      
      const currentValues = form.getFieldsValue()
      currentValues.wiki_ids = newSelected.map(w => w.id)
      // v2.4: 同步保存元数据
      currentValues.selected_wikis = buildWikiMetadata(newSelected)
      onUpdateConfig(selectedNode.id, currentValues)
    }
  }
  
  // 移除知识库
  const handleRemoveWiki = (wikiId) => {
    const newSelected = selectedWikis.filter(w => w.id !== wikiId)
    setSelectedWikis(newSelected)
    
    const currentValues = form.getFieldsValue()
    currentValues.wiki_ids = newSelected.map(w => w.id)
    // v2.4: 同步保存元数据
    currentValues.selected_wikis = buildWikiMetadata(newSelected)
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  // ========== 分类节点相关方法 ==========
  
  // 添加分类
  const handleAddCategory = () => {
    if (categories.length >= 100) {
      message.warning('最多支持100个分类')
      return
    }
    
    const newCategory = {
      id: `cat-${Date.now()}`,
      name: `分类${categories.length + 1}`,
      description: ''
    }
    const newCategories = [...categories, newCategory]
    setCategories(newCategories)
    
    // 更新节点配置
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  // 更新分类
  const handleUpdateCategory = (index, field, value) => {
    const newCategories = [...categories]
    newCategories[index] = { ...newCategories[index], [field]: value }
    setCategories(newCategories)
    
    // 更新节点配置
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  // 删除分类
  const handleRemoveCategory = (index) => {
    const newCategories = categories.filter((_, i) => i !== index)
    setCategories(newCategories)
    
    // 更新节点配置
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }
  
  // 计算总Token
  const totalTokens = selectedWikis.reduce((sum, w) => sum + (w.tokens || 0), 0)
  const formatTotalTokens = (tokens) => {
    if (tokens === 0) return '0'
    if (tokens < 1000) return `${tokens}`
    return `${(tokens / 1000).toFixed(1)}K`
  }
  
  // 范围图标
  const scopeIcons = {
    personal: <UserOutlined style={{ color: '#007AFF' }} />,
    team: <TeamOutlined style={{ color: '#34C759' }} />,
    global: <GlobalOutlined style={{ color: '#FF9500' }} />
  }
  
  // 无选中节点时显示空状态
  if (!selectedNode) {
    return (
      <div style={{ padding: inDrawer ? '24px 0' : '24px' }}>
        <Empty
          description="请选择一个节点"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }
  
  // 渲染保存按钮区域
  const renderSaveButton = () => {
    if (!inDrawer || !onSave) return null
    
    return (
      <div style={{ 
        padding: '16px 0', 
        borderBottom: '1px solid #f0f0f0',
        marginBottom: '16px'
      }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>
            {hasUnsavedChanges ? (
              <span style={{ color: '#faad14' }}>● 有未保存的更改</span>
            ) : (
              <span style={{ color: '#52c41a' }}>
                <CheckCircleOutlined /> 已保存
              </span>
            )}
          </span>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            loading={saving}
            disabled={!hasUnsavedChanges}
          >
            保存
          </Button>
        </Space>
      </div>
    )
  }
  
  // 渲染知识库节点配置
  const renderKnowledgeConfig = () => (
    <>
      <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
        <DatabaseOutlined /> 知识库配置
      </Divider>
      
      <Form.Item
        label="数据来源"
        name="source"
        initialValue="wiki"
      >
        <Select>
          <Select.Option value="wiki">
            <Space>
              <FileTextOutlined />
              <span>知识库文档（Wiki）</span>
            </Space>
          </Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item
        label="加载模式"
        name="mode"
        initialValue="direct"
      >
        <Select>
          <Select.Option value="direct">直接加载（完整内容）</Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item
        label="选择知识库"
        tooltip="可选择多个知识库，内容将合并后传递给下游节点"
      >
        {wikiItemsLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            placeholder="搜索并选择知识库..."
            showSearch
            optionFilterProp="children"
            value={null}
            onChange={handleAddWiki}
            style={{ width: '100%' }}
            filterOption={(input, option) =>
              (option?.children?.props?.children?.[1]?.props?.children || '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          >
            {wikiItems
              .filter(w => !selectedWikis.find(s => s.id === w.id))
              .map((wiki) => (
                <Select.Option key={wiki.id} value={wiki.id}>
                  <Space>
                    {scopeIcons[wiki.scope]}
                    <span>{wiki.title}</span>
                    <Tag color="blue" style={{ marginLeft: 'auto' }}>
                      {wiki.tokens_display} tokens
                    </Tag>
                  </Space>
                </Select.Option>
              ))}
          </Select>
        )}
      </Form.Item>
      
      {/* 已选择的知识库列表 */}
      {selectedWikis.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              已选择 ({selectedWikis.length}个，共 {formatTotalTokens(totalTokens)} tokens)
            </Text>
          </div>
          
          <List
            size="small"
            bordered
            dataSource={selectedWikis}
            style={{ 
              maxHeight: '200px', 
              overflow: 'auto',
              borderRadius: '8px',
              background: '#fafafa'
            }}
            renderItem={(wiki) => (
              <List.Item
                style={{ padding: '8px 12px' }}
                actions={[
                  <Tooltip title="移除" key="remove">
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveWiki(wiki.id)}
                    />
                  </Tooltip>
                ]}
              >
                <List.Item.Meta
                  avatar={scopeIcons[wiki.scope] || <FileTextOutlined />}
                  title={
                    <Space>
                      <span style={{ fontSize: '13px' }}>{wiki.title}</span>
                    </Space>
                  }
                  description={
                    <Tag color="processing" style={{ fontSize: '11px' }}>
                      {wiki.tokens_display} tokens
                    </Tag>
                  }
                />
              </List.Item>
            )}
          />
          
          {/* Token统计 */}
          <div style={{ 
            marginTop: '12px', 
            padding: '8px 12px', 
            background: '#e6f7ff', 
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            <InfoCircleOutlined style={{ color: '#1890ff', marginRight: '6px' }} />
            总计 <strong>{formatTotalTokens(totalTokens)}</strong> tokens 将作为上下文传递给下游LLM节点
          </div>
        </div>
      )}
    </>
  )
  
  // 渲染分类节点配置
  const renderClassifierConfig = () => (
    <>
      <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
        <BranchesOutlined /> 分类配置
      </Divider>
      
      <Form.Item
        label="AI模型"
        name="model"
        rules={[{ required: true, message: '请选择AI模型' }]}
        tooltip="选择用于分类的AI模型（推荐使用轻量模型）"
      >
        {modelsLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            placeholder="选择AI模型"
            showSearch
            optionFilterProp="children"
          >
            {availableModels.map((model) => (
              <Select.Option key={model.name} value={model.name}>
                {model.display_name}
              </Select.Option>
            ))}
          </Select>
        )}
      </Form.Item>
      
      <Form.Item
        label="背景知识"
        name="background_knowledge"
        tooltip="提供给AI的背景信息，帮助更准确地分类"
      >
        <Input.TextArea
          rows={4}
          placeholder="例如：这是一个电商客服系统，用户主要咨询商品、订单、售后相关问题..."
        />
      </Form.Item>
      
      <Form.Item
        label="聊天记录"
        name="history_turns"
        initialValue={6}
        tooltip="参考的历史对话轮数，帮助理解上下文"
      >
        <InputNumber
          min={0}
          max={20}
          style={{ width: '100%' }}
          addonAfter="轮"
        />
      </Form.Item>
      
      <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
        <TagOutlined /> 分类列表 ({categories.length}/100)
      </Divider>
      
      {/* 分类列表 */}
      <div style={{ marginBottom: '16px' }}>
        {categories.map((cat, index) => (
          <div 
            key={cat.id} 
            style={{ 
              marginBottom: '12px',
              padding: '12px',
              background: '#fafafa',
              borderRadius: '8px',
              border: '1px solid #f0f0f0'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <Tag color="orange" style={{ marginRight: '8px' }}>
                {index + 1}
              </Tag>
              <Input
                placeholder="分类名称"
                value={cat.name}
                onChange={(e) => handleUpdateCategory(index, 'name', e.target.value)}
                style={{ flex: 1, marginRight: '8px' }}
              />
              <Tooltip title="删除分类">
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemoveCategory(index)}
                />
              </Tooltip>
            </div>
            <Input.TextArea
              placeholder="分类描述（可选，帮助AI理解分类标准）"
              value={cat.description}
              onChange={(e) => handleUpdateCategory(index, 'description', e.target.value)}
              rows={2}
              style={{ fontSize: '12px' }}
            />
          </div>
        ))}
        
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={handleAddCategory}
          disabled={categories.length >= 100}
        >
          添加分类
        </Button>
        
        {categories.length === 0 && (
          <div style={{ 
            marginTop: '12px', 
            padding: '8px 12px', 
            background: '#fff7e6', 
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            <InfoCircleOutlined style={{ color: '#faad14', marginRight: '6px' }} />
            请至少添加一个分类类别
          </div>
        )}
      </div>
    </>
  )
  
  // 渲染配置表单内容
  const renderConfigForm = () => (
    <Form
      form={form}
      layout="vertical"
      onValuesChange={handleValuesChange}
      size="small"
    >
      {/* 节点名称 - 通用配置 */}
      <Form.Item
        label="节点名称"
        name="label"
        initialValue={selectedNode.data?.label}
      >
        <Input placeholder="输入节点名称" />
      </Form.Item>
      
      {/* LLM节点特殊配置 */}
      {selectedNode.type === 'llm' && (
        <>
          <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
            <SettingOutlined /> AI配置
          </Divider>
          
          <Form.Item
            label="系统提示词"
            name="system_prompt"
            tooltip="可选，用于设定AI的角色和行为"
          >
            <Input.TextArea
              rows={4}
              placeholder="例如: 你是一个专业的AI助手..."
            />
          </Form.Item>
          
          <Form.Item
            label="AI模型"
            name="model"
            rules={[{ required: true, message: '请选择AI模型' }]}
          >
            {modelsLoading ? (
              <Spin size="small" />
            ) : (
              <Select
                placeholder="选择AI模型"
                showSearch
                optionFilterProp="children"
              >
                {availableModels.map((model) => (
                  <Select.Option key={model.name} value={model.name}>
                    {model.display_name} ({model.credits_display || `${model.credits_per_chat} 积分/次`})
                  </Select.Option>
                ))}
              </Select>
            )}
          </Form.Item>
          
          <Form.Item
            label="历史轮数"
            name="history_turns"
            initialValue={10}
            tooltip="对话测试时保留的历史轮数（0=无记忆，10=推荐）"
          >
            <Slider
              min={0}
              max={100}
              marks={{
                0: '0',
                10: '10',
                50: '50',
                100: '100'
              }}
              tooltip={{
                formatter: (value) => `${value}轮 (${value * 2}条消息)`
              }}
            />
          </Form.Item>
          
          <Form.Item
            label="温度"
            name="temperature"
            initialValue={0.7}
            tooltip="控制回复的随机性（0=精确，2=创意）"
          >
            <InputNumber
              min={0}
              max={2}
              step={0.1}
              style={{ width: '100%' }}
            />
          </Form.Item>
          
          <Form.Item
            label="最大Token数"
            name="max_tokens"
            initialValue={2000}
            tooltip="单次回复的最大长度"
          >
            <InputNumber
              min={100}
              max={8192}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </>
      )}
      
      {/* 开始节点配置 */}
      {selectedNode.type === 'start' && (
        <>
          <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
            <InfoCircleOutlined /> 入口配置
          </Divider>
          
          <Form.Item
            label="欢迎语"
            name="welcome_message"
            tooltip="可选，测试时显示的欢迎消息"
          >
            <Input.TextArea
              rows={3}
              placeholder="你好！我是AI助手，有什么可以帮你的吗？"
            />
          </Form.Item>
          
          <Form.Item
            label="输入参数"
            name="input_schema"
            tooltip="定义工作流的输入参数（JSON格式，可选）"
          >
            <Input.TextArea
              rows={4}
              placeholder='{"param1": "value1"}'
            />
          </Form.Item>
        </>
      )}
      
      {/* 结束节点配置（保留兼容旧数据） */}
      {selectedNode.type === 'end' && (
        <>
          <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
            <InfoCircleOutlined /> 输出配置
          </Divider>
          
          <Form.Item
            label="输出映射"
            name="output_mapping"
            tooltip="定义如何映射最终输出"
          >
            <Input.TextArea
              rows={4}
              placeholder="result"
            />
          </Form.Item>
        </>
      )}
      
      {/* 知识库节点配置 */}
      {selectedNode.type === 'knowledge' && renderKnowledgeConfig()}
      
      {/* 分类节点配置 */}
      {selectedNode.type === 'classifier' && renderClassifierConfig()}
    </Form>
  )
  
  // 节点信息展示
  const renderNodeInfo = () => (
    <div style={{ 
      marginTop: '16px', 
      padding: '12px', 
      background: '#f5f5f5', 
      borderRadius: '8px' 
    }}>
      <div style={{ fontSize: '12px', color: '#666' }}>
        <strong>节点ID:</strong> {selectedNode.id}
      </div>
      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
        <strong>类型:</strong> {selectedNode.type}
      </div>
    </div>
  )
  
  // 如果在Drawer中使用，不需要外层Card
  if (inDrawer) {
    return (
      <div className="config-panel-content">
        {renderSaveButton()}
        {renderConfigForm()}
        {renderNodeInfo()}
      </div>
    )
  }
  
  // 独立使用时带Card包装
  return (
    <div className="workflow-editor-config-panel">
      <Card
        title={`${selectedNode.data?.label || selectedNode.type} 配置`}
        size="small"
        bodyStyle={{ padding: '16px' }}
      >
        {renderConfigForm()}
        {renderNodeInfo()}
      </Card>
    </div>
  )
}

export default ConfigPanel
