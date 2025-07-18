/**
 * 基础设置表单组件
 */

import React from 'react'
import {
  Form,
  Input,
  Switch,
  InputNumber,
  Select,
  Row,
  Col,
  Card,
  Space,
  Button,
  Tag
} from 'antd'
import {
  SaveOutlined,
  ThunderboltOutlined,
  FileImageOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

const BasicSettings = ({
  form,
  aiModels = [],
  loading = false,
  onSubmit
}) => {
  const { t } = useTranslation()

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onSubmit}
    >
      <Row gutter={24}>
        <Col xs={24} lg={12}>
          {/* 站点设置 */}
          <Card title={t('admin.settings.site.title')} size="small" style={{ marginBottom: 16 }}>
            <Form.Item name={['site', 'name']} label={t('admin.settings.site.name')}>
              <Input placeholder="AI Platform" />
            </Form.Item>
            
            <Form.Item name={['site', 'description']} label={t('admin.settings.site.description')}>
              <TextArea rows={3} placeholder={t('app.description')} />
            </Form.Item>
          </Card>

          {/* 用户设置 */}
          <Card title={t('admin.settings.user.title')} size="small">
            <Form.Item 
              name={['user', 'allow_register']} 
              label={t('admin.settings.user.allowRegister')} 
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            
            <Form.Item 
              name={['user', 'default_token_quota']} 
              label={t('admin.settings.user.defaultTokenQuota')}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value.replace(/\$\s?|(,*)/g, '')}
              />
            </Form.Item>

            <Form.Item 
              name={['user', 'default_credits_quota']} 
              label={t('admin.settings.user.defaultCreditsQuota')}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value.replace(/\$\s?|(,*)/g, '')}
              />
            </Form.Item>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          {/* AI设置 */}
          <Card title={t('admin.settings.ai.title')} size="small" style={{ marginBottom: 16 }}>
            <Form.Item 
              name={['ai', 'default_model']} 
              label={t('admin.settings.ai.defaultModel')}
            >
              <Select>
                {aiModels.filter(m => m.is_active).map(model => (
                  <Select.Option key={model.name} value={model.name}>
                    <Space>
                      <span>{model.display_name}</span>
                      <Tag color="blue" size="small">
                        {model.credits_per_chat}{t('unit.credits', { defaultValue: '积分' })}
                      </Tag>
                      {model.stream_enabled && (
                        <Tag color="processing" icon={<ThunderboltOutlined />} size="small">
                          {t('admin.models.stream')}
                        </Tag>
                      )}
                      {model.image_upload_enabled && (
                        <Tag color="success" icon={<FileImageOutlined />} size="small">
                          {t('admin.models.image')}
                        </Tag>
                      )}
                    </Space>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            
            <Form.Item 
              name={['ai', 'temperature']} 
              label={t('admin.settings.ai.temperature')} 
              initialValue={0.0}
            >
              <InputNumber style={{ width: '100%' }} min={0} max={2} step={0.1} />
            </Form.Item>
          </Card>

          {/* 积分设置 */}
          <Card title={t('admin.settings.credits.title')} size="small">
            <Form.Item 
              name={['credits', 'default_credits']} 
              label={t('admin.settings.credits.default')}
            >
              <InputNumber 
                style={{ width: '100%' }} 
                min={0} 
                max={100000}
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value.replace(/\$\s?|(,*)/g, '')}
              />
            </Form.Item>
            
            <Form.Item 
              name={['credits', 'min_credits_for_chat']} 
              label={t('admin.settings.credits.minForChat')}
            >
              <InputNumber style={{ width: '100%' }} min={1} max={100} />
            </Form.Item>
          </Card>
        </Col>
      </Row>

      <Form.Item style={{ textAlign: 'center', marginTop: 24 }}>
        <Space>
          <Button 
            type="primary" 
            icon={<SaveOutlined />} 
            htmlType="submit" 
            loading={loading}
          >
            {t('button.save')}
          </Button>
          <Button onClick={() => form.resetFields()}>
            {t('button.reset')}
          </Button>
        </Space>
      </Form.Item>
    </Form>
  )
}

export default BasicSettings
