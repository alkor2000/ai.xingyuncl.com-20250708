/**
 * 新建对话弹窗组件
 *
 * 功能：创建对话时选择模型、模块组合、系统提示词（预设或自定义）、
 *       上下文长度、温度、优先级。支持 Azure 模型的温度限制。
 *
 * 历史修复（保留说明以免后人重蹈）：
 *   曾对 aiModels 做 m.is_active 过滤/判断（共 3 处：下拉渲染、默认模型查找、
 *   兜底默认模型），导致模型下拉"暂无数据"且无法新建对话。
 *   根因：后端 /chat/models（getModels）改为白名单显式返回字段以堵 api_key 泄露，
 *   白名单中不含 is_active，前端 m.is_active 全为 undefined。
 *   安全性确认：后端 AIModel.getUserAvailableModels 的 SQL 已含
 *   WHERE m.is_active = true，被禁用的模型根本不会出现在 aiModels 中，
 *   前端这层过滤是冗余的，去掉后管理员禁用模型功能依然有效。
 *
 * ============================================================
 * 国际化关键决策
 * ============================================================
 *
 * 【1】15 处硬编码文案改 t()，全部复用第 17 批新增的 chat.* 键
 *   与 ConversationSettingsDrawer 共用同一批键（模块组合 7 键、Azure 3 键），
 *   两组件文案完全一致，不重复建键。
 *
 * 【2】跨行 JSX 拼接改整句插值
 *   原代码分两行书写：
 *     包含 {selectedCombination.module_count} 个知识模块，
 *     预计消耗 {selectedCombination.estimated_tokens} tokens
 *   英文须为 "Includes N knowledge modules, consuming about M tokens" ——
 *   中文"预计消耗"为独立动词短语，英文用现在分词接续，语序不同，
 *   无法用同样的分行拼接得到，故改 selectedDesc 整句插值。
 *
 * 【3】温度 Tooltip 使用 tooltipShort 而非复用 temperature.tooltip
 *   本文件原有独立文案"Temperature控制AI回复的创造性。0=精确，1=创造性"，
 *   与 Drawer 使用的 chat.form.temperature.tooltip
 *   （"控制AI回复的创造性。值越低回复越保守精确..."）措辞不同、长度不同。
 *   为保持两处原有的表达差异，新建 tooltipShort 键承载本文件的简短版本，
 *   而非强行统一到一个键（那会改变其中一处的既有文案）。
 *   0 与 1 抽为 TEMPERATURE_MIN/MAX 常量并作 {{min}}/{{max}} 插值。
 *
 * 【4】Azure 温度值抽常量并作插值
 *   原文案硬编码"仅支持温度值 1.0"，与代码中三处赋值 1 脱钩。
 *   现用 AZURE_FIXED_TEMPERATURE 同时驱动赋值与 {{value}} 插值。
 *
 * 【5】两个 useEffect 依赖数组均不含 t
 *   第一个负责加载系统提示词与模块组合（加 t 会重复请求）；
 *   第二个负责设置表单默认值，内含 setFieldsValue（加 t 会在切语言时
 *   覆盖用户尚未提交的输入，属真实数据丢失风险）。
 *   本文件所有 t() 调用均在渲染期，不在 callback 内，故无需 tRef 模式。
 *
 * 【6】不翻译的内容
 *   combination.name / description、prompt.name / description
 *   （用户创建或后台录入的业务数据）
 *   model.display_name、Azure（产品名）、Temperature（参数名）、tokens（术语）
 *   provider / api_endpoint 判定字符串（技术标识）
 *   'custom' 特殊值（内部控制标识，非文案）
 */

