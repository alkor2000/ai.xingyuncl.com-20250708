/**
 * 配置面板 - 显示选中节点的配置选项
 * v2.1 - 添加保存按钮，显示保存状态
 * v2.2 - 知识库节点支持选择Wiki文档，显示Token数量
 * 支持编辑节点参数
 */

import React, { useEffect, useState } from 'react'
import { 
  Card, Form, Input, Select, InputNumber, Empty, Spin, Slider, Divider, 
  Button, Space, Tag, List, Tooltip, Typography 
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
  PlusOutlined
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
        // 从wikiItems中找到对应的完整信息
        const selected = (config.wiki_ids || []).map(id => {
          const item = wikiItems.find(w => w.id === id)
          return item || { id, title: `知识库 #${id}`, tokens_display: '未知' }
        }).filter(Boolean)
        setSelectedWikis(selected)
      } else {
        setSelectedWikis([])
      }
    } else {
      form.resetFields()
      setSelectedWikis([])
    }
  }, [selectedNode, form, wikiItems])
  
  // 知识库节点选中时加载知识库列表
  useEffect(() => {
    if (selectedNode?.type === 'knowledge' && wikiItems.length === 0) {
      fetchWikiItems()
    }
  }, [selectedNode?.type])
  
  // 表单值变化时更新节点配置
  const handleValuesChange = (changedValues, allValues) => {
    if (selectedNode) {
      // 如果是知识库节点，需要同步wiki_ids
      if (selectedNode.type === 'knowledge') {
        allValues.wiki_ids = selectedWikis.map(w => w.id)
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
      
      // 更新表单和节点配置
      const currentValues = form.getFieldsValue()
      currentValues.wiki_ids = newSelected.map(w => w.id)
      onUpdateConfig(selectedNode.id, currentValues)
    }
  }
  
  // 移除知识库
  const handleRemoveWiki = (wikiId) => {
    const newSelected = selectedWikis.filter(w => w.id !== wikiId)
    setSelectedWikis(newSelected)
    
    // 更新表单和节点配置
    const currentValues = form.getFieldsValue()
    currentValues.wiki_ids = newSelected.map(w => w.id)
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
