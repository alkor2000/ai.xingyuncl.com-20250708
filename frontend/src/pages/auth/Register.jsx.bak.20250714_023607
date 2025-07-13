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
import useAuthStore from '../../stores/authStore'

const { Title, Text } = Typography

const Register = () => {
  const navigate = useNavigate()
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
      message.success('注册成功！请使用您的账户登录')
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
      return Promise.reject(new Error('该邮箱已被注册'))
    }
    return Promise.resolve()
  }

  // 验证用户名可用性
  const validateUsername = async (_, value) => {
    if (!value) return Promise.resolve()
    
    const available = await checkUsernameAvailable(value)
    if (!available) {
      return Promise.reject(new Error('该用户名已被使用'))
    }
    return Promise.resolve()
  }

  return (
    <Card className="auth-card">
      <div className="auth-header">
        <div className="auth-logo">AI Platform</div>
        <Title level={4} className="auth-title">
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
          label="邮箱地址"
          rules={[
            {
              required: true,
              message: '请输入邮箱地址'
            },
            {
              type: 'email',
              message: '请输入有效的邮箱地址'
            },
            {
              validator: validateEmail
            }
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="请输入邮箱地址"
          />
        </Form.Item>

        <Form.Item
          name="username"
          label="用户名"
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
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="请输入用户名"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          rules={[
            {
              required: true,
              message: '请输入密码'
            },
            {
              min: 6,
              message: '密码长度至少6个字符'
            }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="请输入密码"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="确认密码"
          dependencies={['password']}
          rules={[
            {
              required: true,
              message: '请确认密码'
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
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="请再次输入密码"
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
            注册
          </Button>
        </Form.Item>

        <div className="text-center">
          <Space>
            <Text type="secondary">已有账户？</Text>
            <Link to="/login">立即登录</Link>
          </Space>
        </div>
      </Form>
    </Card>
  )
}

export default Register
