/**
 * 个人中心页面
 *
 * 功能：
 * 1. 基本信息展示与编辑（用户名/手机号）
 * 2. 修改密码（必须验证原密码）
 * 3. 积分统计与历史查询
 * 4. 权限列表展示
 *
 * 安全说明：即使用户已通过 JWT 认证，修改密码仍需验证原密码，
 *          防止 token 被盗后攻击者永久接管账号。
 *
 * ── 本次国际化修复要点（为什么这样写）──
 * 1. 补齐两个缺失键：
 *    - profile.password.old.placeholder 此前语言包两侧均无此键且 t() 未传兜底，
 *      导致输入框 placeholder 在中英文环境都直接显示键名字符串，是可见 Bug；
 *    - profile.password.oldPasswordWrong 同样缺失。
 *    注：该键与 profile.password.old 构成"前缀-延伸"关系，i18next 的 deepFind
 *    会先用完整字符串键命中扁平语言包，故不会被 profile.password.old 截断，
 *    这与既有的 profile.password.old.required 是同一模式。
 * 2. 强密码校验的 4 个规则项、整句错误模板、常驻规则提示原为硬编码中文，
 *    且规则项拼接用了中文顿号"、"（CJK 标点，只查汉字的正则扫不到），
 *    现全部走 i18n：规则项独立成键，连接符走 rule.separator（中"、"/英", "），
 *    整句用 strongRuleMissing 插值（中英语序不同，不可在 JS 里分段拼接）。
 * 3. 后端 errors 数组的拼接分隔符原为全角分号"；"，改走 profile.errorSeparator。
 * 4. 密码位数由模块常量统一提供并以 {{min}} 插值传入文案，
 *    避免"常量改了但文案里的数字没改"的不一致。
 * 5. 时间列与注册时间的 toLocale*String 原未传 locale，英文环境仍按浏览器
 *    默认区域输出，现统一传 i18n.language。
 * 6. console.error 改为英文：开发者日志与界面文案职责分离，不进语言包。
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
import IdentityAccountLinkPanel from '../../components/auth/IdentityAccountLinkPanel'

const { Title, Text } = Typography
const { TabPane } = Tabs

/**
 * 密码长度下限常量
 * 与后端 AuthControllerRefactored._validateSuperAdminPassword 保持一致：
 * 超级管理员 ≥8 位且含大小写与数字，其余角色仅 ≥6 位。
 * 抽为常量后作为 {{min}} 插值传入文案，防止两处数字不同步。
 */
const PASSWORD_MIN_LENGTH_SUPER_ADMIN = 8
const PASSWORD_MIN_LENGTH_NORMAL = 6

/** 积分历史每页条数 */
const CREDIT_HISTORY_PAGE_SIZE = 10

