import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  message,
  Spin,
  Tooltip
} from 'antd'
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'
import apiClient from '../../utils/api'

const { Title, Text } = Typography

const Register = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { register, checkEmailAvailable, checkUsernameAvailable, loading } = useAuthStore()
  const [form] = Form.useForm()
  const [error, setError] = useState('')
  const [publicConfig, setPublicConfig] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [invitationCodeValid, setInvitationCodeValid] = useState(false)
  const [invitationGroupName, setInvitationGroupName] = useState('')
  const [checkingCode, setCheckingCode] = useState(false)
  const [requireInvitationCode, setRequireInvitationCode] = useState(false)

  // 获取公开系统配置
  useEffect(() => {
    const fetchPublicConfig = async () => {
      try {
        const response = await apiClient.get('/public/system-config')
        if (response.data?.success && response.data?.data) {
          setPublicConfig(response.data.data)
          
          // 根据配置设置注册策略
          const userConfig = response.data.data.user
          if (userConfig) {
            if (userConfig.allow_register === false) {
              // 不允许注册
              setRequireInvitationCode(false)
              message.error(t('auth.register.systemClosed'))
              // 可以跳转到登录页
              setTimeout(() => navigate('/login'), 2000)
            } else if (userConfig.require_invitation_code === true) {
              // 允许注册但强制邀请码
              setRequireInvitationCode(true)
              message.info(t('auth.register.invitationCode.systemRequired'))
            } else {
              // 允许自由注册
              setRequireInvitationCode(false)
            }
          }
        }
      } catch (error) {
        console.error('获取系统配置失败:', error)
        // 失败时使用默认配置
        setPublicConfig({
          site: {
            name: 'AI Platform',
            description: '企业级AI应用聚合平台',
            logo: ''
          },
          user: {
            allow_register: true,
            require_invitation_code: false
          }
        })
      } finally {
        setConfigLoading(false)
      }
    }

    fetchPublicConfig()
  }, [navigate, t])

  // 验证邀请码
  const handleVerifyInvitationCode = async (value) => {
    if (!value || value.length !== 5) {
      setInvitationCodeValid(false)
      setInvitationGroupName('')
      return
    }

    setCheckingCode(true)
    try {
      const response = await apiClient.post('/auth/verify-invitation-code', {
        code: value.toUpperCase()
      })

      if (response.data?.success && response.data?.data?.valid) {
        setInvitationCodeValid(true)
        setInvitationGroupName(response.data.data.group_name)
        message.success(t('auth.register.invitationCode.valid', { groupName: response.data.data.group_name }))
      } else {
        setInvitationCodeValid(false)
        setInvitationGroupName('')
        if (requireInvitationCode) {
          message.error(t('auth.register.invitationCode.invalid'))
        }
      }
    } catch (error) {
      console.error('验证邀请码失败:', error)
      setInvitationCodeValid(false)
      setInvitationGroupName('')
      if (requireInvitationCode) {
        message.error(t('auth.register.invitationCode.verifyFailed'))
      }
    } finally {
      setCheckingCode(false)
    }
  }

  // 处理注册
  const handleSubmit = async (values) => {
    // 如果需要邀请码但未验证通过
    if (requireInvitationCode && !invitationCodeValid) {
      setError(t('auth.register.needInvitationCode'))
      return
    }

    setError('')
    
    const result = await register({
      email: values.email || null,  // 邮箱现在是可选的
      username: values.username,
      password: values.password,
      phone: values.phone || null,
      invitation_code: values.invitation_code || null,
      confirmPassword: values.confirmPassword
    })

    if (result.success) {
      message.success(t('auth.register.success'))
      navigate('/login')
    } else {
      setError(result.message)
    }
  }

  // 验证邮箱可用性（只在填写了邮箱时验证）
  const validateEmail = async (_, value) => {
    if (!value) return Promise.resolve()  // 邮箱为空时直接通过验证
    
    const available = await checkEmailAvailable(value)
    if (!available) {
      return Promise.reject(new Error(t('auth.register.email.exists')))
    }
    return Promise.resolve()
  }

  // 验证用户名可用性
  const validateUsername = async (_, value) => {
    if (!value) return Promise.resolve()
    
    const available = await checkUsernameAvailable(value)
    if (!available) {
      return Promise.reject(new Error(t('auth.register.username.exists')))
    }
    return Promise.resolve()
  }

  // 如果配置还在加载中，显示加载状态
  if (configLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <Spin size="large" />
      </div>
    )
  }

  // 检查是否允许注册
  if (publicConfig?.user?.allow_register === false) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px'
      }}>
        <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <Title level={3}>{t('auth.register.registrationClosed')}</Title>
          <p>{t('auth.register.registrationClosedDesc')}</p>
          <Button type="primary" onClick={() => navigate('/login')}>
            {t('auth.register.backToLogin')}
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: '450px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          borderRadius: '8px'
        }}
      >
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <LanguageSwitch />
        </div>
        
        {/* 简化的标题，不显示logo和自定义站点名称 */}
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <Title level={3} style={{ marginBottom: 8, color: '#333' }}>
            {t('auth.register.title')}
          </Title>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 24 }}
            closable
            onClose={() => setError('')}
          />
        )}

        {/* 显示注册策略提示 */}
        {requireInvitationCode && (
          <Alert
            message={t('auth.register.invitationCode.systemRequired')}
            description={t('auth.register.invitationCode.systemRequiredDesc')}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          form={form}
          name="register"
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          {/* 邀请码输入框 - 改进错误提示 */}
          <Form.Item
            name="invitation_code"
            label={
              <Space>
                <span>{t('auth.register.invitationCode')}</span>
                {requireInvitationCode && <Text type="danger">{t('auth.register.required')}</Text>}
                {invitationCodeValid && (
                  <Text type="success">
                    <CheckCircleOutlined /> {t('auth.register.invitationCode.willJoin', { groupName: invitationGroupName })}
                  </Text>
                )}
              </Space>
            }
            rules={[
              {
                required: requireInvitationCode,
                message: t('auth.register.invitationCode.required')
              },
              {
                len: 5,
                message: t('auth.register.invitationCode.length'),
                validateTrigger: 'onBlur'
              },
              {
                pattern: /^[A-Za-z0-9]{5}$/,
                message: t('auth.register.invitationCode.pattern'),
                validateTrigger: 'onBlur'
              }
            ]}
            extra={
              requireInvitationCode 
                ? t('auth.register.invitationCode.requiredHint')
                : t('auth.register.invitationCode.optionalHint')
            }
            validateFirst={true}
          >
            <Input
              prefix={<TeamOutlined />}
              placeholder={t('auth.register.invitationCode.placeholder')}
              style={{ textTransform: 'uppercase' }}
              onChange={(e) => {
                const value = e.target.value
                if (value) {
                  form.setFieldsValue({ invitation_code: value.toUpperCase() })
                  if (value.length === 5) {
                    handleVerifyInvitationCode(value)
                  }
                } else {
                  setInvitationCodeValid(false)
                  setInvitationGroupName('')
                }
              }}
              suffix={
                checkingCode ? (
                  <Spin size="small" />
                ) : invitationCodeValid ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : null
              }
            />
          </Form.Item>

          <Form.Item
            name="username"
            label={
              <Space>
                <span>{t('auth.register.username')}</span>
                <Text type="danger">{t('auth.register.required')}</Text>
              </Space>
            }
            rules={[
              {
                required: true,
                message: t('auth.register.username.required')
              },
              {
                pattern: /^[a-zA-Z0-9_-]{3,20}$/,
                message: t('auth.register.username.pattern')
              },
              {
                validator: validateUsername
              }
            ]}
            validateFirst={true}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('auth.register.username.placeholder')}
            />
          </Form.Item>

          <Form.Item
            name="email"
            label={
              <Space>
                <span>{t('auth.register.email')}</span>
                <Tooltip title={t('auth.register.email.tooltip')}>
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[
              {
                type: 'email',
                message: t('auth.register.email.invalid')
              },
              {
                validator: validateEmail
              }
            ]}
            extra={t('auth.register.email.optional')}
            validateFirst={true}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder={t('auth.register.email.placeholder')}
            />
          </Form.Item>

          <Form.Item
            name="phone"
            label={t('auth.register.phone')}
            rules={[
              {
                pattern: /^1[3-9]\d{9}$/,
                message: t('auth.register.phone.pattern')
              }
            ]}
            validateFirst={true}
          >
            <Input
              prefix={<PhoneOutlined />}
              placeholder={t('auth.register.phone.placeholder')}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={
              <Space>
                <span>{t('auth.register.password')}</span>
                <Text type="danger">{t('auth.register.required')}</Text>
              </Space>
            }
            rules={[
              {
                required: true,
                message: t('auth.register.password.required')
              },
              {
                min: 6,
                message: t('auth.register.password.min')
              }
            ]}
            validateFirst={true}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('auth.register.password.placeholder')}
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label={
              <Space>
                <span>{t('auth.register.confirmPassword')}</span>
                <Text type="danger">{t('auth.register.required')}</Text>
              </Space>
            }
            dependencies={['password']}
            rules={[
              {
                required: true,
                message: t('auth.register.confirmPassword.required')
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('auth.register.confirmPassword.mismatch')))
                }
              })
            ]}
            validateFirst={true}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('auth.register.confirmPassword.placeholder')}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              disabled={requireInvitationCode && !invitationCodeValid}
            >
              {t('auth.register.button')}
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Space>
              <Text type="secondary">{t('auth.register.hasAccount')}</Text>
              <Link to="/login">{t('auth.register.login')}</Link>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  )
}

export default Register
