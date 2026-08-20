/**
 * 基础设置表单组件 - 只读模式、Logo上传、强制邀请码开关、默认语言设置
 *
 * v1.3.0 (i18n): 70 处硬编码接入 i18n。三个常量数组差异化处理，理由见各自定义处。
 *   另修两处隐患：
 *   1) 清除 t('unit.credits', { defaultValue: '积分' }) —— 兜底藏在 options
 *      的 defaultValue 里，常规"第二参数是否为中文"的检测扫不到它。
 *   2) 登录有效期 InputNumber 的 formatter/parser 必须严格互逆。原 parser 硬编码
 *      replace(' 天')，一旦 formatter 走 i18n，英文环境就减不掉 "day(s)"，
 *      整串被当数值。现 parser 改为"仅保留数字"，与任何语言的单位写法兼容。
 *
 * v1.2.0 (2025-01-07): 新增系统默认语言设置
 * v1.1.0: 新增强制邀请码开关
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
  InfoCircleOutlined,
  TeamOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useSystemConfigStore from '../../../stores/systemConfigStore'

const { TextArea } = Input

/** Logo 上传大小上限（MB），同一值用于校验与提示文案插值，避免两处不一致 */
const LOGO_MAX_SIZE_MB = 2
const BYTES_PER_MB = 1024 * 1024

/** 登录有效期天数范围，同时用于 InputNumber 约束与 placeholder 插值 */
const LOGIN_EXPIRE_DAYS_MIN = 1
const LOGIN_EXPIRE_DAYS_MAX = 365
const LOGIN_EXPIRE_DAYS_DEFAULT = 14

/** AI 温度参数范围 */
const AI_TEMPERATURE_MIN = 0
const AI_TEMPERATURE_MAX = 2
const AI_TEMPERATURE_STEP = 0.1

/** 默认字号，与 FONT_SIZE_OPTIONS 中标记为 default 的档位保持一致 */
const DEFAULT_FONT_SIZE = 14

/** 千分位分隔正则（用于 InputNumber 的 formatter/parser） */
const THOUSANDS_SEPARATOR = /\B(?=(\d{3})+(?!\d))/g
const THOUSANDS_STRIP = /\$\s?|(,*)/g

/**
 * 字体列表
 *
 * label 为【字体资源名】，故意保留中文不国际化：它与 value 中的
 * "PingFang SC"/"Microsoft YaHei" 是同一字体的中英写法，且 Option 会用
 * fontFamily 实时预览，名称须与用户系统的字体列表可对应。
 * 唯一例外"系统默认"是描述性文案，用 labelKey 标记走 i18n。
 */
