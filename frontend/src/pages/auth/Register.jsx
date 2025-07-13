import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  message
} from 'antd'
import {
  UserOutlined,
  LockOutlined,
  MailOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import LanguageSwitch from '../../components/common/LanguageSwitch'

const { Title, Text } = Typography

const Register = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { register, checkEmailAvailable, checkUsernameAvailable, loading } = useAuthStore()
  const [form] = Form.useForm()
  const [error, setError] = useState('')

  // 处理注册
  const handleSubmit = async (values) => {
    setError('')
    
    const result = await register({
      email: values.email,
      username: values.username,
      password: values.password,
      confirmPassword: values.confirmPassword
    })

    if (result.success) {
      message.success(t('auth.register.success'))
      navigate('/login')
    } else {
      setError(result.message)
    }
  }

  // 验证邮箱可用性
  const validateEmail = async (_, value) => {
    if (!value) return Promise.resolve()
    
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
          <Title level={2} style={{ color: '#1890ff', marginBottom: '8px' }}>
            {t('app.name')}
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
          <Form.Item
            name="email"
            label={t('auth.register.email')}
            rules={[
              {
                required: true,
                message: t('auth.register.email.required')
              },
              {
                type: 'email',
                message: t('auth.register.email.invalid')
              },
              {
                validator: validateEmail
              }
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder={t('auth.register.email.required')}
            />
          </Form.Item>

          <Form.Item
            name="username"
            label={t('auth.register.username')}
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
            name="password"
            label={t('auth.register.password')}
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
            label={t('auth.register.confirmPassword')}
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
