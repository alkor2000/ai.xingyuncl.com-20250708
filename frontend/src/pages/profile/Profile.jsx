/**
 * 个人中心页面
 * 
 * 功能：
 * 1. 基本信息展示与编辑（用户名/手机号）
 * 2. 修改密码（必须验证原密码）
 * 3. 积分统计与历史查询
 * 4. 权限列表展示
 * 
 * 修复：恢复原密码验证，修改密码弹窗加回原密码输入框
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Typography,
  Form,
  Input,
  Button,
  Space,
  Tag,
  Row,
  Col,
  Tabs,
  Table,
  Statistic,
  message,
  Modal,
  Descriptions,
  Divider
} from 'antd'
import {
  UserOutlined,
  EditOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  TeamOutlined,
  CrownOutlined,
  DollarOutlined,
  HistoryOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import './Profile.less'

const { Title, Text } = Typography
const { TabPane } = Tabs

const Profile = () => {
  const { t } = useTranslation()
  const { user, permissions, updateProfile, changePassword, getCreditHistory } = useAuthStore()
  const [profileForm] = Form.useForm()
  const [passwordForm] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [creditHistory, setCreditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPagination, setHistoryPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })

  // 角色显示配置
  const roleConfig = {
    'super_admin': { name: t('role.super_admin'), color: 'red' },
    'admin': { name: t('role.admin'), color: 'blue' },
    'user': { name: t('role.user'), color: 'green' }
  }

  // 初始化表单数据
  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        username: user.username,
        email: user.email,
        phone: user.phone || ''
      })
    }
  }, [user, profileForm])

  // 加载积分历史
  useEffect(() => {
    loadCreditHistory()
  }, [])

  /**
   * 获取积分历史（分页）
   */
  const loadCreditHistory = async (page = 1) => {
    setHistoryLoading(true)
    try {
      const result = await getCreditHistory(page, 10)
      setCreditHistory(result.history)
      setHistoryPagination({
        current: result.pagination.page,
        pageSize: result.pagination.limit,
        total: result.pagination.total
      })
    } catch (error) {
      message.error(t('profile.creditHistory.loadFailed'))
    } finally {
      setHistoryLoading(false)
    }
  }

  /**
   * 更新个人信息
   */
  const handleUpdateProfile = async (values) => {
    setLoading(true)
    try {
      await updateProfile({
        username: values.username,
        phone: values.phone || null
      })
      message.success(t('profile.update.success'))
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.data?.errors) {
        const errors = error.response.data.data.errors
        const errorMessage = Array.isArray(errors) ? errors.join('；') : errors
        message.error(errorMessage)
      } else {
        message.error(error.response?.data?.message || t('profile.update.failed'))
      }
      console.error('更新个人信息失败:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 修改密码 - 必须验证原密码
   * 
   * 安全说明：即使用户已通过JWT认证，修改密码仍需验证原密码
   * 防止 token 被盗后攻击者永久接管账号
   */
  const handleChangePassword = async (values) => {
    setLoading(true)
    try {
      // 传递原密码和新密码，后端会验证原密码是否正确
      await changePassword(values.oldPassword, values.newPassword)
      message.success(t('profile.password.changeSuccess'))
      setPasswordModalVisible(false)
      passwordForm.resetFields()
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.data?.errors) {
        const errors = error.response.data.data.errors
        const errorMessage = Array.isArray(errors) ? errors.join('；') : errors
        message.error(errorMessage)
      } else if (error.response?.status === 401) {
        // 原密码错误
        message.error(error.response?.data?.message || t('profile.password.oldPasswordWrong'))
      } else {
        message.error(error.response?.data?.message || t('profile.password.changeFailed'))
      }
      console.error('修改密码失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 积分历史表格列
  const creditHistoryColumns = [
    {
      title: t('profile.creditHistory.time'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text) => new Date(text).toLocaleString()
    },
    {
      title: t('profile.creditHistory.type'),
      dataIndex: 'transaction_type',
      key: 'transaction_type',
      render: (type) => {
        const typeMap = {
          'admin_add': { text: t('profile.creditHistory.type.adminAdd'), color: 'green' },
          'admin_deduct': { text: t('profile.creditHistory.type.adminDeduct'), color: 'red' },
          'chat_consume': { text: t('profile.creditHistory.type.chatConsume'), color: 'blue' },
          'system_refund': { text: t('profile.creditHistory.type.systemRefund'), color: 'orange' }
        }
        const config = typeMap[type] || { text: type, color: 'default' }
        return <Tag color={config.color}>{config.text}</Tag>
      }
    },
    {
      title: t('profile.creditHistory.amount'),
      dataIndex: 'amount',
      key: 'amount',
      render: (amount) => (
        <Text type={amount > 0 ? 'success' : 'danger'}>
          {amount > 0 ? '+' : ''}{amount}
        </Text>
      )
    },
    {
      title: t('profile.creditHistory.balance'),
      dataIndex: 'balance_after',
      key: 'balance_after'
    },
    {
      title: t('profile.creditHistory.description'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    }
  ]

  return (
    <div className="profile-container">
      <div className="profile-header">
        <Title level={2}>{t('profile.title')}</Title>
        <Text type="secondary">{t('profile.subtitle')}</Text>
      </div>

      <Row gutter={[24, 24]}>
        {/* 左侧 - 用户信息卡片 */}
        <Col xs={24} lg={8}>
          <Card className="user-info-card">
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('profile.id')}>
                {user?.id}
              </Descriptions.Item>
              <Descriptions.Item label={t('profile.email')}>
                <Space>
                  <MailOutlined />
                  {user?.email}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('profile.phone')}>
                <Space>
                  <PhoneOutlined />
                  {user?.phone || t('profile.notSet')}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('profile.role')}>
                <Tag icon={<CrownOutlined />} color={roleConfig[user?.role]?.color}>
                  {roleConfig[user?.role]?.name}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('profile.group')}>
                <Space>
                  <TeamOutlined />
                  {user?.group_name || t('profile.noGroup')}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('profile.registerTime')}>
                {new Date(user?.created_at).toLocaleDateString()}
              </Descriptions.Item>
            </Descriptions>

            <Divider />

            {/* 积分统计 */}
            <div className="credits-stats">
              <Title level={5}>{t('profile.credits.title')}</Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic
                    title={t('profile.credits.remaining')}
                    value={user?.credits_stats?.remaining || 0}
                    prefix={<DollarOutlined />}
                    valueStyle={{ color: '#3f8600' }}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title={t('profile.credits.used')}
                    value={user?.credits_stats?.used || 0}
                    prefix={<DollarOutlined />}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </Col>
              </Row>
              <div className="usage-rate">
                <Text type="secondary">{t('profile.credits.usageRate')}: </Text>
                <Text strong>{user?.credits_stats?.usageRate || 0}%</Text>
              </div>
            </div>
          </Card>
        </Col>

        {/* 右侧 - 标签页 */}
        <Col xs={24} lg={16}>
          <Card>
            <Tabs defaultActiveKey="basic">
              <TabPane tab={t('profile.tabs.basic')} key="basic">
                <Form
                  form={profileForm}
                  layout="vertical"
                  onFinish={handleUpdateProfile}
                  initialValues={{
                    username: user?.username,
                    email: user?.email,
                    phone: user?.phone
                  }}
                >
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="username"
                        label={t('profile.form.username')}
                        rules={[
                          { required: true, message: t('profile.form.username.required') },
                          { pattern: /^[a-zA-Z0-9_-]{3,20}$/, message: t('profile.form.username.pattern') }
                        ]}
                      >
                        <Input prefix={<UserOutlined />} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="email"
                        label={t('profile.form.email')}
                      >
                        <Input prefix={<MailOutlined />} disabled />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="phone"
                        label={t('profile.form.phone')}
                        rules={[
                          { pattern: /^1[3-9]\d{9}$/, message: t('profile.form.phone.pattern') }
                        ]}
                      >
                        <Input prefix={<PhoneOutlined />} placeholder={t('profile.form.phone.placeholder')} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={loading} icon={<SaveOutlined />}>
                        {t('profile.form.save')}
                      </Button>
                      <Button icon={<LockOutlined />} onClick={() => setPasswordModalVisible(true)}>
                        {t('profile.changePassword')}
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              </TabPane>

              <TabPane tab={t('profile.tabs.creditHistory')} key="history">
                <Table
                  columns={creditHistoryColumns}
                  dataSource={creditHistory}
                  rowKey="id"
                  loading={historyLoading}
                  pagination={{
                    ...historyPagination,
                    onChange: (page) => loadCreditHistory(page),
                    showSizeChanger: false,
                    showTotal: (total) => t('table.total', { total })
                  }}
                />
              </TabPane>

              <TabPane tab={t('profile.tabs.permissions')} key="permissions">
                <div className="permissions-list">
                  {permissions.map((perm) => (
                    <Tag key={perm} color="blue" style={{ marginBottom: 8 }}>
                      {perm}
                    </Tag>
                  ))}
                </div>
              </TabPane>
            </Tabs>
          </Card>
        </Col>
      </Row>

      {/* 修改密码弹窗 - 需要验证原密码 */}
      <Modal
        title={t('profile.password.title')}
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false)
          passwordForm.resetFields()
        }}
        footer={null}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
        >
          {/* 原密码输入框 - 安全要求：修改密码必须验证原密码 */}
          <Form.Item
            name="oldPassword"
            label={t('profile.password.old')}
            rules={[
              { required: true, message: t('profile.password.old.required') }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder={t('profile.password.old.placeholder')} />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label={t('profile.password.new')}
            rules={[
              { required: true, message: t('profile.password.new.required') },
              { min: 6, message: t('profile.password.new.min') }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label={t('profile.password.confirm')}
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('profile.password.confirm.required') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('profile.password.confirm.mismatch')))
                }
              })
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {t('button.confirm')}
              </Button>
              <Button onClick={() => {
                setPasswordModalVisible(false)
                passwordForm.resetFields()
              }}>
                {t('button.cancel')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Profile
