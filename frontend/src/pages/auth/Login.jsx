import React, { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Typography, Space, Spin, Tabs } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined, MailOutlined, PhoneOutlined, SafetyOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'
import apiClient from '../../utils/api'

const { Title, Text, Paragraph } = Typography
const { TabPane } = Tabs

const Login = () => {
  const [loading, setLoading] = useState(false)
  const [publicConfig, setPublicConfig] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [loginType, setLoginType] = useState('password') // password | code
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // 获取公开系统配置
  useEffect(() => {
    const fetchPublicConfig = async () => {
      try {
        const response = await apiClient.get('/public/system-config')
        if (response.data?.success && response.data?.data) {
          setPublicConfig(response.data.data)
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
          },
          login: {
            mode: 'standard'
          }
        })
      } finally {
        setConfigLoading(false)
      }
    }

    fetchPublicConfig()
  }, [])

  // 倒计时处理
  useEffect(() => {
    let timer
    if (countdown > 0) {
      timer = setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  // 密码登录处理
  const handlePasswordLogin = async (values) => {
    try {
      setLoading(true)
      const loginData = {
        account: values.account,
        password: values.password
      }
      await login(loginData)
      message.success(t('auth.login.success'))
      navigate('/')
    } catch (error) {
      console.error('登录失败:', error)
      message.error(error.response?.data?.message || t('auth.login.failed'))
    } finally {
      setLoading(false)
    }
  }

  // 发送验证码
  const handleSendCode = async (email) => {
    if (!email) {
      message.warning('请先输入邮箱地址')
      return
    }

    // 验证邮箱格式
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message.warning('请输入有效的邮箱地址')
      return
    }

    try {
      setSendingCode(true)
      const response = await apiClient.post('/auth/send-email-code', { email })
      if (response.data.success) {
        message.success('验证码已发送到您的邮箱')
        setCountdown(60)
      }
    } catch (error) {
      console.error('发送验证码失败:', error)
      message.error(error.response?.data?.message || '发送验证码失败')
    } finally {
      setSendingCode(false)
    }
  }

  // 验证码登录处理
  const handleCodeLogin = async (values) => {
    try {
      setLoading(true)
      const response = await apiClient.post('/auth/login-by-code', {
        email: values.email,
        code: values.code
      })
      
      if (response.data.success) {
        const { data } = response.data
        
        // 使用authStore的set方法来更新状态
        const authStore = useAuthStore.getState()
        
        // 计算Token过期时间
        let tokenExpiresAt = null
        if (data.expiresIn) {
          const hours = parseInt(data.expiresIn.replace('h', '')) || 12
          tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
        }
        
        // 通过setState方法更新状态
        useAuthStore.setState({
          user: data.user,
          permissions: data.permissions || [],
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: tokenExpiresAt,
          isAuthenticated: true
        })
        
        // 设置默认请求头
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`
        
        // 清理之前用户的聊天数据
        if (window.useChatStore) {
          const chatStore = window.useChatStore.getState()
          if (chatStore && chatStore.reset) {
            console.log('🧹 清除之前的聊天数据...')
            chatStore.reset()
          }
        }
        
        console.log('✅ 用户登录成功:', {
          user: data.user.email,
          role: data.user.role,
          permissions: data.permissions?.length || 0,
          tokenExpires: tokenExpiresAt?.toLocaleString()
        })
        
        message.success(t('auth.login.success'))
        navigate('/')
      }
    } catch (error) {
      console.error('验证码登录失败:', error)
      message.error(error.response?.data?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  // 邮箱+密码+验证码登录处理（强制验证模式）
  const handleEmailPasswordLogin = async (values) => {
    try {
      setLoading(true)
      const response = await apiClient.post('/auth/login-by-email-password', {
        email: values.email,
        password: values.password,
        code: values.code
      })
      
      if (response.data.success) {
        const { data } = response.data
        
        // 计算Token过期时间
        let tokenExpiresAt = null
        if (data.expiresIn) {
          const hours = parseInt(data.expiresIn.replace('h', '')) || 12
          tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
        }
        
        // 通过setState方法更新状态
        useAuthStore.setState({
          user: data.user,
          permissions: data.permissions || [],
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: tokenExpiresAt,
          isAuthenticated: true
        })
        
        // 设置默认请求头
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`
        
        // 清理之前用户的聊天数据
        if (window.useChatStore) {
          const chatStore = window.useChatStore.getState()
          if (chatStore && chatStore.reset) {
            console.log('🧹 清除之前的聊天数据...')
            chatStore.reset()
          }
        }
        
        message.success(t('auth.login.success'))
        navigate('/')
      }
    } catch (error) {
      console.error('登录失败:', error)
      message.error(error.response?.data?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  // 验证账号输入（可以是邮箱、手机号或用户名）
  const validateAccount = (_, value) => {
    if (!value) {
      return Promise.reject(new Error(t('auth.login.account.required')))
    }
    return Promise.resolve()
  }

  // 验证邮箱
  const validateEmail = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('请输入邮箱地址'))
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return Promise.reject(new Error('邮箱格式不正确'))
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
  const allowRegister = publicConfig?.user?.allow_register !== false
  const loginMode = publicConfig?.login?.mode || 'standard'

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px',
      position: 'relative'
    }}>
      {/* 语言切换器移到页面右上角 */}
      <div style={{ 
        position: 'absolute', 
        top: 20, 
        right: 20,
        zIndex: 10
      }}>
        <LanguageSwitch />
      </div>

      <Card
        style={{
          width: '100%',
          maxWidth: '400px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          borderRadius: '8px'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
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
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('auth.login.subtitle', '登录您的账户')}
          </Paragraph>
        </div>

        {/* 根据登录模式显示不同的界面 */}
        {loginMode === 'standard' ? (
          // 标准模式：显示tabs
          <Tabs activeKey={loginType} onChange={setLoginType} centered>
            <TabPane tab="密码登录" key="password">
              <Form
                name="passwordLogin"
                onFinish={handlePasswordLogin}
                autoComplete="off"
                size="large"
              >
                <Form.Item
                  name="account"
                  rules={[{ validator: validateAccount }]}
                >
                  <Input
                    prefix={<UserOutlined />}
                    placeholder={t('auth.login.account.placeholder', '邮箱 / 手机号 / 用户名')}
                    autoComplete="username"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  rules={[{ required: true, message: t('auth.login.password.required') }]}
                >
                  <Input.Password
                    prefix={<LockOutlined />}
                    placeholder={t('auth.login.password')}
                    autoComplete="current-password"
                  />
                </Form.Item>

                <Form.Item style={{ marginBottom: '16px' }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    icon={<LoginOutlined />}
                  >
                    {t('auth.login.button')}
                  </Button>
                </Form.Item>
              </Form>
            </TabPane>

            <TabPane tab="邮箱验证码登录" key="code">
              <Form
                name="codeLogin"
                onFinish={handleCodeLogin}
                autoComplete="off"
                size="large"
              >
                <Form.Item
                  name="email"
                  rules={[{ validator: validateEmail }]}
                >
                  <Input
                    prefix={<MailOutlined />}
                    placeholder="请输入邮箱地址"
                    autoComplete="email"
                  />
                </Form.Item>

                <Form.Item>
                  <Space style={{ width: '100%' }} size={8}>
                    <Form.Item
                      name="code"
                      noStyle
                      rules={[
                        { required: true, message: '请输入验证码' },
                        { pattern: /^\d{6}$/, message: '验证码为6位数字' }
                      ]}
                    >
                      <Input
                        prefix={<SafetyOutlined />}
                        placeholder="请输入验证码"
                        style={{ flex: 1 }}
                      />
                    </Form.Item>
                    <Form.Item noStyle dependencies={['email']}>
                      {({ getFieldValue }) => (
                        <Button
                          onClick={() => handleSendCode(getFieldValue('email'))}
                          loading={sendingCode}
                          disabled={countdown > 0}
                        >
                          {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                        </Button>
                      )}
                    </Form.Item>
                  </Space>
                </Form.Item>

                <Form.Item style={{ marginBottom: '16px' }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    icon={<LoginOutlined />}
                  >
                    登录
                  </Button>
                </Form.Item>
              </Form>
            </TabPane>
          </Tabs>
        ) : (
          // 强制邮箱验证模式：只显示一个表单
          <Form
            name="emailPasswordLogin"
            onFinish={handleEmailPasswordLogin}
            autoComplete="off"
            size="large"
          >
            <Form.Item
              name="email"
              rules={[{ validator: validateEmail }]}
            >
              <Input
                prefix={<MailOutlined />}
                placeholder="请输入邮箱地址"
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item>
              <Space style={{ width: '100%' }} size={8}>
                <Form.Item
                  name="code"
                  noStyle
                  rules={[
                    { required: true, message: '请输入验证码' },
                    { pattern: /^\d{6}$/, message: '验证码为6位数字' }
                  ]}
                >
                  <Input
                    prefix={<SafetyOutlined />}
                    placeholder="请输入验证码"
                    style={{ flex: 1 }}
                  />
                </Form.Item>
                <Form.Item noStyle dependencies={['email']}>
                  {({ getFieldValue }) => (
                    <Button
                      onClick={() => handleSendCode(getFieldValue('email'))}
                      loading={sendingCode}
                      disabled={countdown > 0}
                    >
                      {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                    </Button>
                  )}
                </Form.Item>
              </Space>
            </Form.Item>

            <Form.Item style={{ marginBottom: '16px' }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                icon={<LoginOutlined />}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        )}

        {/* 登录提示 */}
        <div style={{ 
          marginBottom: '20px', 
          padding: '12px', 
          background: '#f0f2f5', 
          borderRadius: '4px',
          fontSize: '13px',
          color: '#666'
        }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {loginMode === 'standard' && loginType === 'password' ? (
              <>
                <div>
                  <MailOutlined style={{ marginRight: '6px' }} />
                  {t('auth.login.hint.email', '支持邮箱登录')}
                </div>
                <div>
                  <PhoneOutlined style={{ marginRight: '6px' }} />
                  {t('auth.login.hint.phone', '支持手机号登录')}
                </div>
                <div>
                  <UserOutlined style={{ marginRight: '6px' }} />
                  {t('auth.login.hint.username', '支持用户名登录')}
                </div>
              </>
            ) : loginMode === 'standard' && loginType === 'code' ? (
              <>
                <div>
                  <SafetyOutlined style={{ marginRight: '6px' }} />
                  验证码5分钟内有效
                </div>
                <div>
                  <MailOutlined style={{ marginRight: '6px' }} />
                  请确保邮箱已注册
                </div>
              </>
            ) : (
              <>
                <div>
                  <LockOutlined style={{ marginRight: '6px' }} />
                  当前为高安全模式
                </div>
                <div>
                  <SafetyOutlined style={{ marginRight: '6px' }} />
                  需要邮箱、密码和验证码三重验证
                </div>
                <div>
                  <MailOutlined style={{ marginRight: '6px' }} />
                  验证码5分钟内有效
                </div>
              </>
            )}
          </Space>
        </div>

        {allowRegister && (
          <div style={{ textAlign: 'center' }}>
            <Space>
              <Text type="secondary">{t('auth.login.noAccount')}</Text>
              <Link to="/register">{t('auth.login.register')}</Link>
            </Space>
          </div>
        )}
      </Card>
    </div>
  )
}

export default Login
