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
              message.error('系统已关闭注册功能')
              // 可以跳转到登录页
              setTimeout(() => navigate('/login'), 2000)
            } else if (userConfig.require_invitation_code === true) {
              // 允许注册但强制邀请码
              setRequireInvitationCode(true)
              message.info('注册需要邀请码')
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
  }, [navigate])

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
          <Title level={3}>注册已关闭</Title>
          <p>系统暂时关闭了注册功能，请联系管理员。</p>
          <Button type="primary" onClick={() => navigate('/login')}>
            返回登录
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
            创建您的账户
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
            message="邀请码注册"
            description="系统要求邀请码才能注册，请向管理员获取邀请码"
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
                message: '请输入5位邀请码'
              },
              {
                len: 5,
                message: '邀请码必须是5位字符',
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
                ? '必须输入有效的邀请码才能注册' 
                : '如有邀请码，可加入指定组织'
            }
            validateFirst={true}
          >
            <Input
              prefix={<TeamOutlined />}
              placeholder="输入5位邀请码"
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
                <span>用户名</span>
                <Text type="danger">*</Text>
              </Space>
            }
            rules={[
              {
                required: true,
                message: '请输入用户名'
              },
              {
                pattern: /^[a-zA-Z0-9_-]{3,20}$/,
                message: '用户名只能包含字母、数字、下划线和横线，长度3-20个字符'
              },
              {
                validator: validateUsername
              }
            ]}
            validateFirst={true}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="请输入用户名"
            />
          </Form.Item>

          <Form.Item
            name="email"
            label={
              <Space>
                <span>邮箱地址</span>
                <Tooltip title="邮箱用于找回密码和接收通知">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[
              {
                type: 'email',
                message: '邮箱格式不正确'
              },
              {
                validator: validateEmail
              }
            ]}
            extra="选填，用于找回密码和接收通知"
            validateFirst={true}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="请输入邮箱"
            />
          </Form.Item>

          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              {
                pattern: /^1[3-9]\d{9}$/,
                message: '手机号格式不正确'
              }
            ]}
            validateFirst={true}
          >
            <Input
              prefix={<PhoneOutlined />}
              placeholder="手机号（选填）"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={
              <Space>
                <span>密码</span>
                <Text type="danger">*</Text>
              </Space>
            }
            rules={[
              {
                required: true,
                message: '请输入密码'
              },
              {
                min: 6,
                message: '密码长度至少6位'
              }
            ]}
            validateFirst={true}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入密码"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label={
              <Space>
                <span>确认密码</span>
                <Text type="danger">*</Text>
              </Space>
            }
            dependencies={['password']}
            rules={[
              {
                required: true,
                message: '请再次输入密码'
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                }
              })
            ]}
            validateFirst={true}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请确认密码"
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
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Space>
              <Text type="secondary">已有账户？</Text>
              <Link to="/login">立即登录</Link>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  )
}

export default Register
