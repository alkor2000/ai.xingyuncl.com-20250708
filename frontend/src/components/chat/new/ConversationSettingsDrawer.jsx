/**
 * 对话设置抽屉组件
 * 
 * v3.0 变更：
 *   - 移除预设系统提示词选择功能（SystemPromptSettings已从后台移除）
 *   - 保留自定义系统提示词输入框
 * v2.0 变更：
 *   - 新增"深度思考"开关（enable_thinking）
 *   - 仅在选择 Claude 系列模型时显示
 *
 * 修复（2026-06-29 模型选择器"暂无数据"全局故障）：
 *   移除模型下拉的 aiModels.filter(m => m.is_active)，直接渲染 aiModels。
 *   根因与 ConversationFormModal 相同：后端 getModels 改为白名单返回后不含 is_active 字段，
 *   前端 filter(m => m.is_active) 过滤为空导致编辑对话时模型下拉"暂无数据"。
 *   安全性确认：后端 AIModel.getUserAvailableModels 的 SQL 已含 WHERE m.is_active = true，
 *   被超管禁用的模型不会返回前端，前端这层过滤冗余，去掉不影响管理员禁用模型功能。
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
  Alert,
  Switch
} from 'antd'
import {
  InfoCircleOutlined,
  FileTextOutlined,
  GroupOutlined,
  AppstoreAddOutlined,
  WarningOutlined,
  BulbOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../../stores/chatStore'

const { TextArea } = Input
const { Option } = Select

/**
 * 检测模型名称是否为 Claude 系列
 */
const isClaudeModel = (modelName) => {
  if (!modelName) return false
  return modelName.toLowerCase().includes('claude')
}