const Profile = () => {
  // i18n 一并取出，供 toLocale*String 传入当前语言使用
  const { t, i18n } = useTranslation()
  const { user, permissions, updateProfile, changePassword, getCreditHistory } = useAuthStore()
  const [profileForm] = Form.useForm()
  const [passwordForm] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [creditHistory, setCreditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPagination, setHistoryPagination] = useState({
    current: 1,
    pageSize: CREDIT_HISTORY_PAGE_SIZE,
    total: 0
  })

  // 是否超级管理员：决定改密码是否走强密码规则（与后端校验规则保持一致）
  const isSuperAdmin = user?.role === 'super_admin'

  /**
   * 角色显示配置
   * 定义在组件内而非模块级：模块级常量在文件加载时求值一次，
   * 语言切换后不会重算，会固化为首次加载时的语言。
   * 放在渲染期构建可天然跟随语言切换。
   * 注意 role.admin 的实际生效值来自 admin.json（"组管理员"/"Group Admin"），
   * 因 index.js 中 admin 在 common 之后展开会覆盖同名键，此为预期行为。
   */
  const roleConfig = {
    'super_admin': { name: t('role.super_admin'), color: 'red' },
    'admin': { name: t('role.admin'), color: 'blue' },
    'user': { name: t('role.user'), color: 'green' }
  }

  /**
   * 把后端返回的 errors 数组拼成单行提示
   * 分隔符走 i18n（中文全角"；" / 英文"; "），标点属译文的一部分。
   */
  const formatServerErrors = (errors) => {
    return Array.isArray(errors) ? errors.join(t('profile.errorSeparator')) : errors
  }

  /**
   * 超级管理员强密码前端校验（与后端规则一致：≥8位+大写+小写+数字）
   *
   * 一次性收集所有未满足项，给出"完整要求 + 当前缺少哪些"，避免用户逐条试错。
   * 各规则项与连接符均取自语言包：连接符在中文为顿号、英文为逗号加空格，
   * 若在此处硬编码 join('、') 会在英文环境露出 CJK 标点。
   * 返回 Promise.resolve() 视为通过，否则 reject 完整错误文案。
   */
  const validateSuperAdminPassword = (_, value) => {
    // 空值交给 required 规则处理，这里只在有值时校验强度
    if (!value) {
      return Promise.resolve()
    }

    const missing = []
    if (value.length < PASSWORD_MIN_LENGTH_SUPER_ADMIN) {
      missing.push(t('profile.password.rule.minLength', { min: PASSWORD_MIN_LENGTH_SUPER_ADMIN }))
    }
    if (!/[A-Z]/.test(value)) {
      missing.push(t('profile.password.rule.uppercase'))
    }
    if (!/[a-z]/.test(value)) {
      missing.push(t('profile.password.rule.lowercase'))
    }
    if (!/[0-9]/.test(value)) {
      missing.push(t('profile.password.rule.digit'))
    }

    if (missing.length === 0) {
      return Promise.resolve()
    }

    // 整句插值：中英文的"要求描述 + 缺少项"语序不同，必须交给语言包组织
    return Promise.reject(
      new Error(
        t('profile.password.strongRuleMissing', {
          min: PASSWORD_MIN_LENGTH_SUPER_ADMIN,
          missing: missing.join(t('profile.password.rule.separator'))
        })
      )
    )
  }

  // 新密码校验规则：超管走强密码自定义校验，其他角色保持长度下限
  const newPasswordRules = [
    { required: true, message: t('profile.password.new.required') },
    isSuperAdmin
      ? { validator: validateSuperAdminPassword }
      : {
          min: PASSWORD_MIN_LENGTH_NORMAL,
          message: t('profile.password.new.min', { min: PASSWORD_MIN_LENGTH_NORMAL })
        }
  ]

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
      const result = await getCreditHistory(page, CREDIT_HISTORY_PAGE_SIZE)
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
        // 后端字段校验错误：原样展示（后端文案恒为中文，属服务端职责）
        message.error(formatServerErrors(error.response.data.data.errors))
      } else {
        message.error(error.response?.data?.message || t('profile.update.failed'))
      }
      console.error('Failed to update profile:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 修改密码 - 必须验证原密码
   *
   * 原密码由后端 bcrypt.compare 校验，401 表示原密码错误，单独给出提示。
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
        message.error(formatServerErrors(error.response.data.data.errors))
      } else if (error.response?.status === 401) {
        // 原密码错误
        message.error(error.response?.data?.message || t('profile.password.oldPasswordWrong'))
      } else {
        message.error(error.response?.data?.message || t('profile.password.changeFailed'))
      }
      console.error('Failed to change password:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 积分历史表格列
   *
   * 定义在渲染期而非 useMemo：内部含 t() 与 i18n.language，
   * 若用 useMemo 缓存则必须把 t 加入依赖，否则语言切换后列头与
   * 时间格式不刷新。此处数据量小，直接每次渲染重建更简单可靠。
   */
  const creditHistoryColumns = [
    {
      title: t('profile.creditHistory.time'),
      dataIndex: 'created_at',
      key: 'created_at',
      // 必须传 i18n.language，否则英文环境仍按浏览器默认区域格式化
      render: (text) => (text ? new Date(text).toLocaleString(i18n.language) : t('profile.unknown'))
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
        // 未收录的交易类型直接展示原始枚举值（技术标识，不翻译）
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
                {/* created_at 缺失时不可直接 new Date(undefined)，会渲染出 Invalid Date */}
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString(i18n.language)
                  : t('profile.unknown')}
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

              <TabPane
                tab={t(
                  'profile.tabs.identity',
                  {
                    defaultValue:
                      '统一身份'
                  }
                )}
                key="identity"
              >
                <IdentityAccountLinkPanel />
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
                    // 第二参数为插值对象而非中文兜底，写法正确
                    showTotal: (total) => t('table.total', { total })
                  }}
                />
              </TabPane>

              <TabPane tab={t('profile.tabs.permissions')} key="permissions">
                <div className="permissions-list">
                  {/* 权限标识为技术枚举值（如 user.manage），不翻译 */}
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
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('profile.password.old.placeholder')}
            />
          </Form.Item>

          {/* 新密码输入框
              - 超级管理员：走强密码校验（≥8位+大小写+数字），框下常驻规则提示
              - 其他角色：保持长度下限规则
              extra 文案走 i18n 并以 {{min}} 插值，与校验用的常量同源 */}
          <Form.Item
            name="newPassword"
            label={t('profile.password.new')}
            rules={newPasswordRules}
            extra={
              isSuperAdmin
                ? t('profile.password.strongRule', { min: PASSWORD_MIN_LENGTH_SUPER_ADMIN })
                : null
            }
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
