/**
 * 新建对话弹窗组件
 */

import React from 'react'
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
  Tooltip
} from 'antd'
import {
  InfoCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Option } = Select

const ConversationFormModal = ({
  visible,
  form,
  aiModels = [],
  onCancel,
  onSubmit
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('chat.newConversation')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={{
          model_name: aiModels.find(m => m.is_active)?.name,
          context_length: 20,
          ai_temperature: 0.7,
          priority: 0
        }}
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
            rows={3} 
            placeholder={t('chat.form.systemPrompt.placeholder')} 
          />
        </Form.Item>

        <Form.Item
          name="context_length"
          label={t('chat.form.contextLength')}
        >
          <InputNumber 
            min={0} 
            max={100} 
            style={{ width: '100%' }} 
          />
        </Form.Item>

        <Form.Item
          name="ai_temperature"
          label={t('chat.form.temperature')}
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
          label={t('chat.form.priority')}
        >
          <InputNumber 
            min={0} 
            max={10} 
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
