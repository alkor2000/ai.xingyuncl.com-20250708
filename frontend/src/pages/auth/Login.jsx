import React, { useState } from 'react'
import { Form, Input, Button, Card, message, Typography, Space } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'

const { Title, Text } = Typography

const Login = () => {
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const handleSubmit = async (values) => {
    try {
      setLoading(true)
      await login(values)
      message.success(t('auth.login.success'))
      navigate('/')
    } catch (error) {
      console.error('登录失败:', error)
      message.error(error.response?.data?.message || t('auth.login.failed'))
    } finally {
      setLoading(false)
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
          <Title level={2} style={{ color: '#1890ff', marginBottom: 0 }}>
            {t('app.name')}
          </Title>
        </div>

        <Form
          name="login"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: t('auth.login.email.required') },
              { type: 'email', message: t('auth.login.email.invalid') }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('auth.login.email')}
              autoComplete="email"
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

        <div style={{ textAlign: 'center' }}>
          <Space>
            <Text type="secondary">{t('auth.login.noAccount')}</Text>
            <Link to="/register">{t('auth.login.register')}</Link>
          </Space>
        </div>
      </Card>
    </div>
  )
}

export default Login
