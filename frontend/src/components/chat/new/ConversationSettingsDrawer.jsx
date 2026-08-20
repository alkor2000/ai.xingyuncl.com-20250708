/**
 * 对话设置抽屉组件
 *
 * 功能：编辑已有对话的标题、模型、模块组合、系统提示词、上下文长度、
 *       温度、优先级，以及 Claude 系列模型专属的"深度思考"开关。
 *
 * 历史修复（保留说明以免后人重蹈）：
 *   模型下拉曾有 aiModels.filter(m => m.is_active)，导致"暂无数据"全局故障。
 *   根因：后端 /chat/models（getModels）改为白名单显式返回字段以堵 api_key 泄露，
 *   白名单中不含 is_active，前端 m.is_active 全为 undefined，过滤后为空。
 *   安全性确认：后端 AIModel.getUserAvailableModels 的 SQL 已含
 *   WHERE m.is_active = true，被禁用的模型根本不会返回给前端，
 *   前端这层过滤是冗余的，去掉不影响管理员禁用模型的功能。
 *
 * ============================================================
 * 国际化关键决策
 * ============================================================
 *
 * 【1】剥离 4 处 || 中文兜底
 *   chat.thinking.enableLabel / enableTooltip / enabledWarning /
 *   enabledWarningDesc 四个键在中英两侧均真实存在（属"假兜底"），
 *   兜底从未生效。剥离后若键缺失会立即暴露，而非在英文环境静默显示中文。
 *   注意兜底文案与语言包实际值曾不一致：兜底写"...再输出答案"，
 *   语言包写"...再输出答案，回答质量更高但消耗更多Token和时间"，
 *   剥离后统一以语言包为准（语言包版本信息更完整）。
 *
 * 【2】跨行 JSX 拼接改整句插值
 *   原代码：
 *     包含 {selectedCombination.module_count} 个知识模块，
 *     预计消耗 {selectedCombination.estimated_tokens} tokens
 *   这是分两行书写的拼接。英文须为
 *   "Includes N knowledge modules, consuming about M tokens" ——
 *   中文"预计消耗"是独立动词短语，英文用现在分词接续，语序不同，
 *   无法通过同样的分行拼接得到。故改为 selectedDesc 整句插值。
 *
 * 【3】Switch 的开关文案不复用 common.enabled
 *   common.enabled/"已启用" 是**状态描述**，
 *   而 Switch 的 checkedChildren 需要的是**开关动作态**（开启/关闭）。
 *   语义不同，故新建 chat.switch.on / chat.switch.off。
 *
 * 【4】Azure 温度限制值抽为常量并作插值
 *   原文案硬编码"仅支持温度值 1.0"，与代码中三处 setFieldValue(1) 脱钩。
 *   现抽 AZURE_FIXED_TEMPERATURE 常量，同时用于赋值与 {{value}} 插值，
 *   保证提示语与实际行为永不脱节。
 *
 * 【5】两个 useEffect 依赖数组均不含 t
 *   它们负责"加载模块组合"与"初始化表单状态（含 setFieldValue）"，
 *   属重跑会破坏用户状态的类型：加 t 会在切语言时重新请求组合列表、
 *   并用 setFieldValue 覆盖用户尚未提交的修改（真实数据丢失风险）。
 *   本文件所有 t() 调用都在渲染期，不在 callback 内，故无需 tRef 模式。
 *
 * 【6】不翻译的内容
 *   combination.name / combination.description（用户创建的组合，业务数据）
 *   model.display_name（后台录入）、Azure（产品名）、tokens（技术术语）
 *   provider / api_endpoint 的判定字符串（技术标识）
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

// ==================== 业务规则常量 ====================

/**
 * Azure 模型强制使用的温度值。
 * 同时用于三处 setFieldValue 与 {{value}} 插值，
 * 避免"改了代码忘改提示文案"的脱钩问题。
 */
const AZURE_FIXED_TEMPERATURE = 1

/** 温度区间与步进（与后端 conversations.temperature 校验一致） */
const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 1
const TEMPERATURE_STEP = 0.1
/** 温度滑块中间刻度位置 */
const TEMPERATURE_MID = 0.5
/** 未设置温度时的默认值 */
const DEFAULT_TEMPERATURE = 0.7

/** 上下文条数区间 */
const CONTEXT_MIN = 0
const CONTEXT_MAX = 100

/** 优先级区间（数值越大排序越靠前） */
const PRIORITY_MIN = 0
const PRIORITY_MAX = 10

/** 自定义系统提示词输入框行数 */
const PROMPT_TEXTAREA_ROWS = 4

// ==================== 布局常量 ====================
const DRAWER_WIDTH = 500
/** 模块组合下拉的最小展开宽度（组合名与描述较长，需比输入框更宽） */
const COMBINATION_DROPDOWN_MIN_WIDTH = 400

