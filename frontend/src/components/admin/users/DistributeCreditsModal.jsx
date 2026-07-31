/**
 * 组积分分配/回收弹窗组件
 * 
 * 更新记录：
 * - v1.1 (2026-07-29): 积分有效期管理功能
 *   * 新增"有效期管理"Tab：设为永不过期 / 指定过期日期 / 延长天数 三种操作
 *   * "积分操作"Tab顶部新增积分过期状态警示（过期时红色Alert提示）
 *   * 后端配套：分配积分给已过期用户时会自动清除有效期，此处同步展示提示
 * - v1.2 (2026-07-29): 权限一致性修复
 *   * "有效期管理"Tab仅超级管理员可见（后端 /credits/expire 路由为超管专属，
 *     组管理员提交会403，故前端直接隐藏该Tab避免体验割裂）
 *   * 新增 isSuperAdmin prop 由父组件传入
 */

import React, { useState } from 'react'
import { Modal, Form, InputNumber, Input, Alert, Space, Tag, Row, Col, Radio, Tabs, Timeline, Empty, Spin, Button, message } from 'antd'
import { 
  GiftOutlined, 
  WalletOutlined, 
  RollbackOutlined, 
  ClockCircleOutlined, 
  UserOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined
} from '@ant-design/icons'
import moment from 'moment'
import useAdminStore from '../../../stores/adminStore'

const { TabPane } = Tabs

