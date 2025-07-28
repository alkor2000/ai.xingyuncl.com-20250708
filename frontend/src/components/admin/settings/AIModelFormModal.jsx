/**
 * AI模型表单弹窗组件
 */

import React from 'react'
import {
  Modal,
  Form,
  Input,
  Switch,
  InputNumber,
  Row,
  Col,
  Space,
  Button,
  Card,
  Tag,
  Alert
} from 'antd'
import {
  ThunderboltOutlined,
  CloseCircleOutlined,
  PictureOutlined,
  FileImageOutlined,
  WalletOutlined,
  InfoCircleOutlined,
  ExperimentOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const AIModelFormModal = ({
  visible,
  editingModel,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()

  // 处理表单提交，确保 model_config 包含测试温度
  const handleFormSubmit = (values) => {
    const submitData = {
      ...values,
      model_config: {
        ...(values.model_config || {}),
        test_temperature: values.test_temperature || 1
      }
    }
    delete submitData.test_temperature // 从顶层移除，因为已经在 model_config 中
    onSubmit(submitData)
  }

  return (
    <Modal
      title={editingModel ? t('admin.models.editModel') : t('admin.models.createModel')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={700}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFormSubmit}
        initialValues={{
          test_temperature: editingModel?.model_config?.test_temperature || 1
        }}
      >
        {/* 编辑模式的提示信息 */}
        {editingModel && (
          <Alert
            message="编辑提示"
            description="API密钥和API端点字段留空表示不修改原有配置"
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label={t('admin.models.form.name')}
              rules={[{ required: true, message: t('admin.models.form.name.required') }]}
            >
              <Input 
                placeholder={t('admin.models.form.name.placeholder')} 
                disabled={!!editingModel} 
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="display_name"
              label={t('admin.models.form.displayName')}
              rules={[{ required: true, message: t('admin.models.form.displayName.required') }]}
            >
              <Input placeholder={t('admin.models.form.displayName.placeholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="api_key"
              label={
                <Space>
                  {t('admin.models.form.apiKey')}
                  {editingModel && (
                    <Tag color="blue" style={{ fontSize: '12px' }}>
                      留空保持不变
                    </Tag>
                  )}
                </Space>
              }
              rules={[{ required: !editingModel, message: t('admin.models.form.apiKey.required') }]}
              extra={editingModel ? "如需更新密钥，请输入新的API密钥" : null}
            >
              <Input.Password 
                placeholder={editingModel ? "留空表示不修改" : "sk-..."} 
                autoComplete="new-password"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="api_endpoint"
              label={
                <Space>
                  {t('admin.models.form.apiEndpoint')}
                  {editingModel && (
                    <Tag color="blue" style={{ fontSize: '12px' }}>
                      留空保持不变
                    </Tag>
                  )}
                </Space>
              }
              rules={[{ required: !editingModel, message: t('admin.models.form.apiEndpoint.required') }]}
              extra={editingModel ? "如需更新端点，请输入新的API端点" : null}
            >
              <Input 
                placeholder={editingModel ? "留空表示不修改" : "https://api.openai.com/v1"} 
              />
            </Form.Item>
          </Col>
        </Row>

        {/* 测试配置 */}
        <Row gutter={16}>
          <Col span={24}>
            <Card 
              title={
                <Space>
                  <ExperimentOutlined style={{ color: '#ff4d4f' }} />
                  <span>测试配置</span>
                  <Tag color="red">测试参数</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="test_temperature"
                    label="测试温度"
                    rules={[{ required: true, message: '请输入测试温度' }]}
                    extra="某些模型（如gpt-4o-mini）只支持特定温度值"
                  >
                    <InputNumber
                      min={0}
                      max={2}
                      step={0.1}
                      precision={1}
                      style={{ width: '100%' }}
                      placeholder="默认值: 1"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: '#fff2e8',
                    borderRadius: '4px',
                    borderLeft: '3px solid #ff4d4f',
                    fontSize: '12px',
                    color: '#d4380d'
                  }}>
                    <strong>提示：</strong>不同模型对温度参数有不同要求。
                    如gpt-4o-mini只支持1，其他模型可能支持0-2范围。
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 流式输出配置 */}
        <Row gutter={16}>
          <Col span={24}>
            <Card 
              title={
                <Space>
                  <ThunderboltOutlined style={{ color: '#1677ff' }} />
                  <span>{t('admin.models.form.streamConfig')}</span>
                  <Tag color="processing">🚀 {t('admin.models.streamOutput')}</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="stream_enabled"
                    label={t('admin.models.form.enableStream')}
                    valuePropName="checked"
                    initialValue={true}
                  >
                    <Switch
                      checkedChildren={<ThunderboltOutlined />}
                      unCheckedChildren={<CloseCircleOutlined />}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: '#f0f9ff',
                    borderRadius: '4px',
                    borderLeft: '3px solid #1677ff',
                    fontSize: '12px',
                    color: '#1677ff'
                  }}
                  dangerouslySetInnerHTML={{ 
                    __html: t('admin.models.form.streamTip')
                  }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 图片识别配置 */}
        <Row gutter={16}>
          <Col span={24}>
            <Card 
              title={
                <Space>
                  <FileImageOutlined style={{ color: '#52c41a' }} />
                  <span>{t('admin.models.form.imageConfig')}</span>
                  <Tag color="success">🖼️ {t('admin.models.imageUpload')}</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="image_upload_enabled"
                    label={t('admin.models.form.enableImageUpload')}
                    valuePropName="checked"
                    initialValue={false}
                  >
                    <Switch
                      checkedChildren={<PictureOutlined />}
                      unCheckedChildren={<CloseCircleOutlined />}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: '#f0fff7',
                    borderRadius: '4px',
                    borderLeft: '3px solid #52c41a',
                    fontSize: '12px',
                    color: '#52c41a'
                  }}
                  dangerouslySetInnerHTML={{ 
                    __html: t('admin.models.form.imageTip')
                  }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 积分配置 */}
        <Row gutter={16}>
          <Col span={24}>
            <Card 
              title={
                <Space>
                  <WalletOutlined style={{ color: '#1677ff' }} />
                  <span>{t('admin.models.form.creditsConfig')}</span>
                  <Tag color="green">🚀 {t('admin.models.noOutputLimit')}</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="credits_per_chat"
                    label={t('admin.models.form.creditsPerChat')}
                    rules={[{ required: true, message: t('admin.models.form.creditsPerChat.required') }]}
                    initialValue={10}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      max={1000}
                      addonAfter={t('admin.models.perChat')}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: '#f0f9ff',
                    borderRadius: '4px',
                    borderLeft: '3px solid #1677ff',
                    fontSize: '12px',
                    color: '#1677ff'
                  }}
                  dangerouslySetInnerHTML={{ 
                    __html: t('admin.models.form.creditsTip')
                  }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item 
              name="is_active" 
              label={t('admin.models.form.status')} 
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item 
              name="sort_order" 
              label={t('admin.models.form.sort')}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingModel ? t('button.update') : t('button.create')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default AIModelFormModal
