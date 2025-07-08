import React, { useState } from 'react'
import { Form, Input, Button, Card, message, Typography, Space } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import useAuthStore from '../../stores/authStore'

const { Title, Text } = Typography

const Login = () => {
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (values) => {
    try {
      setLoading(true)
      await login(values)
      message.success('登录成功')
      navigate('/')
    } catch (error) {
      console.error('登录失败:', error)
      message.error(error.response?.data?.message || '登录失败，请检查用户名和密码')
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
      padding: '20px'
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: '400px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          borderRadius: '8px'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <Title level={2} style={{ color: '#1890ff', marginBottom: '8px' }}>
            AI Platform
          </Title>
          <Text type="secondary">企业级AI应用聚合平台</Text>
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
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="邮箱地址"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
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
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Space>
            <Text type="secondary">还没有账号？</Text>
            <Link to="/register">立即注册</Link>
          </Space>
        </div>

        <div style={{ 
          marginTop: '30px', 
          padding: '16px', 
          background: '#f6f8fa', 
          borderRadius: '4px' 
        }}>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            <strong>测试账户：</strong><br />
            邮箱: admin@ai.xingyuncl.com<br />
            密码: admin123
          </Text>
        </div>
      </Card>
    </div>
  )
}

export default Login
