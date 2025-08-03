/**
 * 对话设置抽屉组件 - 支持系统提示词选择
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
  Divider
} from 'antd'
import {
  InfoCircleOutlined,
  FileTextOutlined
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
  const { systemPrompts, getSystemPrompts } = useChatStore()
  const [customPromptMode, setCustomPromptMode] = useState(false)
  const [selectedPromptContent, setSelectedPromptContent] = useState('')

  // 加载系统提示词
  useEffect(() => {
    if (visible) {
      getSystemPrompts()
    }
  }, [visible, getSystemPrompts])

  // 初始化表单状态
  useEffect(() => {
    if (visible) {
      const systemPromptId = form.getFieldValue('system_prompt_id')
      const systemPrompt = form.getFieldValue('system_prompt')
      
      // 如果有自定义的系统提示词但没有system_prompt_id，设置为自定义模式
      if (systemPrompt && !systemPromptId) {
        setCustomPromptMode(true)
        setSelectedPromptContent('')
      } else if (systemPromptId) {
        // 如果有system_prompt_id，显示对应的描述
        setCustomPromptMode(false)
        const selectedPrompt = systemPrompts.find(p => p.id === systemPromptId)
        if (selectedPrompt) {
          setSelectedPromptContent(selectedPrompt.description || '')
        }
      } else {
        // 都没有的情况
        setCustomPromptMode(false)
        setSelectedPromptContent('')
      }
    }
  }, [visible, form, systemPrompts])

  // 处理系统提示词选择
  const handleSystemPromptChange = (promptId) => {
    if (promptId === 'custom') {
      // 切换到自定义模式
      setCustomPromptMode(true)
      form.setFieldsValue({
        system_prompt_id: null,
        system_prompt: form.getFieldValue('system_prompt') || ''
      })
    } else if (promptId) {
      // 选择了预设提示词
      setCustomPromptMode(false)
      const selectedPrompt = systemPrompts.find(p => p.id === promptId)
      if (selectedPrompt) {
        setSelectedPromptContent(selectedPrompt.description || '')
        form.setFieldsValue({
          system_prompt_id: promptId,
          system_prompt: '' // 清空自定义内容
        })
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

  // 处理表单提交
  const handleSubmit = (values) => {
    // 如果是自定义模式，清空system_prompt_id
    if (customPromptMode) {
      values.system_prompt_id = null
    } else if (values.system_prompt_id) {
      // 如果选择了预设提示词，清空自定义内容
      values.system_prompt = null
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
          <Select>
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
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 系统提示词选择 */}
        {systemPrompts.length > 0 && (
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
        {selectedPromptContent && !customPromptMode && (
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
        {(customPromptMode || systemPrompts.length === 0) && (
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

        {/* 隐藏的system_prompt_id字段 */}
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

        <Form.Item
          name="ai_temperature"
          label={
            <Space>
              {t('chat.form.temperature')}
              <Tooltip title={t('chat.form.temperature.tooltip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <Slider
            min={0}
            max={1}
            step={0.1}
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