import React, { useEffect, useState } from 'react'
import {
  Modal,
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
import useSystemConfigStore from '../../../stores/systemConfigStore'
import useChatStore from '../../../stores/chatStore'

const { TextArea } = Input
const { Option } = Select

// ==================== 业务规则常量 ====================

/** Azure 模型强制使用的温度值，同时用于赋值与 {{value}} 插值 */
const AZURE_FIXED_TEMPERATURE = 1

/** 温度区间与步进 */
const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 1
const TEMPERATURE_STEP = 0.1
/** 温度滑块中间刻度位置 */
const TEMPERATURE_MID = 0.5
/** 未取到系统配置时的兜底温度 */
const FALLBACK_TEMPERATURE = 0.7

/** 新建对话的默认上下文条数 */
const DEFAULT_CONTEXT_LENGTH = 20
/** 上下文条数区间 */
const CONTEXT_MIN = 0
const CONTEXT_MAX = 100

/** 优先级区间与默认值（数值越大排序越靠前） */
const PRIORITY_MIN = 0
const PRIORITY_MAX = 10
const DEFAULT_PRIORITY = 0

/** 自定义系统提示词输入框行数 */
const PROMPT_TEXTAREA_ROWS = 3

/**
 * 系统提示词下拉中"自定义"选项的特殊值。
 * 属内部控制标识而非文案，不国际化。
 */
const CUSTOM_PROMPT_VALUE = 'custom'

// ==================== 布局常量 ====================
const MODAL_WIDTH = 600
/** 下拉的最小展开宽度（组合名与描述较长，需比输入框更宽） */
const DROPDOWN_MIN_WIDTH = 400

const ConversationFormModal = ({
  visible,
  form,
  aiModels = [],
  onCancel,
  onSubmit
}) => {
  const { t } = useTranslation()
  const { getDefaultAIModel, getDefaultTemperature } = useSystemConfigStore()
  const {
    systemPrompts,
    getSystemPrompts,
    moduleCombinations,
    getModuleCombinations
  } = useChatStore()
  const [customPromptMode, setCustomPromptMode] = useState(false)
  const [selectedPromptContent, setSelectedPromptContent] = useState('')
  const [selectedCombination, setSelectedCombination] = useState(null)
  const [isAzureModel, setIsAzureModel] = useState(false)
  const [temperatureValue, setTemperatureValue] = useState(FALLBACK_TEMPERATURE)

  /* 加载系统提示词和模块组合。依赖不含 t：加了会在切语言时重复请求 */
  useEffect(() => {
    if (visible) {
      getSystemPrompts()
      getModuleCombinations()
    }
  }, [visible, getSystemPrompts, getModuleCombinations])

  /**
   * 检查是否为 Azure 模型。
   * 三种判定方式任一命中即为 Azure：provider 字段、api_endpoint 占位值、
   * api_key 的三段式格式。这些都是技术标识，不参与国际化。
   */
  const checkIsAzureModel = (modelName) => {
    const model = aiModels.find(m => m.name === modelName)
    if (!model) return false

    if (model.provider === 'azure' || model.provider === 'azure-openai') {
      return true
    }
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') {
      return true
    }
    if (model.api_key && model.api_key.includes('|')) {
      const parts = model.api_key.split('|')
      if (parts.length === 3) {
        return true
      }
    }
    return false
  }

  /* 处理模型选择变化 */
  const handleModelChange = (modelName) => {
    const isAzure = checkIsAzureModel(modelName)
    setIsAzureModel(isAzure)

    if (isAzure) {
      /* Azure 模型强制固定温度 */
      setTemperatureValue(AZURE_FIXED_TEMPERATURE)
      form.setFieldValue('ai_temperature', AZURE_FIXED_TEMPERATURE)
    } else {
      /* 非 Azure 模型恢复系统配置的默认温度 */
      const defaultTemp = getDefaultTemperature()
      setTemperatureValue(defaultTemp)
      form.setFieldValue('ai_temperature', defaultTemp)
    }
  }

  /**
   * 弹窗打开时设置默认值。
   * 依赖数组绝不可含 t：本 effect 内有 setFieldsValue，
   * 若因语言切换重跑，会覆盖用户尚未提交的输入（真实数据丢失）。
   */
  useEffect(() => {
    if (visible && aiModels.length > 0) {
      const defaultModel = getDefaultAIModel()
      const defaultTemp = getDefaultTemperature()

      /* 不判断 m.is_active：aiModels 已是后端返回的激活模型 */
      const defaultModelAvailable = aiModels.find(m => m.name === defaultModel)
      const modelToUse = defaultModelAvailable ? defaultModel : aiModels[0]?.name

      const isAzure = checkIsAzureModel(modelToUse)
      setIsAzureModel(isAzure)

      const tempToUse = isAzure ? AZURE_FIXED_TEMPERATURE : defaultTemp
      setTemperatureValue(tempToUse)

      form.setFieldsValue({
        model_name: modelToUse,
        context_length: DEFAULT_CONTEXT_LENGTH,
        ai_temperature: tempToUse,
        priority: DEFAULT_PRIORITY,
        system_prompt_id: null,
        system_prompt: '',
        module_combination_id: null
      })

      setCustomPromptMode(false)
      setSelectedPromptContent('')
      setSelectedCombination(null)
    }
  }, [visible, aiModels, form, getDefaultAIModel, getDefaultTemperature])

  /* 处理系统提示词选择 */
  const handleSystemPromptChange = (promptId) => {
    if (promptId === CUSTOM_PROMPT_VALUE) {
      /* 切换到自定义模式 */
      setCustomPromptMode(true)
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: selectedPromptContent || ''
      })
    } else if (promptId) {
      /* 选择了预设提示词 */
      setCustomPromptMode(false)
      const selectedPrompt = systemPrompts.find(p => p.id === promptId)
      if (selectedPrompt) {
        setSelectedPromptContent(selectedPrompt.description || '')
        form.setFieldsValue({
          system_prompt_id: promptId,
          system_prompt: ''
        })
      }
    } else {
      /* 清空选择 */
      setCustomPromptMode(false)
      setSelectedPromptContent('')
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: ''
      })
    }
  }

  /* 处理模块组合选择：选中含模块的组合时清空系统提示词（二者互斥） */
  const handleCombinationChange = (combinationId) => {
    if (combinationId) {
      const combination = moduleCombinations.find(c => c.id === combinationId)
      setSelectedCombination(combination)

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

  /* 处理表单提交 */
  const handleSubmit = (values) => {
    if (customPromptMode) {
      values.system_prompt_id = null
    } else if (values.system_prompt_id) {
      /* 选了预设提示词则清空自定义内容 */
      values.system_prompt = null
    }

    if (isAzureModel) {
      values.ai_temperature = AZURE_FIXED_TEMPERATURE
    }

    onSubmit(values)
  }

  return (
    <Modal
      title={t('chat.newConversation')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={MODAL_WIDTH}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="title"
          label={t('chat.form.title')}
        >
          <Input placeholder={t('chat.form.title.placeholder')} />
        </Form.Item>

        <Form.Item
          name="model_name"
          label={t('chat.form.model')}
          rules={[{ required: true, message: t('chat.form.model.required') }]}
        >
          <Select onChange={handleModelChange}>
            {/* 不做 filter(m => m.is_active)：后端已只返回激活模型 */}
            {aiModels.map(model => (
              <Option key={model.name} value={model.name}>
                <Space>
                  {/* 模型显示名为后台录入的业务数据，不翻译 */}
                  {model.display_name}
                  <Tag color="blue">
                    {model.credits_per_chat}{t('unit.credits')}
                  </Tag>
                  {model.stream_enabled && (
                    <Tag color="processing">
                      {t('chat.stream')}
                    </Tag>
                  )}
                  {model.image_upload_enabled && (
                    <Tag color="success">
                      {t('chat.image')}
                    </Tag>
                  )}
                  {/* Azure 为产品名，不翻译 */}
                  {(model.provider === 'azure' || model.api_endpoint === 'azure') && (
                    <Tag color="orange">
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
                {t('chat.combination.label')}
                <Tooltip title={t('chat.combination.tooltip')}>
                  <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                </Tooltip>
              </Space>
            }
          >
            <Select
              placeholder={t('chat.combination.placeholder')}
              allowClear
              onChange={handleCombinationChange}
              style={{ width: '100%' }}
              optionLabelProp="label"
              popupMatchSelectWidth={false}
              dropdownStyle={{ minWidth: DROPDOWN_MIN_WIDTH }}
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
                        {/* 组合名为用户创建的业务数据，不翻译 */}
                        {combination.name}
                        <Tag color="blue">
                          {t('chat.combination.moduleCount', {
                            count: combination.module_count || 0
                          })}
                        </Tag>
                        {combination.estimated_tokens > 0 && (
                          <Tag color="orange">
                            {t('chat.combination.tokenEstimate', {
                              tokens: combination.estimated_tokens
                            })}
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
            message={t('chat.combination.selected')}
            description={
              <div>
                {/* 组合描述为业务数据，不翻译 */}
                <div>{selectedCombination.description}</div>
                {/* 原为跨两行 JSX 拼接，改整句插值：英文语序与中文不同 */}
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  {t('chat.combination.selectedDesc', {
                    modules: selectedCombination.module_count || 0,
                    tokens: selectedCombination.estimated_tokens || 0
                  })}
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
                {t('chat.systemPrompt.label')}
              </Space>
            }
          >
            <Select
              placeholder={t('chat.systemPrompt.selectPlaceholder')}
              allowClear
              value={
                customPromptMode
                  ? CUSTOM_PROMPT_VALUE
                  : form.getFieldValue('system_prompt_id')
              }
              onChange={handleSystemPromptChange}
              style={{ width: '100%' }}
              optionLabelProp="label"
              popupMatchSelectWidth={false}
              dropdownStyle={{ minWidth: DROPDOWN_MIN_WIDTH }}
              dropdownRender={menu => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ padding: '0 8px 4px' }}>
                    <Button
                      type="text"
                      icon={<FileTextOutlined />}
                      block
                      onClick={() => handleSystemPromptChange(CUSTOM_PROMPT_VALUE)}
                    >
                      {t('chat.systemPrompt.custom')}
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
                    {/* 提示词名称与描述为后台录入的业务数据，不翻译 */}
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

        {/* 显示选中的提示词描述（业务数据，不翻译） */}
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
              rows={PROMPT_TEXTAREA_ROWS}
              placeholder={t('chat.form.systemPrompt.placeholder')}
            />
          </Form.Item>
        )}

        {/* 隐藏字段：保留以兼容后端字段结构 */}
        <Form.Item name="system_prompt_id" hidden>
          <Input />
        </Form.Item>

        <Form.Item
          name="context_length"
          label={t('chat.form.contextLength')}
        >
          <InputNumber
            min={CONTEXT_MIN}
            max={CONTEXT_MAX}
            style={{ width: '100%' }}
          />
        </Form.Item>

        {/* Azure 模型温度提示 */}
        {isAzureModel && (
          <Alert
            message={t('chat.azure.tempLimitTitle')}
            description={t('chat.azure.tempLimitDesc', {
              value: AZURE_FIXED_TEMPERATURE
            })}
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
              <Tooltip
                title={
                  isAzureModel
                    ? t('chat.azure.tempLimitTooltip', {
                      value: AZURE_FIXED_TEMPERATURE
                    })
                    : t('chat.form.temperature.tooltipShort', {
                      min: TEMPERATURE_MIN,
                      max: TEMPERATURE_MAX
                    })
                }
              >
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            </Space>
          }
        >
          <Slider
            min={TEMPERATURE_MIN}
            max={TEMPERATURE_MAX}
            step={TEMPERATURE_STEP}
            value={temperatureValue}
            onChange={(value) => {
              if (!isAzureModel) {
                setTemperatureValue(value)
                form.setFieldValue('ai_temperature', value)
              }
            }}
            disabled={isAzureModel}
            marks={{
              [TEMPERATURE_MIN]: t('chat.form.temperature.precise'),
              [TEMPERATURE_MID]: t('chat.form.temperature.balanced'),
              [TEMPERATURE_MAX]: t('chat.form.temperature.creative')
            }}
          />
        </Form.Item>

        <Form.Item
          name="priority"
          label={t('chat.form.priority')}
        >
          <InputNumber
            min={PRIORITY_MIN}
            max={PRIORITY_MAX}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              {t('button.create')}
            </Button>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ConversationFormModal
