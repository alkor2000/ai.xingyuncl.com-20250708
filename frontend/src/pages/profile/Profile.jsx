import React from 'react'
import { Card, Typography, Form, Input, Button, Avatar, Upload, Space, Tag } from 'antd'
import { UserOutlined, UploadOutlined, EditOutlined } from '@ant-design/icons'
import useAuthStore from '../../stores/authStore'

const { Title, Paragraph } = Typography

const Profile = () => {
  const { user, permissions } = useAuthStore()
  const [form] = Form.useForm()

  const roleNames = {
    'super_admin': '超级管理员',
    'admin': '管理员', 
    'user': '普通用户'
  }

  const roleColors = {
    'super_admin': 'red',
    'admin': 'blue',
    'user': 'green'
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={2} className="page-title">
          个人信息
        </Title>
        <Paragraph type="secondary">
          管理您的个人资料和账户设置。
        </Paragraph>
      </div>

      <Card title="基本信息" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <Avatar
              size={100}
              icon={<UserOutlined />}
              src={user?.avatar_url}
              style={{ marginBottom: 16 }}
            />
            <Upload>
              <Button icon={<UploadOutlined />} size="small">
                更换头像
              </Button>
            </Upload>
          </div>
          
          <div style={{ flex: 1 }}>
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                username: user?.username,
                email: user?.email
              }}
            >
              <Form.Item name="username" label="用户名">
                <Input />
              </Form.Item>
              
              <Form.Item name="email" label="邮箱地址">
                <Input disabled />
              </Form.Item>
              
              <Form.Item label="角色">
                <Tag color={roleColors[user?.role]}>
                  {roleNames[user?.role]}
                </Tag>
              </Form.Item>
              
              <Form.Item>
                <Button type="primary" icon={<EditOutlined />}>
                  更新信息
                </Button>
              </Form.Item>
            </Form>
          </div>
        </div>
      </Card>

      <Card title="账户统计">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div style={{ padding: 16, background: '#f0f2f5', borderRadius: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1677ff' }}>
              {user?.token_quota || 0}
            </div>
            <div style={{ color: '#666' }}>Token配额</div>
          </div>
          
          <div style={{ padding: 16, background: '#f0f2f5', borderRadius: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>
              {user?.used_tokens || 0}
            </div>
            <div style={{ color: '#666' }}>已使用Token</div>
          </div>
          
          <div style={{ padding: 16, background: '#f0f2f5', borderRadius: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
              {(user?.token_quota || 0) - (user?.used_tokens || 0)}
            </div>
            <div style={{ color: '#666' }}>剩余Token</div>
          </div>
          
          <div style={{ padding: 16, background: '#f0f2f5', borderRadius: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 'bold', color: '#722ed1' }}>
              {permissions.length}
            </div>
            <div style={{ color: '#666' }}>拥有权限</div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default Profile
