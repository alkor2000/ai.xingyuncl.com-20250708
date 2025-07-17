/**
 * 对话设置抽屉组件
 */

import React from 'react'
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
  Tooltip
} from 'antd'
import {
  InfoCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

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
        onFinish={onSubmit}
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

        <Form.Item
          name="system_prompt"
          label={t('chat.form.systemPrompt')}
        >
          <TextArea 
            rows={4} 
            placeholder={t('chat.form.systemPrompt.placeholder')} 
          />
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
