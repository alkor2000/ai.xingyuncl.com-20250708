/**
 * 基础设置表单组件 - 支持只读模式和Logo上传
 */

import React, { useState } from 'react'
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
  Tag,
  Alert,
  Upload,
  message,
  Radio,
  Tooltip
} from 'antd'
import {
  SaveOutlined,
  ThunderboltOutlined,
  FileImageOutlined,
  LockOutlined,
  UploadOutlined,
  LoadingOutlined,
  PlusOutlined,
  FontSizeOutlined,
  LoginOutlined,
  MailOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useSystemConfigStore from '../../../stores/systemConfigStore'

const { TextArea } = Input

// 预定义的字体列表
const FONT_OPTIONS = [
  { label: '系统默认', value: 'system-ui' },
  { label: '苹方', value: '-apple-system, "PingFang SC"' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑"' },
  { label: '思源黑体', value: '"Source Han Sans CN", "思源黑体"' },
  { label: '阿里巴巴普惠体', value: '"Alibaba PuHuiTi", "阿里巴巴普惠体"' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: '宋体', value: 'SimSun, "宋体"' },
  { label: '黑体', value: 'SimHei, "黑体"' },
  { label: '楷体', value: 'KaiTi, "楷体"' },
]

// 预定义的字体大小选项
const FONT_SIZE_OPTIONS = [
  { label: '12px (较小)', value: 12 },
  { label: '13px (小)', value: 13 },
  { label: '14px (默认)', value: 14 },
  { label: '15px (舒适)', value: 15 },
  { label: '16px (大)', value: 16 },
  { label: '18px (较大)', value: 18 },
  { label: '20px (特大)', value: 20 },
]

const BasicSettings = ({
  form,
  aiModels = [],
  loading = false,
  onSubmit,
  disabled = false
}) => {
  const { t } = useTranslation()
  const { uploadSiteLogo, systemConfig } = useSystemConfigStore()
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoUrl, setLogoUrl] = useState(systemConfig?.site?.logo || '')

  // 处理Logo上传
  const handleLogoUpload = async (info) => {
    const { file } = info
    
    if (file.status === 'uploading') {
      setLogoUploading(true)
      return
    }
    
    if (file.status === 'done' || file.originFileObj) {
      try {
        setLogoUploading(true)
        const result = await uploadSiteLogo(file.originFileObj || file)
        
        if (result.success) {
          setLogoUrl(result.url)
          form.setFieldValue(['site', 'logo'], result.url)
          message.success('Logo上传成功')
        } else {
          message.error(result.error || 'Logo上传失败')
        }
      } catch (error) {
        message.error('Logo上传失败')
      } finally {
        setLogoUploading(false)
      }
    }
  }

  // 上传前检查
  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      message.error('只能上传图片文件！')
      return false
    }
    
    const isLt2M = file.size / 1024 / 1024 < 2
    if (!isLt2M) {
      message.error('图片大小不能超过2MB！')
      return false
    }
    
    return true
  }

  const uploadButton = (
    <div>
      {logoUploading ? <LoadingOutlined /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>上传Logo</div>
    </div>
  )

  return (
    <>
      {disabled && (
        <Alert
          message={t('admin.settings.readOnlyMode')}
          description={t('admin.settings.readOnlyDescription')}
          type="warning"
          showIcon
          icon={<LockOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}
      
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
                <Input placeholder="AI Platform" disabled={disabled} />
              </Form.Item>
              
              <Form.Item name={['site', 'logo']} label="站点Logo">
                <Upload
                  name="logo"
                  listType="picture-card"
                  className="site-logo-uploader"
                  showUploadList={false}
                  beforeUpload={beforeUpload}
                  onChange={handleLogoUpload}
                  disabled={disabled}
                  customRequest={({ file, onSuccess }) => {
                    // 使用自定义请求，避免默认行为
                    setTimeout(() => {
                      onSuccess("ok")
                    }, 0)
                  }}
                >
                  {logoUrl ? (
                    <img 
                      src={logoUrl} 
                      alt="logo" 
                      style={{ 
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain'
                      }} 
                    />
                  ) : (
                    uploadButton
                  )}
                </Upload>
                <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                  建议尺寸：200x50px，支持 JPG/PNG/GIF/SVG，最大2MB
                </div>
              </Form.Item>
              
              <Form.Item name={['site', 'description']} label={t('admin.settings.site.description')}>
                <TextArea rows={3} placeholder={t('app.description')} disabled={disabled} />
              </Form.Item>
            </Card>

            {/* 用户设置 */}
            <Card title={t('admin.settings.user.title')} size="small" style={{ marginBottom: 16 }}>
              <Form.Item 
                name={['user', 'allow_register']} 
                label={t('admin.settings.user.allowRegister')} 
                valuePropName="checked"
              >
                <Switch disabled={disabled} />
              </Form.Item>
              
              <Form.Item 
                name={['user', 'default_tokens']} 
                label="新用户默认Token"
                tooltip="新注册用户或管理员创建用户时的默认Token数量"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                  disabled={disabled}
                />
              </Form.Item>

              <Form.Item 
                name={['user', 'default_credits']} 
                label="新用户默认积分"
                tooltip="新注册用户或管理员创建用户时的默认积分数量"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={1}
                  precision={0}
                  formatter={value => value ? `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                  parser={value => value ? parseInt(value.replace(/\$\s?|(,*)/g, ''), 10) : 0}
                  disabled={disabled}
                />
              </Form.Item>
            </Card>

            {/* 登录方式设置 - 新增 */}
            <Card 
              title={
                <Space>
                  <LoginOutlined />
                  <span>登录方式设置</span>
                </Space>
              }
              size="small"
            >
              <Form.Item 
                name={['login', 'mode']} 
                label="登录模式"
                tooltip="选择系统允许的登录方式"
                initialValue="standard"
              >
                <Radio.Group disabled={disabled}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Radio value="standard">
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>标准模式</span>
                        <Tag color="blue">推荐</Tag>
                      </Space>
                      <div style={{ marginLeft: 24, marginTop: 4, color: '#666', fontSize: 12 }}>
                        <div>• 支持用户名/邮箱/手机号 + 密码登录</div>
                        <div>• 支持邮箱 + 验证码登录</div>
                        <div>• 灵活便捷，适合大多数场景</div>
                      </div>
                    </Radio>
                    
                    <Radio value="email_verify_required" style={{ marginTop: 16 }}>
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>强制邮箱验证模式</span>
                        <Tag color="orange">高安全</Tag>
                      </Space>
                      <div style={{ marginLeft: 24, marginTop: 4, color: '#666', fontSize: 12 }}>
                        <div>• 仅支持邮箱 + 密码 + 验证码登录</div>
                        <div>• 每次登录都需要邮箱验证码</div>
                        <div>• 安全性更高，适合敏感系统</div>
                      </div>
                    </Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              <Form.Item 
                name={['login', 'refresh_token_days']} 
                label={
                  <Space>
                    <span>登录有效期</span>
                    <Tooltip title="用户多少天后需要重新输入密码登录，对新登录的用户生效">
                      <InfoCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </Space>
                }
                initialValue={14}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={365}
                  step={1}
                  precision={0}
                  disabled={disabled}
                  formatter={value => `${value} 天`}
                  parser={value => value.replace(' 天', '')}
                  placeholder="输入天数（1-365）"
                />
              </Form.Item>

              <Alert
                message="登录设置说明"
                description={
                  <div>
                    <div>• 切换登录模式后立即生效，影响所有用户</div>
                    <div>• 强制邮箱验证模式下，用户必须同时提供密码和验证码</div>
                    <div>• 登录有效期只对新登录的用户生效，已登录用户不受影响</div>
                    <div>• 建议根据系统安全性要求合理设置登录有效期</div>
                  </div>
                }
                type="info"
                showIcon
                icon={<SafetyOutlined />}
                style={{ marginTop: 16 }}
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            {/* AI设置 */}
            <Card title={t('admin.settings.ai.title')} size="small" style={{ marginBottom: 16 }}>
              <Form.Item 
                name={['ai', 'default_model']} 
                label={t('admin.settings.ai.defaultModel')}
              >
                <Select disabled={disabled}>
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
                <InputNumber 
                  style={{ width: '100%' }} 
                  min={0} 
                  max={2} 
                  step={0.1} 
                  disabled={disabled}
                />
              </Form.Item>
            </Card>

            {/* 对话字体设置 */}
            <Card 
              title={
                <Space>
                  <FontSizeOutlined />
                  <span>对话字体设置</span>
                </Space>
              }
              size="small"
            >
              <Form.Item 
                name={['chat', 'font_family']} 
                label="字体类型"
                tooltip="设置对话界面的字体，对所有用户生效"
                initialValue="system-ui"
              >
                <Select 
                  disabled={disabled}
                  placeholder="选择字体"
                  showSearch
                  optionFilterProp="label"
                >
                  {FONT_OPTIONS.map(font => (
                    <Select.Option key={font.value} value={font.value} label={font.label}>
                      <span style={{ fontFamily: font.value }}>{font.label}</span>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item 
                name={['chat', 'font_size']} 
                label="字体大小"
                tooltip="设置对话内容的字体大小"
                initialValue={14}
              >
                <Select 
                  disabled={disabled}
                  placeholder="选择字体大小"
                >
                  {FONT_SIZE_OPTIONS.map(size => (
                    <Select.Option key={size.value} value={size.value}>
                      {size.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Alert
                message="字体设置说明"
                description="这里设置的字体将应用于所有用户的对话界面，包括用户消息和AI回复。某些字体可能需要用户系统已安装才能正常显示。"
                type="info"
                showIcon
                style={{ marginTop: 16 }}
              />
            </Card>
          </Col>
        </Row>

        {!disabled && (
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
        )}
      </Form>
    </>
  )
}

export default BasicSettings