const ConversationSettingsDrawer = ({
  visible,
  form,
  aiModels = [],
  onClose,
  onSubmit
}) => {
  const { t } = useTranslation()
  const { moduleCombinations, getModuleCombinations } = useChatStore()
  const [selectedCombination, setSelectedCombination] = useState(null)
  const [isAzureModel, setIsAzureModel] = useState(false)
  const [temperatureValue, setTemperatureValue] = useState(0.7)
  const [showThinkingSwitch, setShowThinkingSwitch] = useState(false)

  /* 加载模块组合（不再加载系统提示词） */
  useEffect(() => {
    if (visible) {
      getModuleCombinations()
    }
  }, [visible, getModuleCombinations])

  /* 检查是否为Azure模型 */
  const checkIsAzureModel = (modelName) => {
    const model = aiModels.find(m => m.name === modelName)
    if (!model) return false
    if (model.provider === 'azure' || model.provider === 'azure-openai') return true
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') return true
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|')
      if (parts.length === 3) return true
    }
    return false
  }

  /* 处理模型选择变化 */
  const handleModelChange = (modelName) => {
    const isAzure = checkIsAzureModel(modelName)
    setIsAzureModel(isAzure)
    
    if (isAzure) {
      setTemperatureValue(1)
      form.setFieldValue('ai_temperature', 1)
    } else {
      const currentTemp = form.getFieldValue('ai_temperature') || 0.7
      setTemperatureValue(currentTemp)
    }

    const isClaude = isClaudeModel(modelName)
    setShowThinkingSwitch(isClaude)
    if (!isClaude) {
      form.setFieldValue('enable_thinking', false)
    }
  }

  /* 初始化表单状态 */
  useEffect(() => {
    if (visible) {
      const moduleCombinationId = form.getFieldValue('module_combination_id')
      const modelName = form.getFieldValue('model_name')
      const currentTemp = form.getFieldValue('ai_temperature') || 0.7
      
      const isAzure = checkIsAzureModel(modelName)
      setIsAzureModel(isAzure)
      
      if (isAzure) {
        setTemperatureValue(1)
        form.setFieldValue('ai_temperature', 1)
      } else {
        setTemperatureValue(currentTemp)
      }

      setShowThinkingSwitch(isClaudeModel(modelName))
      
      if (moduleCombinationId) {
        const combination = moduleCombinations.find(c => c.id === moduleCombinationId)
        setSelectedCombination(combination)
      } else {
        setSelectedCombination(null)
      }
    }
  }, [visible, form, moduleCombinations, aiModels])

  /* 处理模块组合选择 */
  const handleCombinationChange = (combinationId) => {
    if (combinationId) {
      const combination = moduleCombinations.find(c => c.id === combinationId)
      setSelectedCombination(combination)
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: '',
        module_combination_id: combinationId
      })
    } else {
      setSelectedCombination(null)
      form.setFieldsValue({ module_combination_id: null })
    }
  }

  /* 处理表单提交 */
  const handleSubmit = (values) => {
    /* v3.0: 不再处理system_prompt_id，只保留自定义system_prompt */
    values.system_prompt_id = null
    
    if (isAzureModel) {
      values.ai_temperature = 1
    }

    if (values.enable_thinking !== undefined) {
      values.enable_thinking = values.enable_thinking ? 1 : 0
    }
    
    onSubmit(values)
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
          <Button onClick={onClose}>{t('button.cancel')}</Button>
          <Button type="primary" onClick={() => form.submit()}>{t('button.save')}</Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
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
            {/* 修复：去掉 filter(m => m.is_active)，直接渲染 aiModels（后端已只返回激活模型） */}
            {aiModels.map(model => (
              <Option key={model.name} value={model.name}>
                <Space>
                  {model.display_name}
                  <Tag color="blue" size="small">{model.credits_per_chat}{t('unit.credits')}</Tag>
                  {model.stream_enabled && <Tag color="processing" size="small">{t('chat.stream')}</Tag>}
                  {model.image_upload_enabled && <Tag color="success" size="small">{t('chat.image')}</Tag>}
                  {(model.provider === 'azure' || model.api_endpoint === 'azure') && <Tag color="orange" size="small">Azure</Tag>}
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 深度思考开关 - 仅 Claude 系列模型显示 */}
        {showThinkingSwitch && (
          <Form.Item
            name="enable_thinking"
            label={
              <Space>
                <BulbOutlined style={{ color: '#fa8c16' }} />
                {t('chat.thinking.enableLabel') || '深度思考'}
                <Tooltip title={t('chat.thinking.enableTooltip') || 'Claude推理模型支持深度思考能力，开启后模型会先进行推理分析再输出答案'}>
                  <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                </Tooltip>
              </Space>
            }
            valuePropName="checked"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        )}

        {showThinkingSwitch && form.getFieldValue('enable_thinking') && (
          <Alert
            message={t('chat.thinking.enabledWarning') || '深度思考已开启'}
            description={t('chat.thinking.enabledWarningDesc') || '模型将在回答前进行推理分析，会消耗更多Token和响应时间。'}
            type="info"
            showIcon
            icon={<BulbOutlined />}
            style={{ marginBottom: 16, marginTop: -8 }}
          />
        )}

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
                <Option key={combination.id} value={combination.id} label={combination.name} disabled={!combination.is_active}>
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ fontWeight: 500, marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      <Space>
                        <GroupOutlined />
                        {combination.name}
                        <Tag color="blue" size="small">{combination.module_count || 0} 个模块</Tag>
                        {combination.estimated_tokens > 0 && <Tag color="orange" size="small">约 {combination.estimated_tokens} tokens</Tag>}
                      </Space>
                    </div>
                    {combination.description && (
                      <div style={{ fontSize: '12px', color: '#666', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.5' }}>
                        {combination.description}
                      </div>
                    )}
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

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

        {/* v3.0: 自定义系统提示词输入框（始终显示，不再有预设选择） */}
        {!selectedCombination && (
          <Form.Item
            name="system_prompt"
            label={
              <Space>
                <FileTextOutlined />
                {t('chat.form.systemPrompt')}
              </Space>
            }
          >
            <TextArea rows={4} placeholder={t('chat.form.systemPrompt.placeholder')} />
          </Form.Item>
        )}

        {/* 隐藏的字段 */}
        <Form.Item name="system_prompt_id" hidden><Input /></Form.Item>

        <Form.Item
          name="context_length"
          label={
            <Space>
              {t('chat.form.contextLength')}
              <Tooltip title={t('chat.form.contextLength.tooltip')}><InfoCircleOutlined /></Tooltip>
            </Space>
          }
        >
          <InputNumber min={0} max={100} style={{ width: '100%' }} />
        </Form.Item>

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
              <Tooltip title={isAzureModel ? "Azure 模型仅支持温度值 1.0" : t('chat.form.temperature.tooltip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <Slider
            min={0} max={1} step={0.1}
            value={temperatureValue}
            onChange={(value) => { if (!isAzureModel) { setTemperatureValue(value); form.setFieldValue('ai_temperature', value) } }}
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
              <Tooltip title={t('chat.form.priority.tooltip')}><InfoCircleOutlined /></Tooltip>
            </Space>
          }
        >
          <InputNumber min={0} max={10} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

export default ConversationSettingsDrawer