/**
 * 检测模型名称是否为 Claude 系列。
 * 仅 Claude 推理模型支持深度思考能力。
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
  const [temperatureValue, setTemperatureValue] = useState(DEFAULT_TEMPERATURE)
  const [showThinkingSwitch, setShowThinkingSwitch] = useState(false)

  /* 加载模块组合。依赖不含 t：加了会在切语言时重复请求列表 */
  useEffect(() => {
    if (visible) {
      getModuleCombinations()
    }
  }, [visible, getModuleCombinations])

  /**
   * 检查是否为 Azure 模型。
   * 三种判定方式，任一命中即为 Azure：
   *   provider 字段、api_endpoint 占位值、api_key 的三段式格式
   * 这些都是技术标识，不参与国际化。
   */
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
      setTemperatureValue(AZURE_FIXED_TEMPERATURE)
      form.setFieldValue('ai_temperature', AZURE_FIXED_TEMPERATURE)
    } else {
      const currentTemp = form.getFieldValue('ai_temperature') || DEFAULT_TEMPERATURE
      setTemperatureValue(currentTemp)
    }

    const isClaude = isClaudeModel(modelName)
    setShowThinkingSwitch(isClaude)
    if (!isClaude) {
      form.setFieldValue('enable_thinking', false)
    }
  }

  /**
   * 初始化表单状态。
   * 依赖数组绝不可含 t：本 effect 内有多处 setFieldValue，
   * 若因语言切换重跑，会覆盖用户尚未提交的修改（真实数据丢失）。
   */
  useEffect(() => {
    if (visible) {
      const moduleCombinationId = form.getFieldValue('module_combination_id')
      const modelName = form.getFieldValue('model_name')
      const currentTemp = form.getFieldValue('ai_temperature') || DEFAULT_TEMPERATURE

      const isAzure = checkIsAzureModel(modelName)
      setIsAzureModel(isAzure)

      if (isAzure) {
        setTemperatureValue(AZURE_FIXED_TEMPERATURE)
        form.setFieldValue('ai_temperature', AZURE_FIXED_TEMPERATURE)
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

  /* 处理模块组合选择：选中组合时清空系统提示词（二者互斥） */
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
    /* 预设系统提示词功能已下线，仅保留自定义 system_prompt */
    values.system_prompt_id = null

    if (isAzureModel) {
      values.ai_temperature = AZURE_FIXED_TEMPERATURE
    }

    /* 后端 enable_thinking 为 TINYINT，需把布尔转 0/1 */
    if (values.enable_thinking !== undefined) {
      values.enable_thinking = values.enable_thinking ? 1 : 0
    }

    onSubmit(values)
  }

  return (
    <Drawer
      title={t('chat.conversation.settings')}
      placement="right"
      width={DRAWER_WIDTH}
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
            {/* 不做 filter(m => m.is_active)：后端已只返回激活模型 */}
            {aiModels.map(model => (
              <Option key={model.name} value={model.name}>
                <Space>
                  {/* 模型显示名为后台录入的业务数据，不翻译 */}
                  {model.display_name}
                  <Tag color="blue">{model.credits_per_chat}{t('unit.credits')}</Tag>
                  {model.stream_enabled && <Tag color="processing">{t('chat.stream')}</Tag>}
                  {model.image_upload_enabled && <Tag color="success">{t('chat.image')}</Tag>}
                  {/* Azure 为产品名，不翻译 */}
                  {(model.provider === 'azure' || model.api_endpoint === 'azure') && (
                    <Tag color="orange">Azure</Tag>
                  )}
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
                {t('chat.thinking.enableLabel')}
                <Tooltip title={t('chat.thinking.enableTooltip')}>
                  <InfoCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                </Tooltip>
              </Space>
            }
            valuePropName="checked"
          >
            {/* 开关态用 chat.switch.on/off，不复用 common.enabled（那是状态描述） */}
            <Switch
              checkedChildren={t('chat.switch.on')}
              unCheckedChildren={t('chat.switch.off')}
            />
          </Form.Item>
        )}

        {showThinkingSwitch && form.getFieldValue('enable_thinking') && (
          <Alert
            message={t('chat.thinking.enabledWarning')}
            description={t('chat.thinking.enabledWarningDesc')}
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
              dropdownStyle={{ minWidth: COMBINATION_DROPDOWN_MIN_WIDTH }}
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

        {/* 自定义系统提示词（预设选择功能已下线，此处始终显示） */}
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
            <TextArea
              rows={PROMPT_TEXTAREA_ROWS}
              placeholder={t('chat.form.systemPrompt.placeholder')}
            />
          </Form.Item>
        )}

        {/* 隐藏字段：提交时统一置 null，保留以兼容后端字段结构 */}
        <Form.Item name="system_prompt_id" hidden><Input /></Form.Item>

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
          <InputNumber min={CONTEXT_MIN} max={CONTEXT_MAX} style={{ width: '100%' }} />
        </Form.Item>

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
                    ? t('chat.azure.tempLimitTooltip', { value: AZURE_FIXED_TEMPERATURE })
                    : t('chat.form.temperature.tooltip')
                }
              >
                <InfoCircleOutlined />
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
          label={
            <Space>
              {t('chat.form.priority')}
              <Tooltip title={t('chat.form.priority.tooltip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={PRIORITY_MIN} max={PRIORITY_MAX} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

export default ConversationSettingsDrawer
