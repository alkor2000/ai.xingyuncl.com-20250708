/**
 * 配置面板 - 显示选中节点的配置选项
 * v2.1 - 添加保存按钮，显示保存状态
 * 支持编辑节点参数
 */

import React, { useEffect } from 'react'
import { Card, Form, Input, Select, InputNumber, Empty, Spin, Slider, Divider, Button, Space } from 'antd'
import { 
  SettingOutlined,
  InfoCircleOutlined,
  SaveOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import useAgentStore from '../../../../stores/agentStore'

const ConfigPanel = ({ 
  selectedNode, 
  onUpdateConfig, 
  onSave,
  saving = false,
  hasUnsavedChanges = false,
  inDrawer = false 
}) => {
  const [form] = Form.useForm()
  
  // 获取用户可用模型列表
  const { availableModels, modelsLoading, fetchAvailableModels } = useAgentStore()
  
  // 加载模型列表
  useEffect(() => {
    if (availableModels.length === 0) {
      fetchAvailableModels()
    }
  }, [])
  
  // 当选中节点变化时，重置表单
  useEffect(() => {
    if (selectedNode) {
      form.setFieldsValue(selectedNode.data?.config || {})
    } else {
      form.resetFields()
    }
  }, [selectedNode, form])
  
  // 表单值变化时更新节点配置
  const handleValuesChange = (changedValues, allValues) => {
    if (selectedNode) {
      onUpdateConfig(selectedNode.id, allValues)
    }
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
      {selectedNode.type === 'knowledge' && (
        <>
          <Divider orientation="left" plain style={{ fontSize: '12px', margin: '16px 0 12px' }}>
            <InfoCircleOutlined /> 检索配置
          </Divider>
          
          <Form.Item
            label="知识库"
            name="knowledge_base"
            tooltip="选择要检索的知识库"
          >
            <Input placeholder="输入知识库名称" />
          </Form.Item>
          
          <Form.Item
            label="检索模式"
            name="search_mode"
            initialValue="vector"
          >
            <Select>
              <Select.Option value="vector">向量检索</Select.Option>
              <Select.Option value="keyword">关键词检索</Select.Option>
              <Select.Option value="hybrid">混合检索</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            label="Top-K"
            name="top_k"
            initialValue={5}
            tooltip="返回前K个最相关的结果"
          >
            <InputNumber
              min={1}
              max={20}
              style={{ width: '100%' }}
            />
          </Form.Item>
          
          <Form.Item
            label="相似度阈值"
            name="threshold"
            initialValue={0.7}
            tooltip="最低相似度分数"
          >
            <InputNumber
              min={0}
              max={1}
              step={0.1}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </>
      )}
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
