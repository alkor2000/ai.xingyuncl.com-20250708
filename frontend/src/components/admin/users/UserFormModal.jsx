/**
 * 用户表单弹窗组件（创建/编辑用户）- 包含账号有效期管理和UUID显示
 */

import React, { useEffect, useState } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Select, 
  InputNumber, 
  Row, 
  Col, 
  Tabs, 
  Space, 
  Button,
  DatePicker,
  Tooltip,
  Alert,
  Divider
} from 'antd'
import { 
  ExclamationCircleOutlined,
  FileTextOutlined,
  CalendarOutlined,
  UserOutlined,
  KeyOutlined,
  MailOutlined,
  CopyOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'
import useSystemConfigStore from '../../../stores/systemConfigStore'
import { formatDate, dateValidator, isValidDate } from '../../../utils/dateFormat'
import { message } from 'antd'

const { TabPane } = Tabs
const { TextArea } = Input

const UserFormModal = ({
  visible,
  editingUser,
  userGroups = [],
  currentUser = {},
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState('basic')
  const { systemConfig } = useSystemConfigStore()
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  
  const isGroupAdmin = currentUser?.role === 'admin'
  const isSuperAdmin = currentUser?.role === 'super_admin'
  
  // 获取系统配置的默认值
  const defaultTokens = systemConfig?.user?.default_tokens || 10000
  const defaultCredits = systemConfig?.user?.default_credits || 1000
  
  // 获取当前组信息（组管理员）或选中的组信息
  const getCurrentGroupInfo = () => {
    if (isGroupAdmin) {
      return userGroups.find(g => g.id === currentUser.group_id)
    }
    const groupId = selectedGroupId || editingUser?.group_id
    if (!groupId) return null
    return userGroups.find(g => g.id === groupId)
  }
  
  // 验证日期是否在组有效期内
  const validateExpireDate = (_, value) => {
    if (!value) return Promise.resolve()
    
    // 先验证日期是否有效
    if (!isValidDate(value)) {
      return Promise.resolve() // 日期格式验证会处理无效日期
    }
    
    const groupInfo = getCurrentGroupInfo()
    if (!groupInfo?.expire_date) return Promise.resolve()
    
    // 将输入的日期字符串转换为日期对象进行比较
    const inputDate = moment(value, 'YYYY-MM-DD', true)
    const groupExpireDate = moment(groupInfo.expire_date, 'YYYY-MM-DD', true)
    
    // 再次检查moment对象是否有效
    if (!inputDate.isValid() || !groupExpireDate.isValid()) {
      return Promise.resolve()
    }
    
    if (inputDate.isAfter(groupExpireDate)) {
      return Promise.reject(new Error(`有效期不能超过组有效期 ${formatDate(groupInfo.expire_date)}`))
    }
    
    return Promise.resolve()
  }
  
  // 监听分组选择变化
  const handleGroupChange = (groupId) => {
    setSelectedGroupId(groupId)
    
    // 如果选择的分组有有效期设置，同步到账号有效期
    if (groupId && !editingUser) {
      const selectedGroup = userGroups.find(g => g.id === groupId)
      if (selectedGroup?.expire_date) {
        form.setFieldValue('expire_at', formatDate(selectedGroup.expire_date))
      }
    }
  }
  
  // 复制UUID到剪贴板
  const handleCopyUUID = () => {
    if (editingUser?.uuid) {
      navigator.clipboard.writeText(editingUser.uuid)
        .then(() => {
          message.success('UUID已复制到剪贴板')
        })
        .catch(() => {
          message.error('复制失败，请手动复制')
        })
    }
  }
  
  // 每次打开时重置到基本信息Tab
  useEffect(() => {
    if (visible) {
      setActiveKey('basic')
      // 如果是新建用户，设置默认值
      if (!editingUser && !isGroupAdmin) {
        form.setFieldsValue({
          token_quota: defaultTokens,
          credits_quota: defaultCredits
        })
      }
    }
  }, [visible, editingUser, isGroupAdmin, defaultTokens, defaultCredits, form])
  
  // 检查是否可以编辑备注
  const canEditRemark = (user) => {
    if (isSuperAdmin) return true
    if (isGroupAdmin && currentUser.group_id === user?.group_id) return true
    return false
  }

  // 检查是否可以设置有效期
  const canSetExpireDate = () => {
    if (isSuperAdmin) return true
    if (isGroupAdmin) {
      // 组管理员只能编辑本组用户
      if (editingUser && editingUser.group_id !== currentUser.group_id) return false
      // 组管理员不能设置超级管理员的有效期
      if (editingUser?.role === 'super_admin') return false
      return true
    }
    return false
  }

  // 检查是否可以编辑邮箱（只有超级管理员可以）
  const canEditEmail = () => {
    return isSuperAdmin
  }

  // 检查是否可以编辑用户名（超级管理员可以编辑所有，组管理员不能编辑）
  const canEditUsername = () => {
    if (isSuperAdmin) return true
    return false
  }

  return (
    <Modal
      title={editingUser ? t('admin.users.editUser') : t('admin.users.createUser')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={800}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Tabs activeKey={activeKey} onChange={setActiveKey}>
          <TabPane tab={t('admin.users.tabs.basic')} key="basic">
            {/* UUID显示（编辑时显示，只读） */}
            {editingUser && editingUser.uuid && (
              <Form.Item
                label={
                  <Space>
                    <KeyOutlined />
                    <span>UUID (用户唯一标识)</span>
                  </Space>
                }
              >
                <Input.Group compact>
                  <Input
                    value={editingUser.uuid}
                    disabled
                    style={{ width: 'calc(100% - 32px)', fontFamily: 'monospace' }}
                    prefix={
                      <Tooltip title={editingUser.uuid_source === 'sso' ? 'SSO用户' : '系统用户'}>
                        <UserOutlined style={{ color: editingUser.uuid_source === 'sso' ? '#1890ff' : '#52c41a' }} />
                      </Tooltip>
                    }
                  />
                  <Tooltip title="复制UUID">
                    <Button 
                      icon={<CopyOutlined />} 
                      onClick={handleCopyUUID}
                    />
                  </Tooltip>
                </Input.Group>
                <div style={{ marginTop: 4, fontSize: '12px', color: '#999' }}>
                  {editingUser.uuid_source === 'sso' 
                    ? '此用户通过SSO单点登录创建，UUID由外部系统提供' 
                    : '系统自动生成的唯一标识，不可修改'}
                </div>
              </Form.Item>
            )}

            {/* 邮箱字段：创建时必填，编辑时超级管理员可修改 */}
            {(!editingUser || canEditEmail()) && (
              <Form.Item
                name="email"
                label={
                  <Space>
                    <MailOutlined />
                    {t('admin.users.form.email')}
                  </Space>
                }
                rules={[
                  { required: !editingUser, message: t('admin.users.form.email.required') },
                  { type: 'email', message: t('admin.users.form.email.invalid') }
                ]}
                extra={editingUser && isSuperAdmin ? '修改邮箱后，用户需使用新邮箱登录' : null}
              >
                <Input 
                  placeholder={t('admin.users.form.email.required')} 
                  disabled={editingUser && !canEditEmail()}
                />
              </Form.Item>
            )}

            {/* 显示当前邮箱（组管理员查看） */}
            {editingUser && !canEditEmail() && (
              <Form.Item
                label={
                  <Space>
                    <MailOutlined />
                    {t('admin.users.form.email')}
                  </Space>
                }
              >
                <Input 
                  value={editingUser.email}
                  disabled
                  style={{ color: '#000' }}
                />
              </Form.Item>
            )}

            {/* 密码字段（仅创建时显示） */}
            {!editingUser && (
              <Form.Item
                name="password"
                label={t('admin.users.form.password')}
                rules={[
                  { required: true, message: t('admin.users.form.password.required') },
                  { min: 6, message: t('admin.users.form.password.min') }
                ]}
              >
                <Input.Password placeholder={t('admin.users.form.password.required')} />
              </Form.Item>
            )}

            {/* 用户名字段 */}
            <Form.Item
              name="username"
              label={t('admin.users.form.username')}
              rules={[{ required: true, message: t('admin.users.form.username.required') }]}
              extra={editingUser && canEditUsername() ? '修改用户名后，用户可使用新用户名登录' : null}
            >
              <Input 
                placeholder={t('admin.users.form.username.required')} 
                disabled={editingUser && !canEditUsername()} 
              />
            </Form.Item>

            {!isGroupAdmin && (
              <Form.Item
                name="role"
                label={t('admin.users.form.role')}
                rules={[{ required: true, message: t('admin.users.form.role.required') }]}
                initialValue="user"
              >
                <Select placeholder={t('admin.users.form.role.required')}>
                  <Select.Option value="user">{t('role.user')}</Select.Option>
                  {isSuperAdmin && (
                    <>
                      <Select.Option value="admin">{t('role.admin')}</Select.Option>
                      <Select.Option value="super_admin">{t('role.super_admin')}</Select.Option>
                    </>
                  )}
                </Select>
              </Form.Item>
            )}

            {!isGroupAdmin && (
              <Form.Item
                name="group_id"
                label={t('admin.users.form.group')}
              >
                <Select 
                  placeholder={t('admin.users.form.group.placeholder')} 
                  allowClear
                  onChange={handleGroupChange}
                >
                  {userGroups.filter(g => g.is_active).map(group => (
                    <Select.Option key={group.id} value={group.id}>
                      <Space>
                        <span style={{ color: group.color }}>{group.name}</span>
                        {group.expire_date && (
                          <span style={{ fontSize: '12px', color: '#999' }}>
                            (有效期: {formatDate(group.expire_date)})
                          </span>
                        )}
                      </Space>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Form.Item
              name="status"
              label={t('admin.users.form.status')}
              initialValue="active"
            >
              <Select>
                <Select.Option value="active">{t('status.active')}</Select.Option>
                <Select.Option value="inactive">{t('status.inactive')}</Select.Option>
              </Select>
            </Form.Item>

            {(editingUser ? canEditRemark(editingUser) : true) && (
              <Form.Item
                name="remark"
                label={
                  <Space>
                    <FileTextOutlined />
                    {t('admin.users.form.remark')}
                  </Space>
                }
                help={t('admin.users.form.remark.help')}
              >
                <TextArea
                  rows={3}
                  placeholder={t('admin.users.form.remark.placeholder')}
                  maxLength={500}
                  showCount
                />
              </Form.Item>
            )}

            {!isGroupAdmin && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="token_quota"
                    label={t('admin.users.form.tokenQuota')}
                    rules={[{ required: true, message: t('admin.users.form.tokenQuota.required') }]}
                  >
                    <InputNumber 
                      placeholder={t('admin.users.form.tokenQuota')}
                      min={0}
                      style={{ width: '100%' }}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="credits_quota"
                    label={t('admin.users.form.creditsQuota')}
                    rules={[{ required: true, message: t('admin.users.form.creditsQuota.required') }]}
                  >
                    <InputNumber 
                      placeholder={t('admin.users.form.creditsQuota')}
                      min={0}
                      style={{ width: '100%' }}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </TabPane>

          {editingUser && (
            <TabPane tab={t('admin.users.tabs.password')} key="password">
              <Alert
                message={t('admin.users.password.resetWarning')}
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
              
              <Form.Item
                name="newPassword"
                label={t('admin.users.password.new')}
                rules={[
                  { min: 6, message: t('admin.users.password.min')} 
                ]}
              >
                <Input.Password placeholder={t('admin.users.password.newPlaceholder')} />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label={t('admin.users.password.confirm')}
                dependencies={['newPassword']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!getFieldValue('newPassword')) {
                        return Promise.resolve()
                      }
                      if (!value || getFieldValue('newPassword') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error(t('admin.users.password.mismatch')))
                    }
                  })
                ]}
              >
                <Input.Password placeholder={t('admin.users.password.confirmPlaceholder')} />
              </Form.Item>
            </TabPane>
          )}

          {/* 账号有效期Tab（编辑时）- 组管理员和超管都可见 */}
          {editingUser && canSetExpireDate() && (
            <TabPane tab="账号有效期" key="account">
              <Alert
                message="账号有效期说明"
                description={
                  <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                    <li>设置账号有效期后，到期时账号将无法登录</li>
                    {isGroupAdmin && <li>用户有效期不能超过组有效期限制</li>}
                    <li>超级管理员账号不受有效期限制</li>
                    <li>可以随时延长或修改有效期</li>
                    <li>清除有效期将使账号永久有效</li>
                  </ul>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              {/* 组有效期信息 */}
              {isGroupAdmin && getCurrentGroupInfo()?.expire_date && (
                <Alert
                  message={`本组有效期至: ${formatDate(getCurrentGroupInfo().expire_date)}`}
                  type="warning"
                  style={{ marginBottom: 16 }}
                />
              )}

              {/* 当前状态 */}
              {editingUser.expire_at && (
                <Alert
                  message={`当前有效期: ${formatDate(editingUser.expire_at)}`}
                  type="warning"
                  style={{ marginBottom: 16 }}
                />
              )}

              <Form.Item
                name="expire_at"
                label="设置账号有效期"
                extra={
                  getCurrentGroupInfo()?.expire_date 
                    ? `最大可设置至: ${formatDate(getCurrentGroupInfo().expire_date)}` 
                    : "留空表示永久有效，格式：YYYY-MM-DD"
                }
                rules={[
                  dateValidator(),
                  { validator: validateExpireDate }
                ]}
              >
                <Input 
                  placeholder="例如：2025-12-31" 
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="extend_days"
                label="延长有效期天数"
                extra="从当前有效期基础上延长指定天数"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={3650}
                  placeholder="输入要延长的天数"
                />
              </Form.Item>
            </TabPane>
          )}
        </Tabs>

        <Form.Item style={{ marginTop: 24 }}>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingUser ? t('button.update') : t('button.create')}
            </Button>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default UserFormModal