const FONT_OPTIONS = [
  { labelKey: 'admin.settings.chat.font.systemDefault', value: 'system-ui' },
  { label: '苹方', value: '-apple-system, "PingFang SC"' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑"' },
  { label: '思源黑体', value: '"Source Han Sans CN", "思源黑体"' },
  { label: '阿里巴巴普惠体', value: '"Alibaba PuHuiTi", "阿里巴巴普惠体"' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: '宋体', value: 'SimSun, "宋体"' },
  { label: '黑体', value: 'SimHei, "黑体"' },
  { label: '楷体', value: 'KaiTi, "楷体"' }
]

/**
 * 字号档位
 *
 * 只存技术值 value 与文案键 sizeKey，不存拼好的字符串。
 * 原值 '14px (默认)' 混合技术值与界面描述无法国际化；现由组件用
 * t(sizeKey, { size: value }) 生成整句（中"14px（默认）"/英"14px (Default)"），
 * 括号全角半角不同，故必须整句插值而非 JSX 拼接。
 */
const FONT_SIZE_OPTIONS = [
  { value: 12, sizeKey: 'admin.settings.chat.fontSize.smaller' },
  { value: 13, sizeKey: 'admin.settings.chat.fontSize.small' },
  { value: 14, sizeKey: 'admin.settings.chat.fontSize.default' },
  { value: 15, sizeKey: 'admin.settings.chat.fontSize.comfortable' },
  { value: 16, sizeKey: 'admin.settings.chat.fontSize.large' },
  { value: 18, sizeKey: 'admin.settings.chat.fontSize.larger' },
  { value: 20, sizeKey: 'admin.settings.chat.fontSize.largest' }
]

/**
 * 语言选项
 *
 * label 为【语言自称】，故意保留原文不国际化：语言选择器按国际通行做法
 * 须以目标语言自身的名字呈现，否则英文环境把"简体中文"显示为
 * "Simplified Chinese"，中文用户反而找不到自己的语言。国旗 Emoji 同理。
 */
const LANGUAGE_OPTIONS = [
  { label: '简体中文', value: 'zh-CN', flag: '🇨🇳' },
  { label: 'English', value: 'en-US', flag: '🇺🇸' }
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

  // 监听允许注册开关的变化
  const allowRegister = Form.useWatch(['user', 'allow_register'], form)

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
          message.success(t('admin.settings.site.logo.uploadSuccess'))
        } else {
          // result.error 来自后端（中文），优先展示；缺失时用本地文案兜底
          message.error(result.error || t('admin.settings.site.logo.uploadFailed'))
        }
      } catch (error) {
        message.error(t('admin.settings.site.logo.uploadFailed'))
      } finally {
        setLogoUploading(false)
      }
    }
  }

  // 上传前检查
  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      message.error(t('admin.settings.site.logo.onlyImage'))
      return false
    }

    const isWithinLimit = file.size / BYTES_PER_MB < LOGO_MAX_SIZE_MB
    if (!isWithinLimit) {
      message.error(t('admin.settings.site.logo.sizeLimit', { size: LOGO_MAX_SIZE_MB }))
      return false
    }

    return true
  }

  const uploadButton = (
    <div>
      {logoUploading ? <LoadingOutlined /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>{t('admin.settings.site.logo.upload')}</div>
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
                {/* "AI Platform" 为产品名示例，不翻译 */}
                <Input placeholder="AI Platform" disabled={disabled} />
              </Form.Item>

              <Form.Item name={['site', 'logo']} label={t('admin.settings.site.logo')}>
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
                  {t('admin.settings.site.logo.hint', { size: LOGO_MAX_SIZE_MB })}
                </div>
              </Form.Item>

              <Form.Item name={['site', 'description']} label={t('admin.settings.site.description')}>
                <TextArea rows={3} placeholder={t('app.description')} disabled={disabled} />
              </Form.Item>

              {/* 系统默认语言设置 */}
              <Form.Item
                name={['site', 'default_language']}
                label={
                  <Space>
                    <GlobalOutlined />
                    <span>{t('admin.settings.site.defaultLanguage')}</span>
                    <Tooltip title={t('admin.settings.site.defaultLanguage.tooltip')}>
                      <InfoCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </Space>
                }
                initialValue="zh-CN"
              >
                <Select
                  disabled={disabled}
                  placeholder={t('admin.settings.site.defaultLanguage.placeholder')}
                >
                  {LANGUAGE_OPTIONS.map(lang => (
                    <Select.Option key={lang.value} value={lang.value}>
                      <Space>
                        <span>{lang.flag}</span>
                        <span>{lang.label}</span>
                      </Space>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Alert
                message={t('admin.settings.site.languageHint.title')}
                description={t('admin.settings.site.languageHint.description')}
                type="info"
                showIcon
                icon={<GlobalOutlined />}
                style={{ marginTop: 8 }}
              />
            </Card>

            {/* 用户设置 - 增强注册控制 */}
            <Card
              title={
                <Space>
                  <span>{t('admin.settings.user.title')}</span>
                  <TeamOutlined />
                </Space>
              }
              size="small"
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name={['user', 'allow_register']}
                label={t('admin.settings.user.allowRegister')}
                valuePropName="checked"
              >
                <Switch disabled={disabled} />
              </Form.Item>

              {/* 强制邀请码开关 */}
              <Form.Item
                name={['user', 'require_invitation_code']}
                label={
                  <Space>
                    <span>{t('admin.settings.user.requireInvitationCode')}</span>
                    <Tooltip title={t('admin.settings.user.requireInvitationCode.tooltip')}>
                      <InfoCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </Space>
                }
                valuePropName="checked"
                dependencies={['user', 'allow_register']}
              >
                <Switch
                  disabled={disabled || !allowRegister}
                  checkedChildren={t('admin.settings.user.requireInvitationCode.on')}
                  unCheckedChildren={t('admin.settings.user.requireInvitationCode.off')}
                />
              </Form.Item>

              {/* 说明要点逐条独立成键（而非一整段长文本），便于各语言单独调整措辞；
                  • 为视觉符号不进语言包 */}
              {allowRegister && (
                <Alert
                  message={t('admin.settings.user.registerRule.title')}
                  description={
                    <div>
                      <div>• {t('admin.settings.user.registerRule.item1')}</div>
                      <div>• {t('admin.settings.user.registerRule.item2')}</div>
                      <div>• {t('admin.settings.user.registerRule.item3')}</div>
                      <div style={{ marginTop: 8, color: '#1890ff' }}>
                        <TeamOutlined /> {t('admin.settings.user.registerRule.item4')}
                      </div>
                    </div>
                  }
                  type="info"
                  showIcon
                  style={{ marginTop: 16, marginBottom: 16 }}
                />
              )}

              <Form.Item
                name={['user', 'default_tokens']}
                label={t('admin.settings.user.defaultTokens')}
                tooltip={t('admin.settings.user.defaultTokens.tooltip')}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  formatter={value => `${value}`.replace(THOUSANDS_SEPARATOR, ',')}
                  parser={value => value.replace(THOUSANDS_STRIP, '')}
                  disabled={disabled}
                />
              </Form.Item>

              <Form.Item
                name={['user', 'default_credits']}
                label={t('admin.settings.user.defaultCredits')}
                tooltip={t('admin.settings.user.defaultCredits.tooltip')}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={1}
                  precision={0}
                  formatter={value => value ? `${value}`.replace(THOUSANDS_SEPARATOR, ',') : ''}
                  parser={value => value ? parseInt(value.replace(THOUSANDS_STRIP, ''), 10) : 0}
                  disabled={disabled}
                />
              </Form.Item>
            </Card>

            {/* 登录方式设置 */}
            <Card
              title={
                <Space>
                  <LoginOutlined />
                  <span>{t('admin.settings.login.title')}</span>
                </Space>
              }
              size="small"
            >
              <Form.Item
                name={['login', 'mode']}
                label={t('admin.settings.login.mode')}
                tooltip={t('admin.settings.login.mode.tooltip')}
                initialValue="standard"
              >
                <Radio.Group disabled={disabled}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Radio value="standard">
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>{t('admin.settings.login.standard')}</span>
                        <Tag color="blue">{t('admin.settings.login.standard.tag')}</Tag>
                      </Space>
                      <div style={{ marginLeft: 24, marginTop: 4, color: '#666', fontSize: 12 }}>
                        <div>• {t('admin.settings.login.standard.item1')}</div>
                        <div>• {t('admin.settings.login.standard.item2')}</div>
                        <div>• {t('admin.settings.login.standard.item3')}</div>
                      </div>
                    </Radio>

                    <Radio value="email_verify_required" style={{ marginTop: 16 }}>
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>{t('admin.settings.login.emailVerify')}</span>
                        <Tag color="orange">{t('admin.settings.login.emailVerify.tag')}</Tag>
                      </Space>
                      <div style={{ marginLeft: 24, marginTop: 4, color: '#666', fontSize: 12 }}>
                        <div>• {t('admin.settings.login.emailVerify.item1')}</div>
                        <div>• {t('admin.settings.login.emailVerify.item2')}</div>
                        <div>• {t('admin.settings.login.emailVerify.item3')}</div>
                      </div>
                    </Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              <Form.Item
                name={['login', 'refresh_token_days']}
                label={
                  <Space>
                    <span>{t('admin.settings.login.expireDays')}</span>
                    <Tooltip title={t('admin.settings.login.expireDays.tooltip')}>
                      <InfoCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </Space>
                }
                initialValue={LOGIN_EXPIRE_DAYS_DEFAULT}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={LOGIN_EXPIRE_DAYS_MIN}
                  max={LOGIN_EXPIRE_DAYS_MAX}
                  step={1}
                  precision={0}
                  disabled={disabled}
                  /* formatter/parser 必须严格互逆：formatter 用整句插值输出带单位的
                     显示值，parser 则"仅保留数字"反推数值。不可硬编码 replace(' 天')，
                     否则英文环境减不掉 "day(s)"，整串被当数值。 */
                  formatter={value => (value === undefined || value === null || value === ''
                    ? ''
                    : t('admin.settings.login.expireDays.unit', { days: value }))}
                  parser={value => {
                    const digits = String(value).replace(/[^\d]/g, '')
                    return digits === '' ? '' : Number(digits)
                  }}
                  placeholder={t('admin.settings.login.expireDays.placeholder', {
                    min: LOGIN_EXPIRE_DAYS_MIN,
                    max: LOGIN_EXPIRE_DAYS_MAX
                  })}
                />
              </Form.Item>

              <Alert
                message={t('admin.settings.login.hint.title')}
                description={
                  <div>
                    <div>• {t('admin.settings.login.hint.item1')}</div>
                    <div>• {t('admin.settings.login.hint.item2')}</div>
                    <div>• {t('admin.settings.login.hint.item3')}</div>
                    <div>• {t('admin.settings.login.hint.item4')}</div>
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
                        {/* 模型显示名为后台录入的业务数据，不翻译 */}
                        <span>{model.display_name}</span>
                        <Tag color="blue" size="small">
                          {model.credits_per_chat}{t('unit.credits')}
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
                initialValue={AI_TEMPERATURE_MIN}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={AI_TEMPERATURE_MIN}
                  max={AI_TEMPERATURE_MAX}
                  step={AI_TEMPERATURE_STEP}
                  disabled={disabled}
                />
              </Form.Item>
            </Card>

            {/* 对话字体设置 */}
            <Card
              title={
                <Space>
                  <FontSizeOutlined />
                  <span>{t('admin.settings.chat.fontTitle')}</span>
                </Space>
              }
              size="small"
            >
              <Form.Item
                name={['chat', 'font_family']}
                label={t('admin.settings.chat.fontFamily')}
                tooltip={t('admin.settings.chat.fontFamily.tooltip')}
                initialValue="system-ui"
              >
                <Select
                  disabled={disabled}
                  placeholder={t('admin.settings.chat.fontFamily.placeholder')}
                  showSearch
                  optionFilterProp="label"
                >
                  {FONT_OPTIONS.map(font => {
                    // labelKey 存在时走 i18n（仅"系统默认"），否则用字体资源名原文；
                    // label 需同时传给 Option 的 label 属性以支持 showSearch 过滤
                    const fontLabel = font.labelKey ? t(font.labelKey) : font.label
                    return (
                      <Select.Option key={font.value} value={font.value} label={fontLabel}>
                        <span style={{ fontFamily: font.value }}>{fontLabel}</span>
                      </Select.Option>
                    )
                  })}
                </Select>
              </Form.Item>

              <Form.Item
                name={['chat', 'font_size']}
                label={t('admin.settings.chat.fontSize')}
                tooltip={t('admin.settings.chat.fontSize.tooltip')}
                initialValue={DEFAULT_FONT_SIZE}
              >
                <Select
                  disabled={disabled}
                  placeholder={t('admin.settings.chat.fontSize.placeholder')}
                >
                  {FONT_SIZE_OPTIONS.map(size => (
                    <Select.Option key={size.value} value={size.value}>
                      {t(size.sizeKey, { size: size.value })}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Alert
                message={t('admin.settings.chat.fontHint.title')}
                description={t('admin.settings.chat.fontHint.description')}
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
