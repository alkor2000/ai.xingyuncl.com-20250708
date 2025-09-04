import React, { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Typography, Space, Spin, Tabs } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined, MailOutlined, PhoneOutlined, SafetyOutlined, HomeOutlined, ArrowLeftOutlined } from '@ant-design/icons'
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
        setPublicConfig({
          user: { allow_register: true },
          login: { mode: 'standard' }
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
      timer = setTimeout(() => setCountdown(countdown - 1), 1000)
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
        let tokenExpiresAt = null
        if (data.expiresIn) {
          const hours = parseInt(data.expiresIn.replace('h', '')) || 12
          tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
        }
        
        useAuthStore.setState({
          user: data.user,
          permissions: data.permissions || [],
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: tokenExpiresAt,
          isAuthenticated: true
        })
        
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`
        
        if (window.useChatStore) {
          const chatStore = window.useChatStore.getState()
          if (chatStore && chatStore.reset) {
            chatStore.reset()
          }
        }
        
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

  // 邮箱+密码+验证码登录处理
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
        let tokenExpiresAt = null
        if (data.expiresIn) {
          const hours = parseInt(data.expiresIn.replace('h', '')) || 12
          tokenExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
        }
        
        useAuthStore.setState({
          user: data.user,
          permissions: data.permissions || [],
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: tokenExpiresAt,
          isAuthenticated: true
        })
        
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`
        
        if (window.useChatStore) {
          const chatStore = window.useChatStore.getState()
          if (chatStore && chatStore.reset) {
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

  // 验证函数
  const validateAccount = (_, value) => {
    if (!value) {
      return Promise.reject(new Error(t('auth.login.account.required')))
    }
    return Promise.resolve()
  }

  const validateEmail = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('请输入邮箱地址'))
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return Promise.reject(new Error('邮箱格式不正确'))
    }
    return Promise.resolve()
  }

  // 加载状态
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

  const allowRegister = publicConfig?.user?.allow_register !== false
  const loginMode = publicConfig?.login?.mode || 'standard'

  // iOS风格的样式定义
  const iosStyles = {
    // 输入框样式
    inputStyle: {
      height: '48px',
      borderRadius: '12px',
      fontSize: '16px',
      backgroundColor: '#f8f9fa',
      border: 'none',
      padding: '0 16px',
      transition: 'all 0.3s ease'
    },
    // 按钮样式
    buttonStyle: {
      height: '50px',
      borderRadius: '12px',
      fontSize: '17px',
      fontWeight: '600',
      background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
      border: 'none',
      boxShadow: '0 4px 15px rgba(0, 122, 255, 0.3)',
      transition: 'all 0.3s ease'
    },
    // 验证码按钮样式
    codeButtonStyle: {
      height: '48px',
      borderRadius: '12px',
      fontSize: '15px',
      fontWeight: '500',
      minWidth: '120px'
    }
  }

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
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: 0.1,
        background: `
          radial-gradient(circle at 20% 50%, #fff 0%, transparent 50%),
          radial-gradient(circle at 80% 80%, #fff 0%, transparent 50%),
          radial-gradient(circle at 40% 20%, #fff 0%, transparent 50%)
        `,
        pointerEvents: 'none'
      }} />

      {/* 语言切换器 */}
      <div style={{ 
        position: 'absolute', 
        top: 20, 
        right: 20,
        zIndex: 10
      }}>
        <LanguageSwitch />
      </div>

      {/* 返回首页按钮 - iOS风格 */}
      <Button
        icon={<ArrowLeftOutlined style={{ fontSize: '18px' }} />}
        onClick={() => navigate('/')}
        style={{ 
          position: 'absolute', 
          top: 20, 
          left: 20,
          zIndex: 10,
          background: 'rgba(255, 255, 255, 0.95)',
          border: 'none',
          borderRadius: '24px',
          padding: '0 20px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '15px',
          fontWeight: 600,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)'
          e.currentTarget.style.boxShadow = '0 12px 48px rgba(31, 38, 135, 0.2)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(31, 38, 135, 0.15)'
        }}
      >
        返回首页
      </Button>

      {/* 登录卡片 - iOS风格 */}
      <Card
        style={{
          width: '100%',
          maxWidth: '380px',
          borderRadius: '20px',
          border: 'none',
          backdropFilter: 'blur(20px)',
          background: 'rgba(255, 255, 255, 0.98)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
          padding: '20px 8px'
        }}
        bodyStyle={{
          padding: '32px 32px 24px'
        }}
      >
        {/* 标题区域 - 更紧凑的设计 */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <Title 
            level={2} 
            style={{ 
              margin: 0,
              fontSize: '32px',
              fontWeight: '700',
              background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.5px'
            }}
          >
            {t('auth.login.title', '登录')}
          </Title>
          <Paragraph 
            type="secondary" 
            style={{ 
              marginTop: '8px',
              marginBottom: 0,
              fontSize: '15px',
              color: '#8e8e93'
            }}
          >
            {t('auth.login.subtitle', '欢迎回来，请登录您的账户')}
          </Paragraph>
        </div>

        {/* 登录表单 */}
        {loginMode === 'standard' ? (
          <Tabs 
            activeKey={loginType} 
            onChange={setLoginType} 
            centered
            style={{ marginTop: '-10px' }}
            tabBarStyle={{ 
              borderBottom: 'none',
              marginBottom: '24px'
            }}
          >
            <TabPane tab={<span style={{ fontSize: '15px', fontWeight: 500 }}>密码登录</span>} key="password">
              <Form
                name="passwordLogin"
                onFinish={handlePasswordLogin}
                autoComplete="off"
                size="large"
                style={{ marginTop: '8px' }}
              >
                <Form.Item
                  name="account"
                  rules={[{ validator: validateAccount }]}
                  style={{ marginBottom: '16px' }}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: '#8e8e93' }} />}
                    placeholder={t('auth.login.account.placeholder', '邮箱 / 手机号 / 用户名')}
                    autoComplete="username"
                    style={iosStyles.inputStyle}
                    onFocus={(e) => {
                      e.target.style.backgroundColor = '#ffffff'
                      e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                    }}
                    onBlur={(e) => {
                      e.target.style.backgroundColor = '#f8f9fa'
                      e.target.style.boxShadow = 'none'
                    }}
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  rules={[{ required: true, message: t('auth.login.password.required') }]}
                  style={{ marginBottom: '24px' }}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: '#8e8e93' }} />}
                    placeholder={t('auth.login.password')}
                    autoComplete="current-password"
                    style={iosStyles.inputStyle}
                    onFocus={(e) => {
                      e.target.style.backgroundColor = '#ffffff'
                      e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                    }}
                    onBlur={(e) => {
                      e.target.style.backgroundColor = '#f8f9fa'
                      e.target.style.boxShadow = 'none'
                    }}
                  />
                </Form.Item>

                <Form.Item style={{ marginBottom: '16px' }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    style={iosStyles.buttonStyle}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.transform = 'translateY(-1px)'
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 122, 255, 0.4)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 122, 255, 0.3)'
                    }}
                  >
                    {t('auth.login.button')}
                  </Button>
                </Form.Item>
              </Form>
            </TabPane>

            <TabPane tab={<span style={{ fontSize: '15px', fontWeight: 500 }}>验证码登录</span>} key="code">
              <Form
                name="codeLogin"
                onFinish={handleCodeLogin}
                autoComplete="off"
                size="large"
                style={{ marginTop: '8px' }}
              >
                <Form.Item
                  name="email"
                  rules={[{ validator: validateEmail }]}
                  style={{ marginBottom: '16px' }}
                >
                  <Input
                    prefix={<MailOutlined style={{ color: '#8e8e93' }} />}
                    placeholder="请输入邮箱地址"
                    autoComplete="email"
                    style={iosStyles.inputStyle}
                    onFocus={(e) => {
                      e.target.style.backgroundColor = '#ffffff'
                      e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                    }}
                    onBlur={(e) => {
                      e.target.style.backgroundColor = '#f8f9fa'
                      e.target.style.boxShadow = 'none'
                    }}
                  />
                </Form.Item>

                <Form.Item style={{ marginBottom: '24px' }}>
                  <Space style={{ width: '100%', gap: '12px' }} size={12}>
                    <Form.Item
                      name="code"
                      noStyle
                      rules={[
                        { required: true, message: '请输入验证码' },
                        { pattern: /^\d{6}$/, message: '验证码为6位数字' }
                      ]}
                    >
                      <Input
                        prefix={<SafetyOutlined style={{ color: '#8e8e93' }} />}
                        placeholder="请输入验证码"
                        style={{ ...iosStyles.inputStyle, flex: 1 }}
                        onFocus={(e) => {
                          e.target.style.backgroundColor = '#ffffff'
                          e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                        }}
                        onBlur={(e) => {
                          e.target.style.backgroundColor = '#f8f9fa'
                          e.target.style.boxShadow = 'none'
                        }}
                      />
                    </Form.Item>
                    <Form.Item noStyle dependencies={['email']}>
                      {({ getFieldValue }) => (
                        <Button
                          onClick={() => handleSendCode(getFieldValue('email'))}
                          loading={sendingCode}
                          disabled={countdown > 0}
                          style={iosStyles.codeButtonStyle}
                        >
                          {countdown > 0 ? `${countdown}s` : '获取验证码'}
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
                    style={iosStyles.buttonStyle}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.transform = 'translateY(-1px)'
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 122, 255, 0.4)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 122, 255, 0.3)'
                    }}
                  >
                    登录
                  </Button>
                </Form.Item>
              </Form>
            </TabPane>
          </Tabs>
        ) : (
          // 强制邮箱验证模式
          <Form
            name="emailPasswordLogin"
            onFinish={handleEmailPasswordLogin}
            autoComplete="off"
            size="large"
          >
            <Form.Item
              name="email"
              rules={[{ validator: validateEmail }]}
              style={{ marginBottom: '16px' }}
            >
              <Input
                prefix={<MailOutlined style={{ color: '#8e8e93' }} />}
                placeholder="请输入邮箱地址"
                autoComplete="email"
                style={iosStyles.inputStyle}
                onFocus={(e) => {
                  e.target.style.backgroundColor = '#ffffff'
                  e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                }}
                onBlur={(e) => {
                  e.target.style.backgroundColor = '#f8f9fa'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
              style={{ marginBottom: '16px' }}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#8e8e93' }} />}
                placeholder="请输入密码"
                autoComplete="current-password"
                style={iosStyles.inputStyle}
                onFocus={(e) => {
                  e.target.style.backgroundColor = '#ffffff'
                  e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                }}
                onBlur={(e) => {
                  e.target.style.backgroundColor = '#f8f9fa'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: '24px' }}>
              <Space style={{ width: '100%', gap: '12px' }} size={12}>
                <Form.Item
                  name="code"
                  noStyle
                  rules={[
                    { required: true, message: '请输入验证码' },
                    { pattern: /^\d{6}$/, message: '验证码为6位数字' }
                  ]}
                >
                  <Input
                    prefix={<SafetyOutlined style={{ color: '#8e8e93' }} />}
                    placeholder="请输入验证码"
                    style={{ ...iosStyles.inputStyle, flex: 1 }}
                    onFocus={(e) => {
                      e.target.style.backgroundColor = '#ffffff'
                      e.target.style.boxShadow = '0 0 0 3px rgba(0, 122, 255, 0.1)'
                    }}
                    onBlur={(e) => {
                      e.target.style.backgroundColor = '#f8f9fa'
                      e.target.style.boxShadow = 'none'
                    }}
                  />
                </Form.Item>
                <Form.Item noStyle dependencies={['email']}>
                  {({ getFieldValue }) => (
                    <Button
                      onClick={() => handleSendCode(getFieldValue('email'))}
                      loading={sendingCode}
                      disabled={countdown > 0}
                      style={iosStyles.codeButtonStyle}
                    >
                      {countdown > 0 ? `${countdown}s` : '获取验证码'}
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
                style={iosStyles.buttonStyle}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.transform = 'translateY(-1px)'
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 122, 255, 0.4)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 122, 255, 0.3)'
                }}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        )}

        {/* 简化的提示区域 */}
        <div style={{ 
          textAlign: 'center',
          marginTop: '20px',
          paddingTop: '20px',
          borderTop: '1px solid #f0f0f0'
        }}>
          {loginMode === 'standard' && loginType === 'password' && (
            <Text style={{ fontSize: '13px', color: '#8e8e93' }}>
              支持邮箱、手机号或用户名登录
            </Text>
          )}
          {loginMode === 'standard' && loginType === 'code' && (
            <Text style={{ fontSize: '13px', color: '#8e8e93' }}>
              验证码5分钟内有效
            </Text>
          )}
          {loginMode !== 'standard' && (
            <Text style={{ fontSize: '13px', color: '#8e8e93' }}>
              需要邮箱、密码和验证码三重验证
            </Text>
          )}
        </div>

        {/* 注册链接 */}
        {allowRegister && (
          <div style={{ 
            textAlign: 'center',
            marginTop: '16px'
          }}>
            <Space>
              <Text style={{ fontSize: '14px', color: '#8e8e93' }}>
                {t('auth.login.noAccount')}
              </Text>
              <Link 
                to="/register"
                style={{ 
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#007AFF'
                }}
              >
                {t('auth.login.register')}
              </Link>
            </Space>
          </div>
        )}
      </Card>
    </div>
  )
}

export default Login