const DistributeCreditsModal = ({
  visible,
  user,
  groupInfo,
  loading = false,
  onSubmit,
  onCancel,
  onExpireUpdated = null,  // v1.1新增：有效期变更成功后的回调（父组件刷新列表用）
  isSuperAdmin = false     // v1.2新增：是否超级管理员（控制有效期管理Tab可见性）
}) => {
  const [form] = Form.useForm()
  // v1.1新增：有效期管理独立表单，避免与积分操作表单字段冲突
  const [expireForm] = Form.useForm()
  const [operation, setOperation] = useState('distribute')
  const [activeTab, setActiveTab] = useState('operate')
  const [creditHistory, setCreditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // v1.1新增：有效期操作模式 permanent永不过期 / date指定日期 / extend延长天数
  const [expireMode, setExpireMode] = useState('permanent')
  // v1.1新增：有效期提交加载状态
  const [expireSubmitting, setExpireSubmitting] = useState(false)
  
  const { getUserCreditsHistory, setUserCreditsExpire } = useAdminStore()

  React.useEffect(() => {
    if (visible) {
      form.resetFields()
      expireForm.resetFields()
      setOperation('distribute')
      setActiveTab('operate')
      setExpireMode('permanent')
      // 加载积分历史
      if (user?.id) {
        loadCreditHistory()
      }
    }
  }, [visible, form, expireForm, user])

  // 加载积分历史
  const loadCreditHistory = async () => {
    if (!user?.id) return
    
    setHistoryLoading(true)
    try {
      const result = await getUserCreditsHistory(user.id, { 
        page: 1, 
        limit: 20,
        transaction_type: null 
      })
      setCreditHistory(result || [])
    } catch (error) {
      console.error('加载积分历史失败:', error)
      setCreditHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(user.id, values.amount, values.reason, operation)
      form.resetFields()
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  /**
   * v1.1新增：提交积分有效期变更
   * 按expireMode三选一组装请求体：
   * - permanent → { permanent: true }
   * - date      → { expire_date: 'YYYY-MM-DD' }
   * - extend    → { extend_days: N }
   */
  const handleExpireSubmit = async () => {
    try {
      const values = await expireForm.validateFields()
      
      const params = { reason: values.expire_reason || '管理员调整积分有效期' }
      
      if (expireMode === 'permanent') {
        params.permanent = true
      } else if (expireMode === 'date') {
        if (!values.expire_date) {
          message.error('请输入过期日期')
          return
        }
        params.expire_date = values.expire_date
      } else if (expireMode === 'extend') {
        if (!values.extend_days || values.extend_days <= 0) {
          message.error('请输入有效的延长天数')
          return
        }
        params.extend_days = values.extend_days
      }
      
      setExpireSubmitting(true)
      const result = await setUserCreditsExpire(user.id, params)
      
      message.success(result?.message || '积分有效期设置成功')
      expireForm.resetFields()
      
      // 通知父组件刷新用户列表（有效期/过期状态已变化）
      if (onExpireUpdated) {
        await onExpireUpdated()
      }
    } catch (error) {
      if (error?.errorFields) {
        // 表单校验错误，antd已展示提示，无需重复弹出
        console.error('有效期表单验证失败:', error)
      } else {
        message.error(error?.response?.data?.message || '设置积分有效期失败')
      }
    } finally {
      setExpireSubmitting(false)
    }
  }

  const poolRemaining = (groupInfo?.credits_pool || 0) - (groupInfo?.credits_pool_used || 0)
  const userAvailable = (user?.credits_quota || 0) - (user?.used_credits || 0)
  
  // v1.1新增：积分过期状态判断（依赖列表接口返回的credits_expire_at字段）
  const creditsExpireAt = user?.credits_expire_at || null
  const isCreditsExpired = !!(creditsExpireAt && moment(creditsExpireAt).isBefore(moment()))
  const creditsRemainingDays = creditsExpireAt 
    ? moment(creditsExpireAt).diff(moment(), 'days') 
    : null

  // 获取交易类型的显示文本和颜色
  const getTransactionTypeDisplay = (type) => {
    const typeMap = {
      'group_distribute': { text: '组积分分配', color: 'green' },
      'group_recycle': { text: '组积分回收', color: 'red' },
      'admin_add': { text: '管理员充值', color: 'green' },
      'admin_deduct': { text: '管理员扣减', color: 'red' },
      'admin_set': { text: '管理员设置', color: 'blue' },
      'chat_consume': { text: '对话消费', color: 'orange' },
      'api_consume': { text: 'API消费', color: 'purple' },
      'system_reward': { text: '系统奖励', color: 'green' }
    }
    return typeMap[type] || { text: type, color: 'default' }
  }

  /**
   * v1.1新增：渲染当前有效期状态标签（三态：永不过期/正常剩余N天/已过期）
   */
  const renderExpireStatusTag = () => {
    if (!creditsExpireAt) {
      return <Tag color="success" icon={<CheckCircleOutlined />}>永不过期</Tag>
    }
    if (isCreditsExpired) {
      return (
        <Space>
          <Tag color="error" icon={<ClockCircleOutlined />}>已过期</Tag>
          <span style={{ color: '#999', fontSize: 12 }}>
            {moment(creditsExpireAt).format('YYYY-MM-DD HH:mm')}
          </span>
        </Space>
      )
    }
    return (
      <Space>
        <Tag color={creditsRemainingDays <= 7 ? 'warning' : 'processing'} icon={<CalendarOutlined />}>
          剩余{creditsRemainingDays}天
        </Tag>
        <span style={{ color: '#999', fontSize: 12 }}>
          {moment(creditsExpireAt).format('YYYY-MM-DD HH:mm')}
        </span>
      </Space>
    )
  }

  return (
    <Modal
      title={
        <Space>
          <WalletOutlined />
          积分管理 - {user?.username}
        </Space>
      }
      open={visible}
      onOk={activeTab === 'operate' ? handleSubmit : undefined}
      onCancel={onCancel}
      confirmLoading={loading}
      okText={activeTab === 'operate' ? (operation === 'distribute' ? '确定分配' : '确定扣减') : undefined}
      cancelText="关闭"
      width={700}
      footer={activeTab !== 'operate' ? null : undefined}
    >
      {user && groupInfo && (
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="积分操作" key="operate">
            {/* v1.1新增：积分已过期强警示（提示分配时会自动清除有效期） */}
            {isCreditsExpired && (
              <Alert
                message="该用户积分已过期"
                description={
                  <span>
                    过期时间：{moment(creditsExpireAt).format('YYYY-MM-DD HH:mm')}，
                    过期后剩余积分不可用。<strong>现在分配积分将自动清除过期有效期（变为永不过期）</strong>，
                    分配后的积分立即可用。
                    {isSuperAdmin && '也可以到"有效期管理"Tab手动调整有效期。'}
                  </span>
                }
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Form form={form} layout="vertical">
              <Form.Item label="操作类型" required>
                <Radio.Group value={operation} onChange={(e) => {
                  setOperation(e.target.value)
                  form.setFieldValue('amount', undefined)
                }}>
                  <Radio.Button value="distribute">
                    <Space>
                      <GiftOutlined />
                      分配积分
                    </Space>
                  </Radio.Button>
                  <Radio.Button value="recycle">
                    <Space>
                      <RollbackOutlined />
                      扣减积分
                    </Space>
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Form>

            <Alert
              message={operation === 'distribute' ? '从组积分池分配' : '扣减到组积分池'}
              description={
                operation === 'distribute' 
                  ? '您正在从组积分池中分配积分给用户，分配后将直接增加到用户的积分余额中。'
                  : '您正在从用户扣减积分到组积分池，扣减后积分将返回到组积分池供后续分配。'
              }
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
            
            <div style={{ marginBottom: 24, padding: '16px', background: '#f5f5f5', borderRadius: '8px' }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#666', fontSize: '12px', marginBottom: 8 }}>
                      <WalletOutlined /> 组积分池剩余
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: poolRemaining > 0 ? '#52c41a' : '#ff4d4f' }}>
                      {poolRemaining.toLocaleString()}
                    </div>
                    <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>积分</div>
                  </div>
                </Col>
                <Col span={12}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#666', fontSize: '12px', marginBottom: 8 }}>
                      用户当前积分
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: isCreditsExpired ? '#ff4d4f' : undefined }}>
                      {userAvailable.toLocaleString()}
                    </div>
                    <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>
                      {isCreditsExpired ? '积分（已过期不可用）' : '积分'}
                    </div>
                  </div>
                </Col>
              </Row>
            </div>

            <Form form={form} layout="vertical">
              <Form.Item
                name="amount"
                label={operation === 'distribute' ? '分配数量' : '扣减数量'}
                rules={[
                  { required: true, message: `请输入${operation === 'distribute' ? '分配' : '扣减'}数量` },
                  { type: 'number', min: 1, message: `${operation === 'distribute' ? '分配' : '扣减'}数量必须大于0` },
                  operation === 'distribute' 
                    ? { type: 'number', max: poolRemaining, message: `不能超过积分池剩余(${poolRemaining})` }
                    : { type: 'number', max: userAvailable, message: `不能超过用户可用余额(${userAvailable})` }
                ]}
              >
                <InputNumber
                  min={1}
                  max={operation === 'distribute' ? poolRemaining : userAvailable}
                  style={{ width: '100%' }}
                  placeholder={`请输入${operation === 'distribute' ? '分配' : '扣减'}积分数量`}
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                />
              </Form.Item>

              <Form.Item
                name="reason"
                label={operation === 'distribute' ? '分配原因' : '扣减原因'}
                rules={[
                  { required: true, message: `请输入${operation === 'distribute' ? '分配' : '扣减'}原因` },
                  { max: 200, message: `${operation === 'distribute' ? '分配' : '扣减'}原因不能超过200个字符` }
                ]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder={
                    operation === 'distribute' 
                      ? '请输入分配原因，如：项目奖励、任务完成等'
                      : '请输入扣减原因，如：分配错误、积分调整等'
                  }
                  maxLength={200}
                  showCount
                />
              </Form.Item>
            </Form>

            {operation === 'distribute' && user.role !== 'user' && (
              <Alert
                message="提示"
                description={`${user.username} 是${user.role === 'admin' ? '组管理员' : '超级管理员'}，请确认是否分配积分。`}
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
              />
            )}

            {operation === 'recycle' && (
              <Alert
                message="注意"
                description="扣减的积分将返回到组积分池，可用于后续重新分配给其他用户。"
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
              />
            )}
          </TabPane>

          {/* v1.1新增：有效期管理Tab
              v1.2修改：仅超级管理员可见（后端/credits/expire路由为超管专属canManageCredits） */}
          {isSuperAdmin && (
            <TabPane 
              tab={
                <Space size={4}>
                  <FieldTimeOutlined />
                  有效期管理
                </Space>
              } 
              key="expire"
            >
              {/* 当前有效期状态 */}
              <div style={{ marginBottom: 20, padding: '16px', background: '#f5f5f5', borderRadius: '8px' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div style={{ color: '#666', fontSize: '13px' }}>
                    <CalendarOutlined /> 当前积分有效期状态
                  </div>
                  <div>{renderExpireStatusTag()}</div>
                </Space>
              </div>

              <Alert
                message="积分有效期说明"
                description={
                  <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                    <li>积分有效期到期后，未用完的积分将不可用</li>
                    <li>设为"永不过期"可清除有效期限制（推荐）</li>
                    <li>"延长天数"在现有有效期基础上延长；若已过期则从今天起算</li>
                    <li>所有变更会记录到积分历史中，可随时追溯</li>
                  </ul>
                }
                type="info"
                showIcon
                style={{ marginBottom: 20 }}
              />

              {/* 操作模式选择 */}
              <Form form={expireForm} layout="vertical">
                <Form.Item label="操作方式" required>
                  <Radio.Group 
                    value={expireMode} 
                    onChange={(e) => {
                      setExpireMode(e.target.value)
                      // 切换模式时清空模式专属字段，避免脏数据误提交
                      expireForm.setFieldsValue({ expire_date: undefined, extend_days: undefined })
                    }}
                  >
                    <Radio.Button value="permanent">
                      <Space size={4}>
                        <CheckCircleOutlined />
                        设为永不过期
                      </Space>
                    </Radio.Button>
                    <Radio.Button value="date">
                      <Space size={4}>
                        <CalendarOutlined />
                        指定过期日期
                      </Space>
                    </Radio.Button>
                    <Radio.Button value="extend">
                      <Space size={4}>
                        <FieldTimeOutlined />
                        延长天数
                      </Space>
                    </Radio.Button>
                  </Radio.Group>
                </Form.Item>

                {/* 指定日期模式：文本输入YYYY-MM-DD（与账号有效期设置风格保持一致） */}
                {expireMode === 'date' && (
                  <Form.Item
                    name="expire_date"
                    label="过期日期"
                    extra="格式：YYYY-MM-DD，例如 2027-12-31，当天 23:59 前有效"
                    rules={[
                      { required: true, message: '请输入过期日期' },
                      {
                        validator: (_, value) => {
                          if (!value) return Promise.resolve()
                          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                            return Promise.reject(new Error('日期格式必须为 YYYY-MM-DD'))
                          }
                          const inputDate = moment(value, 'YYYY-MM-DD', true)
                          if (!inputDate.isValid()) {
                            return Promise.reject(new Error('无效的日期'))
                          }
                          if (inputDate.isBefore(moment(), 'day')) {
                            return Promise.reject(new Error('过期日期不能早于今天'))
                          }
                          return Promise.resolve()
                        }
                      }
                    ]}
                  >
                    <Input placeholder="例如：2027-12-31" style={{ width: '100%' }} />
                  </Form.Item>
                )}

                {/* 延长天数模式 */}
                {expireMode === 'extend' && (
                  <Form.Item
                    name="extend_days"
                    label="延长天数"
                    extra={
                      isCreditsExpired 
                        ? '当前积分已过期，将从今天起重新计算有效期' 
                        : creditsExpireAt 
                          ? `在现有到期时间（${moment(creditsExpireAt).format('YYYY-MM-DD')}）基础上延长`
                          : '当前为永不过期，延长天数将从今天起设置新的有效期'
                    }
                    rules={[
                      { required: true, message: '请输入延长天数' },
                      { type: 'number', min: 1, max: 3650, message: '延长天数范围 1-3650 天' }
                    ]}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={1}
                      max={3650}
                      placeholder="输入要延长的天数，如 365"
                    />
                  </Form.Item>
                )}

                {/* 永不过期模式：确认提示 */}
                {expireMode === 'permanent' && (
                  <Alert
                    message={
                      creditsExpireAt 
                        ? '将清除该用户的积分有效期，积分变为永久可用（受账号有效期约束）' 
                        : '该用户积分当前已是永不过期状态，无需重复设置'
                    }
                    type={creditsExpireAt ? 'warning' : 'success'}
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Form.Item
                  name="expire_reason"
                  label="操作原因"
                  rules={[{ max: 200, message: '操作原因不能超过200个字符' }]}
                >
                  <Input.TextArea
                    rows={2}
                    placeholder="选填，如：客户续费、活动延期等（默认：管理员调整积分有效期）"
                    maxLength={200}
                    showCount
                  />
                </Form.Item>

                <Form.Item style={{ marginBottom: 0 }}>
                  <Button 
                    type="primary" 
                    onClick={handleExpireSubmit}
                    loading={expireSubmitting}
                    disabled={expireMode === 'permanent' && !creditsExpireAt}
                    block
                  >
                    {expireMode === 'permanent' ? '确认设为永不过期' 
                      : expireMode === 'date' ? '确认设置过期日期' 
                      : '确认延长有效期'}
                  </Button>
                </Form.Item>
              </Form>
            </TabPane>
          )}

          <TabPane tab="积分历史" key="history">
            <div style={{ marginBottom: 16 }}>
              <Alert
                message="积分交易历史"
                description="显示该用户最近的积分交易记录，包括组积分池分配、回收以及其他积分变动。"
                type="info"
                showIcon
              />
            </div>

            <Spin spinning={historyLoading}>
              {creditHistory.length > 0 ? (
                <Timeline style={{ marginTop: 24 }}>
                  {creditHistory.map((record) => {
                    const typeInfo = getTransactionTypeDisplay(record.transaction_type)
                    return (
                      <Timeline.Item 
                        key={record.id}
                        color={record.amount > 0 ? 'green' : 'red'}
                        dot={<ClockCircleOutlined />}
                      >
                        <div>
                          <strong>{moment(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</strong>
                        </div>
                        <div>
                          <Tag color={typeInfo.color}>
                            {typeInfo.text}
                          </Tag>
                          <Tag color={record.amount > 0 ? 'green' : 'red'}>
                            {record.amount > 0 ? '+' : ''}{record.amount.toLocaleString()}
                          </Tag>
                          <span style={{ marginLeft: 8 }}>{record.description}</span>
                        </div>
                        {record.operator_name && (
                          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                            <UserOutlined /> 操作人: {record.operator_name}
                          </div>
                        )}
                        {record.distributor_name && (
                          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                            <UserOutlined /> 分配人: {record.distributor_name}
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: '#999' }}>
                          余额: {record.balance_after.toLocaleString()}
                        </div>
                      </Timeline.Item>
                    )
                  })}
                </Timeline>
              ) : (
                <Empty description="暂无积分交易记录" />
              )}
            </Spin>
          </TabPane>
        </Tabs>
      )}
    </Modal>
  )
}

export default DistributeCreditsModal
