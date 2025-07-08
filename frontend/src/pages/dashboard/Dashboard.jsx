import React from 'react'
import { Card, Row, Col, Statistic, Typography, Space, Tag, Progress } from 'antd'
import {
  UserOutlined,
  MessageOutlined,
  ApiOutlined,
  DollarOutlined,
  TrophyOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import useAuthStore from '../../stores/authStore'

const { Title, Paragraph } = Typography

const Dashboard = () => {
  const { user, permissions } = useAuthStore()

  // 示例数据
  const stats = [
    {
      title: '今日对话',
      value: 12,
      prefix: <MessageOutlined />,
      suffix: '次'
    },
    {
      title: 'Token消耗',
      value: user?.used_tokens || 0,
      prefix: <ApiOutlined />,
      suffix: 'tokens'
    },
    {
      title: '剩余配额',
      value: (user?.token_quota || 0) - (user?.used_tokens || 0),
      prefix: <DollarOutlined />,
      suffix: 'tokens'
    },
    {
      title: '使用天数',
      value: 5,
      prefix: <ClockCircleOutlined />,
      suffix: '天'
    }
  ]

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

  const tokenUsagePercent = user?.token_quota 
    ? Math.round((user.used_tokens / user.token_quota) * 100)
    : 0

  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={2} className="page-title">
          工作台
        </Title>
        <Paragraph type="secondary">
          欢迎回来，{user?.username}！这里是您的AI助手控制面板。
        </Paragraph>
      </div>

      {/* 用户信息卡片 */}
      <Card style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 24
            }}>
              <UserOutlined />
            </div>
          </Col>
          <Col flex={1}>
            <div>
              <Title level={4} style={{ margin: 0 }}>
                {user?.username}
              </Title>
              <Space style={{ marginTop: 4 }}>
                <Tag color={roleColors[user?.role]}>
                  {roleNames[user?.role]}
                </Tag>
                <span style={{ color: '#666' }}>{user?.email}</span>
              </Space>
            </div>
          </Col>
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Token使用率</div>
              <Progress
                type="circle"
                percent={tokenUsagePercent}
                size={60}
                format={(percent) => `${percent}%`}
                strokeColor={tokenUsagePercent > 80 ? '#ff4d4f' : '#52c41a'}
              />
            </div>
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {stats.map((stat, index) => (
          <Col xs={24} sm={12} lg={6} key={index}>
            <Card>
              <Statistic
                title={stat.title}
                value={stat.value}
                prefix={stat.prefix}
                suffix={stat.suffix}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 快速操作 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="快速开始" extra={<TrophyOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Card size="small" hoverable>
                <Card.Meta
                  avatar={<MessageOutlined style={{ color: '#1677ff' }} />}
                  title="开始AI对话"
                  description="与AI助手进行智能对话，获取您需要的答案"
                />
              </Card>
              
              {permissions.includes('user.manage') && (
                <Card size="small" hoverable>
                  <Card.Meta
                    avatar={<UserOutlined style={{ color: '#52c41a' }} />}
                    title="用户管理"
                    description="管理系统用户和权限分配"
                  />
                </Card>
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="使用统计">
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span>Token配额使用情况</span>
                  <span style={{ float: 'right', color: '#666' }}>
                    {user?.used_tokens || 0} / {user?.token_quota || 0}
                  </span>
                </div>
                <Progress
                  percent={tokenUsagePercent}
                  strokeColor={tokenUsagePercent > 80 ? '#ff4d4f' : '#52c41a'}
                  showInfo={false}
                />
              </div>
              
              <div style={{ padding: 16, background: '#fafafa', borderRadius: 6 }}>
                <Title level={5} style={{ margin: 0 }}>
                  权限列表
                </Title>
                <div style={{ marginTop: 8 }}>
                  {permissions.map(permission => (
                    <Tag key={permission} style={{ marginBottom: 4 }}>
                      {permission}
                    </Tag>
                  ))}
                </div>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
