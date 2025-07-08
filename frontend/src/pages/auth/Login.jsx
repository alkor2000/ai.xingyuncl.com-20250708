import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Checkbox,
  Alert,
  Space,
  Typography
} from 'antd'
import {
  UserOutlined,
  LockOutlined,
  MailOutlined
} from '@ant-design/icons'
import useAuthStore from '../../stores/authStore'

const { Title, Text } = Typography

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loading } = useAuthStore()
  const [form] = Form.useForm()
  const [error, setError] = useState('')

  // 获取重定向路径
  const from = location.state?.from?.pathname || '/dashboard'

  // 处理登录
  const handleSubmit = async (values) => {
    setError('')
    
    const result = await login({
      email: values.email,
      password: values.password
    })

    if (result.success) {
      navigate(from, { replace: true })
    } else {
      setError(result.message)
    }
  }

  return (
    <Card className="auth-card">
      <div className="auth-header">
        <div className="auth-logo">AI Platform</div>
        <Title level={4} className="auth-title">
          登录您的账户
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
        name="login"
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
            }
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="请输入邮箱地址"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          rules={[
            {
              required: true,
              message: '请输入密码'
            }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="请输入密码"
          />
        </Form.Item>

        <Form.Item>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center' 
          }}>
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住我</Checkbox>
            </Form.Item>
            
            <Button type="link" size="small">
              忘记密码？
            </Button>
          </div>
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
          >
            登录
          </Button>
        </Form.Item>

        <div className="text-center">
          <Space>
            <Text type="secondary">还没有账户？</Text>
            <Link to="/register">立即注册</Link>
          </Space>
        </div>
      </Form>

      {/* 测试账户信息 */}
      <Card 
        size="small" 
        title="测试账户" 
        style={{ marginTop: 24, fontSize: 12 }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
          <div><strong>超级管理员:</strong></div>
          <div>邮箱: admin@ai.xingyuncl.com</div>
          <div>密码: admin123</div>
          <div style={{ marginTop: 8 }}><strong>普通用户:</strong></div>
          <div>邮箱: user@example.com</div>
          <div>密码: admin123</div>
        </div>
      </Card>
    </Card>
  )
}

export default Login
