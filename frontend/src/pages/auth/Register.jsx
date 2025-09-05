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
          
          // 如果不允许注册，设置需要邀请码
          if (response.data.data.user?.allow_register === false) {
            setRequireInvitationCode(true)
            message.info('系统需要邀请码才能注册')
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
            allow_register: true
          }
        })
      } finally {
        setConfigLoading(false)
      }
    }

    fetchPublicConfig()
  }, [])

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
        message.success(`邀请码有效，将加入"${response.data.data.group_name}"组`)
      } else {
        setInvitationCodeValid(false)
        setInvitationGroupName('')
        if (requireInvitationCode) {
          message.error('邀请码无效或已过期')
        }
      }
    } catch (error) {
      console.error('验证邀请码失败:', error)
      setInvitationCodeValid(false)
      setInvitationGroupName('')
      if (requireInvitationCode) {
        message.error('邀请码验证失败')
      }
    } finally {
      setCheckingCode(false)
    }
  }

  // 处理注册
  const handleSubmit = async (values) => {
    // 如果需要邀请码但未验证通过
    if (requireInvitationCode && !invitationCodeValid) {
      setError('请输入有效的邀请码')
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

  const siteName = publicConfig?.site?.name || t('app.name')

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
        
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          {publicConfig?.site?.logo && (
            <img 
              src={publicConfig.site.logo} 
              alt={siteName}
              style={{ 
                maxHeight: '60px', 
                maxWidth: '200px',
                marginBottom: '20px'
              }}
            />
          )}
          <Title 
            level={3} 
            style={{ 
              color: '#1890ff', 
              marginBottom: '8px',
              fontSize: '22px',
              lineHeight: '1.4',
              fontWeight: 600
            }}
          >
            {siteName}
          </Title>
          <Title level={4} style={{ marginTop: 0, fontWeight: 'normal' }}>
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

        <Form
          form={form}
          name="register"
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          {/* 邀请码输入框 - 放在最前面 */}
          <Form.Item
            name="invitation_code"
            label={
              <Space>
                <span>邀请码</span>
                {requireInvitationCode && <Text type="danger">*</Text>}
                {invitationCodeValid && (
                  <Text type="success">
                    <CheckCircleOutlined /> 将加入"{invitationGroupName}"
                  </Text>
                )}
              </Space>
            }
            rules={[
              {
                required: requireInvitationCode,
                message: '请输入邀请码'
              },
              {
                len: 5,
                message: '邀请码为5位字符',
                validateTrigger: 'onBlur'
              },
              {
                pattern: /^[A-Za-z0-9]{5}$/,
                message: '邀请码只能包含字母和数字',
                validateTrigger: 'onBlur'
              }
            ]}
            extra={
              requireInvitationCode 
                ? '系统需要邀请码才能注册' 
                : '如有邀请码，可加入指定组织'
            }
          >
            <Input
              prefix={<TeamOutlined />}
              placeholder="输入5位邀请码（可选）"
              style={{ textTransform: 'uppercase' }}
              onChange={(e) => {
                const value = e.target.value
                if (value) {
                  form.setFieldsValue({ invitation_code: value.toUpperCase() })
                  if (value.length === 5) {
                    handleVerifyInvitationCode(value)
                  }
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
                <Text type="danger">*</Text>
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
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('auth.register.username.required')}
            />
          </Form.Item>

          <Form.Item
            name="email"
            label={
              <Space>
                <span>{t('auth.register.email')}</span>
                <Tooltip title="邮箱用于找回密码和接收通知（可选）">
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
            extra="选填，用于找回密码和接收通知"
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="请输入邮箱（可选）"
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
          >
            <Input
              prefix={<PhoneOutlined />}
              placeholder={t('auth.register.phone')}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={
              <Space>
                <span>{t('auth.register.password')}</span>
                <Text type="danger">*</Text>
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
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('auth.register.password.required')}
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label={
              <Space>
                <span>{t('auth.register.confirmPassword')}</span>
                <Text type="danger">*</Text>
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
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('auth.register.confirmPassword.required')}
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
