/**
 * 组积分分配/回收弹窗组件
 */

import React, { useState, useEffect } from 'react'
import { Modal, Form, InputNumber, Input, Alert, Space, Tag, Row, Col, Radio, Tabs, Timeline, Empty, Spin } from 'antd'
import { GiftOutlined, WalletOutlined, RollbackOutlined, ClockCircleOutlined, UserOutlined } from '@ant-design/icons'
import moment from 'moment'
import useAdminStore from '../../../stores/adminStore'

const { TabPane } = Tabs

const DistributeCreditsModal = ({
  visible,
  user,
  groupInfo,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()
  const [operation, setOperation] = useState('distribute')
  const [activeTab, setActiveTab] = useState('operate')
  const [creditHistory, setCreditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  
  const { getUserCreditsHistory } = useAdminStore()

  React.useEffect(() => {
    if (visible) {
      form.resetFields()
      setOperation('distribute')
      setActiveTab('operate')
      // 加载积分历史
      if (user?.id) {
        loadCreditHistory()
      }
    }
  }, [visible, form, user])

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

  const poolRemaining = (groupInfo?.credits_pool || 0) - (groupInfo?.credits_pool_used || 0)
  const userAvailable = (user?.credits_quota || 0) - (user?.used_credits || 0)

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
      footer={activeTab === 'history' ? null : undefined}
    >
      {user && groupInfo && (
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="积分操作" key="operate">
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
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                      {userAvailable.toLocaleString()}
                    </div>
                    <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>积分</div>
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
