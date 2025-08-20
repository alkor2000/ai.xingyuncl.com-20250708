/**
 * 对话设置抽屉组件 - 支持系统提示词选择和模块组合
 * 支持Azure模型温度限制
 */

import React, { useEffect, useState } from 'react'
import {
  Drawer,
  Form,
  Input,
  Select,
  InputNumber,
  Slider,
  Space,
  Button,
  Tag,
  Tooltip,
  Divider,
  Alert
} from 'antd'
import {
  InfoCircleOutlined,
  FileTextOutlined,
  GroupOutlined,
  AppstoreAddOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../../stores/chatStore'

const { TextArea } = Input
const { Option } = Select

const ConversationSettingsDrawer = ({
  visible,
  form,
  aiModels = [],
  onClose,
  onSubmit
}) => {
  const { t } = useTranslation()
  const { systemPrompts, getSystemPrompts, moduleCombinations, getModuleCombinations } = useChatStore()
  const [customPromptMode, setCustomPromptMode] = useState(false)
  const [selectedPromptContent, setSelectedPromptContent] = useState('')
  const [selectedCombination, setSelectedCombination] = useState(null)
  const [isAzureModel, setIsAzureModel] = useState(false)
  const [temperatureValue, setTemperatureValue] = useState(0.7)

  // 加载系统提示词和模块组合
  useEffect(() => {
    if (visible) {
      getSystemPrompts()
      getModuleCombinations()
    }
  }, [visible, getSystemPrompts, getModuleCombinations])

  // 检查是否为Azure模型
  const checkIsAzureModel = (modelName) => {
    const model = aiModels.find(m => m.name === modelName)
    if (!model) return false
    
    // 检查provider是否为azure
    if (model.provider === 'azure' || model.provider === 'azure-openai') {
      return true
    }
    
    // 检查api_endpoint是否为azure
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') {
      return true
    }
    
    // 检查api_key是否包含Azure格式（包含|分隔符）
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|')
      if (parts.length === 3) {
        return true
      }
    }
    
    return false
  }

  // 处理模型选择变化
  const handleModelChange = (modelName) => {
    const isAzure = checkIsAzureModel(modelName)
    setIsAzureModel(isAzure)
    
    if (isAzure) {
      // Azure模型强制设置温度为1
      setTemperatureValue(1)
      form.setFieldValue('ai_temperature', 1)
    } else {
      // 非Azure模型保持当前温度或使用默认值
      const currentTemp = form.getFieldValue('ai_temperature') || 0.7
      setTemperatureValue(currentTemp)
    }
  }

  // 初始化表单状态
  useEffect(() => {
    if (visible) {
      const systemPromptId = form.getFieldValue('system_prompt_id')
      const systemPrompt = form.getFieldValue('system_prompt')
      const moduleCombinationId = form.getFieldValue('module_combination_id')
      const modelName = form.getFieldValue('model_name')
      const currentTemp = form.getFieldValue('ai_temperature') || 0.7
      
      // 检查当前模型是否为Azure
      const isAzure = checkIsAzureModel(modelName)
      setIsAzureModel(isAzure)
      
      // 设置温度值
      if (isAzure) {
        setTemperatureValue(1)
        form.setFieldValue('ai_temperature', 1)
      } else {
        setTemperatureValue(currentTemp)
      }
      
      // 如果有模块组合
      if (moduleCombinationId) {
        const combination = moduleCombinations.find(c => c.id === moduleCombinationId)
        setSelectedCombination(combination)
        setCustomPromptMode(false)
        setSelectedPromptContent('')
      }
      // 如果有自定义的系统提示词但没有system_prompt_id，设置为自定义模式
      else if (systemPrompt && !systemPromptId) {
        setCustomPromptMode(true)
        setSelectedPromptContent('')
        setSelectedCombination(null)
      } else if (systemPromptId) {
        // 如果有system_prompt_id，显示对应的描述
        setCustomPromptMode(false)
        const selectedPrompt = systemPrompts.find(p => p.id === systemPromptId)
        if (selectedPrompt) {
          setSelectedPromptContent(selectedPrompt.description || '')
        }
        setSelectedCombination(null)
      } else {
        // 都没有的情况
        setCustomPromptMode(false)
        setSelectedPromptContent('')
        setSelectedCombination(null)
      }
    }
  }, [visible, form, systemPrompts, moduleCombinations, aiModels])

  // 处理系统提示词选择
  const handleSystemPromptChange = (promptId) => {
    if (promptId === 'custom') {
      // 切换到自定义模式
      setCustomPromptMode(true)
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: form.getFieldValue('system_prompt') || '',
        module_combination_id: null // 清空模块组合
      })
      setSelectedCombination(null)
    } else if (promptId) {
      // 选择了预设提示词
      setCustomPromptMode(false)
      const selectedPrompt = systemPrompts.find(p => p.id === promptId)
      if (selectedPrompt) {
        setSelectedPromptContent(selectedPrompt.description || '')
        form.setFieldsValue({
          system_prompt_id: promptId,
          system_prompt: '', // 清空自定义内容
          module_combination_id: null // 清空模块组合
        })
        setSelectedCombination(null)
      }
    } else {
      // 清空选择
      setCustomPromptMode(false)
      setSelectedPromptContent('')
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: ''
      })
    }
  }

  // 处理模块组合选择
  const handleCombinationChange = (combinationId) => {
    if (combinationId) {
      const combination = moduleCombinations.find(c => c.id === combinationId)
      setSelectedCombination(combination)
      
      // 如果选择了模块组合，清空系统提示词选择（避免冲突）
      if (combination && combination.module_count > 0) {
        setCustomPromptMode(false)
        setSelectedPromptContent('')
        form.setFieldsValue({
          system_prompt_id: null,
          system_prompt: '',
          module_combination_id: combinationId
        })
      }
    } else {
      setSelectedCombination(null)
      form.setFieldsValue({
        module_combination_id: null
      })
    }
  }

  // 处理表单提交
  const handleSubmit = (values) => {
    // 如果是自定义模式，清空system_prompt_id
    if (customPromptMode) {
      values.system_prompt_id = null
    } else if (values.system_prompt_id) {
      // 如果选择了预设提示词，清空自定义内容
      values.system_prompt = null
    }
    
    // 确保Azure模型的温度为1
    if (isAzureModel) {
      values.ai_temperature = 1
    }
    
    onSubmit(values)
  }

  // 获取当前选择的值
  const getCurrentPromptValue = () => {
    if (customPromptMode) return 'custom'
    return form.getFieldValue('system_prompt_id')
  }

  return (
    <Drawer
      title={t('chat.conversation.settings')}
      placement="right"
      width={500}
      open={visible}
      onClose={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>
            {t('button.cancel')}
          </Button>
          <Button type="primary" onClick={() => form.submit()}>
            {t('button.save')}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="title"
          label={t('chat.form.title')}
          rules={[{ required: true, message: t('chat.form.title.required') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="model_name"
          label={t('chat.form.model')}
          rules={[{ required: true, message: t('chat.form.model.required') }]}
        >
          <Select onChange={handleModelChange}>
            {aiModels.filter(m => m.is_active).map(model => (
              <Option key={model.name} value={model.name}>
                <Space>
                  {model.display_name}
                  <Tag color="blue" size="small">
                    {model.credits_per_chat}{t('unit.credits')}
                  </Tag>
                  {model.stream_enabled && (
                    <Tag color="processing" size="small">
                      {t('chat.stream')}
                    </Tag>
                  )}
                  {model.image_upload_enabled && (
                    <Tag color="success" size="small">
                      {t('chat.image')}
                    </Tag>
                  )}
                  {(model.provider === 'azure' || model.api_endpoint === 'azure') && (
                    <Tag color="orange" size="small">
                      Azure
                    </Tag>
                  )}
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 模块组合选择 */}
        {moduleCombinations.length > 0 && (
          <Form.Item
            name="module_combination_id"
            label={
              <Space>
                <AppstoreAddOutlined />
                模块组合
                <Tooltip title="选择预设的知识模块组合，可以让AI获得特定领域的知识和能力">
                  <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                </Tooltip>
              </Space>
            }
          >
            <Select
              placeholder="选择知识模块组合（可选）"
              allowClear
              onChange={handleCombinationChange}
              style={{ width: '100%' }}
              optionLabelProp="label"
              dropdownMatchSelectWidth={false}
              dropdownStyle={{ minWidth: 400 }}
            >
              {moduleCombinations.map(combination => (
                <Option 
                  key={combination.id} 
                  value={combination.id}
                  label={combination.name}
                  disabled={!combination.is_active}
                >
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ 
                      fontWeight: 500,
                      marginBottom: 4,
                      whiteSpace: 'normal',
                      wordBreak: 'break-word'
                    }}>
                      <Space>
                        <GroupOutlined />
                        {combination.name}
                        <Tag color="blue" size="small">
                          {combination.module_count || 0} 个模块
                        </Tag>
                        {combination.estimated_tokens > 0 && (
                          <Tag color="orange" size="small">
                            约 {combination.estimated_tokens} tokens
                          </Tag>
                        )}
                      </Space>
                    </div>
                    {combination.description && (
                      <div style={{ 
                        fontSize: '12px', 
                        color: '#666',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: '1.5'
                      }}>
                        {combination.description}
                      </div>
                    )}
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

        {/* 显示选中的模块组合信息 */}
        {selectedCombination && (
          <Alert
            message="已选择模块组合"
            description={
              <div>
                <div>{selectedCombination.description}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  包含 {selectedCombination.module_count || 0} 个知识模块，
                  预计消耗 {selectedCombination.estimated_tokens || 0} tokens
                </div>
              </div>
            }
            type="info"
            showIcon
            icon={<GroupOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 系统提示词选择 - 仅在未选择模块组合时显示 */}
        {!selectedCombination && systemPrompts.length > 0 && (
          <Form.Item
            label={
              <Space>
                <FileTextOutlined />
                系统提示词
              </Space>
            }
          >
            <Select
              placeholder="选择预设的系统提示词（可选）"
              allowClear
              value={getCurrentPromptValue()}
              onChange={handleSystemPromptChange}
              style={{ width: '100%' }}
              optionLabelProp="label"
              dropdownMatchSelectWidth={false}
              dropdownStyle={{ minWidth: 400 }}
              dropdownRender={menu => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ padding: '0 8px 4px' }}>
                    <Button
                      type="text"
                      icon={<FileTextOutlined />}
                      block
                      onClick={() => handleSystemPromptChange('custom')}
                    >
                      自定义系统提示词
                    </Button>
                  </div>
                </>
              )}
            >
              {systemPrompts.map(prompt => (
                <Option 
                  key={prompt.id} 
                  value={prompt.id}
                  label={prompt.name}
                >
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ 
                      fontWeight: 500,
                      marginBottom: prompt.description ? 4 : 0,
                      whiteSpace: 'normal',
                      wordBreak: 'break-word'
                    }}>
                      {prompt.name}
                    </div>
                    {prompt.description && (
                      <div style={{ 
                        fontSize: '12px', 
                        color: '#666',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: '1.5'
                      }}>
                        {prompt.description}
                      </div>
                    )}
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

        {/* 显示选中的提示词描述 */}
        {selectedPromptContent && !customPromptMode && !selectedCombination && (
          <div style={{ 
            marginTop: -16, 
            marginBottom: 16, 
            padding: '8px 12px', 
            background: '#f5f5f5', 
            borderRadius: 4,
            fontSize: '13px',
            color: '#666',
            lineHeight: '1.5'
          }}>
            {selectedPromptContent}
          </div>
        )}

        {/* 自定义系统提示词输入框 */}
        {!selectedCombination && (customPromptMode || systemPrompts.length === 0) && (
          <Form.Item
            name="system_prompt"
            label={t('chat.form.systemPrompt')}
          >
            <TextArea 
              rows={4} 
              placeholder={t('chat.form.systemPrompt.placeholder')} 
            />
          </Form.Item>
        )}

        {/* 隐藏的字段 */}
        <Form.Item name="system_prompt_id" hidden>
          <Input />
        </Form.Item>

        <Form.Item
          name="context_length"
          label={
            <Space>
              {t('chat.form.contextLength')}
              <Tooltip title={t('chat.form.contextLength.tooltip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber 
            min={0} 
            max={100} 
            style={{ width: '100%' }} 
          />
        </Form.Item>

        {/* Azure模型温度提示 */}
        {isAzureModel && (
          <Alert
            message="Azure 模型温度限制"
            description="此 Azure 模型仅支持温度值 1.0（创造性），无法调整。"
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item
          name="ai_temperature"
          label={
            <Space>
              {t('chat.form.temperature')}
              <Tooltip title={
                isAzureModel 
                  ? "Azure 模型仅支持温度值 1.0" 
                  : t('chat.form.temperature.tooltip')
              }>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <Slider
            min={0}
            max={1}
            step={0.1}
            value={temperatureValue}
            onChange={(value) => {
              if (!isAzureModel) {
                setTemperatureValue(value)
                form.setFieldValue('ai_temperature', value)
              }
            }}
            disabled={isAzureModel}
            marks={{
              0: t('chat.form.temperature.precise'),
              0.5: t('chat.form.temperature.balanced'),
              1: t('chat.form.temperature.creative')
            }}
          />
        </Form.Item>

        <Form.Item
          name="priority"
          label={
            <Space>
              {t('chat.form.priority')}
              <Tooltip title={t('chat.form.priority.tooltip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber 
            min={0} 
            max={10} 
            style={{ width: '100%' }} 
          />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

export default ConversationSettingsDrawer
