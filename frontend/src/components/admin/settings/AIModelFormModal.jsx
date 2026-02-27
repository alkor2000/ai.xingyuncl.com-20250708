/**
 * AI模型表单弹窗组件 - v1.4 保存并测试
 * 
 * v1.4 (2026-02-27):
 *   - 测试按钮改为"保存并测试"，先保存再测试确保用最新配置
 * v1.3 (2026-02-27):
 *   1. 模型标识(name)可编辑
 *   2. key/url脱敏显示头尾可见中间****
 *   3. 弹窗内置测试按钮
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
  FileTextOutlined,
  WalletOutlined,
  InfoCircleOutlined,
  ExperimentOutlined,
  GiftOutlined,
  ApiOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const AIModelFormModal = ({
  visible,
  editingModel,
  form,
  loading = false,
  onSubmit,
  onCancel,
  onSaveAndTest,      // v1.4 保存并测试回调
  testingModelId       // v1.4 正在测试的模型ID
}) => {
  const { t } = useTranslation()
  const [creditsValue, setCreditsValue] = React.useState(editingModel?.credits_per_chat || 10)

  // 当editingModel变化时同步积分值
  React.useEffect(() => {
    setCreditsValue(editingModel?.credits_per_chat ?? 10)
  }, [editingModel])

  /**
   * 处理表单提交，确保 model_config 包含测试温度
   */
  const handleFormSubmit = (values) => {
    const submitData = {
      ...values,
      model_config: {
        ...(values.model_config || {}),
        test_temperature: values.test_temperature || 1
      }
    }
    delete submitData.test_temperature
    onSubmit(submitData)
  }

  /**
   * v1.4 保存并测试 - 先验证表单，再调用保存并测试回调
   */
  const handleSaveAndTest = async () => {
    try {
      const values = await form.validateFields()
      const submitData = {
        ...values,
        model_config: {
          ...(values.model_config || {}),
          test_temperature: values.test_temperature || 1
        }
      }
      delete submitData.test_temperature
      onSaveAndTest(submitData)
    } catch (err) {
      // 表单验证失败，不处理
    }
  }

  // 监听积分值变化
  const handleCreditsChange = (value) => {
    setCreditsValue(value)
  }

  /**
   * v1.3 渲染当前配置脱敏值提示
   */
  const renderMaskedHint = (maskedValue, label) => {
    if (!editingModel || !maskedValue) return null
    return (
      <span style={{ fontSize: 12, color: '#8c8c8c' }}>
        {label}：<code style={{ 
          background: '#f5f5f5', 
          padding: '1px 6px', 
          borderRadius: 3,
          fontFamily: 'monospace',
          color: '#595959'
        }}>{maskedValue}</code>
        <span style={{ marginLeft: 8, color: '#bfbfbf' }}>（留空保持不变）</span>
      </span>
    )
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
          test_temperature: editingModel?.model_config?.test_temperature || 1,
          credits_per_chat: editingModel?.credits_per_chat || 10
        }}
      >
        {/* 编辑模式提示 */}
        {editingModel && (
          <Alert
            message="编辑模式：API密钥和端点留空则保持当前配置不变"
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 模型标识 + 显示名称 */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label={t('admin.models.form.name')}
              rules={[{ required: true, message: t('admin.models.form.name.required') }]}
            >
              <Input placeholder={t('admin.models.form.name.placeholder')} />
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

        {/* API密钥 + API端点 */}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="api_key"
              label={t('admin.models.form.apiKey')}
              rules={[{ required: !editingModel, message: t('admin.models.form.apiKey.required') }]}
              extra={renderMaskedHint(editingModel?.api_key, '当前密钥')}
            >
              <Input.Password 
                placeholder={editingModel ? '留空保持当前密钥不变' : t('admin.models.form.apiKey.placeholder.new')}
                autoComplete="new-password"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="api_endpoint"
              label={t('admin.models.form.apiEndpoint')}
              rules={[{ required: !editingModel, message: t('admin.models.form.apiEndpoint.required') }]}
              extra={renderMaskedHint(editingModel?.api_endpoint, '当前端点')}
            >
              <Input 
                placeholder={editingModel ? '留空保持当前端点不变' : t('admin.models.form.apiEndpoint.placeholder.new')}
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
                  <span>{t('admin.models.form.testConfig')}</span>
                  <Tag color="red">{t('admin.models.form.testParams')}</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="test_temperature"
                    label={t('admin.models.form.testTemperature')}
                    rules={[{ required: true, message: t('admin.models.form.testTemperature.required') }]}
                    extra={t('admin.models.form.testTemperature.extra')}
                  >
                    <InputNumber
                      min={0}
                      max={2}
                      step={0.1}
                      precision={1}
                      style={{ width: '100%' }}
                      placeholder={t('admin.models.form.testTemperature.placeholder')}
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
                    <strong>{t('admin.models.form.testTemperature.tip')}</strong>
                    {t('admin.models.form.testTemperature.tipDesc')}
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
                  dangerouslySetInnerHTML={{ __html: t('admin.models.form.streamTip') }}
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
                  dangerouslySetInnerHTML={{ __html: t('admin.models.form.imageTip') }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 文档上传配置 */}
        <Row gutter={16}>
          <Col span={24}>
            <Card 
              title={
                <Space>
                  <FileTextOutlined style={{ color: '#fa8c16' }} />
                  <span>{t('admin.models.form.documentConfig')}</span>
                  <Tag color="orange">📄 {t('admin.models.documentUpload')}</Tag>
                </Space>
              } 
              size="small" 
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="document_upload_enabled"
                    label={t('admin.models.form.enableDocumentUpload')}
                    valuePropName="checked"
                    initialValue={false}
                  >
                    <Switch
                      checkedChildren={<FileTextOutlined />}
                      unCheckedChildren={<CloseCircleOutlined />}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: '#fff7e6',
                    borderRadius: '4px',
                    borderLeft: '3px solid #fa8c16',
                    fontSize: '12px',
                    color: '#fa8c16'
                  }}
                  dangerouslySetInnerHTML={{ __html: t('admin.models.form.documentTip') }}
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
                  {creditsValue === 0 ? (
                    <Tag color="success" icon={<GiftOutlined />}>🎁 免费模型</Tag>
                  ) : (
                    <Tag color="green">🚀 {t('admin.models.noOutputLimit')}</Tag>
                  )}
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
                      min={0}
                      max={1000}
                      addonAfter={creditsValue === 0 ? '免费' : t('admin.models.perChat')}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                      onChange={handleCreditsChange}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <div style={{ 
                    marginTop: 30, 
                    padding: '8px 12px',
                    backgroundColor: creditsValue === 0 ? '#f6ffed' : '#f0f9ff',
                    borderRadius: '4px',
                    borderLeft: `3px solid ${creditsValue === 0 ? '#52c41a' : '#1677ff'}`,
                    fontSize: '12px',
                    color: creditsValue === 0 ? '#52c41a' : '#1677ff'
                  }}>
                    {creditsValue === 0 ? (
                      <>
                        <strong>✨ 免费模型提示：</strong><br />
                        设置为0积分表示此模型对用户完全免费，不会消耗任何积分。
                      </>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: t('admin.models.form.creditsTip') }} />
                    )}
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 状态 + 排序 */}
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
              extra="提示：可在列表中拖拽排序"
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {/* 底部操作按钮 - v1.4 "保存并测试"替代"测试连接" */}
        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            {/* v1.4 保存并测试：先保存最新配置，再自动测试连接 */}
            {editingModel && onSaveAndTest && (
              <Button 
                icon={<ApiOutlined />}
                loading={testingModelId === editingModel.id}
                onClick={handleSaveAndTest}
                style={{ color: '#fa8c16', borderColor: '#fa8c16' }}
              >
                保存并测试
              </Button>
            )}
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
