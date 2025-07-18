/**
 * 组积分分配弹窗组件
 */

import React from 'react'
import { Modal, Form, InputNumber, Input, Alert, Space, Tag, Row, Col } from 'antd'
import { GiftOutlined, WalletOutlined } from '@ant-design/icons'

const DistributeCreditsModal = ({
  visible,
  user,
  groupInfo,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()

  React.useEffect(() => {
    if (visible) {
      form.resetFields()
    }
  }, [visible, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(user.id, values.amount, values.reason)
      form.resetFields()
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  const poolRemaining = (groupInfo?.credits_pool || 0) - (groupInfo?.credits_pool_used || 0)

  return (
    <Modal
      title={
        <Space>
          <GiftOutlined />
          分配积分给 {user?.username}
        </Space>
      }
      open={visible}
      onOk={handleSubmit}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定分配"
      cancelText="取消"
      width={600}
    >
      {user && groupInfo && (
        <>
          <Alert
            message="从组积分池分配"
            description="您正在从组积分池中分配积分给用户，分配后将直接增加到用户的积分余额中。"
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
                    {((user.credits_quota || 0) - (user.used_credits || 0)).toLocaleString()}
                  </div>
                  <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>积分</div>
                </div>
              </Col>
            </Row>
          </div>

          <Form form={form} layout="vertical">
            <Form.Item
              name="amount"
              label="分配数量"
              rules={[
                { required: true, message: '请输入分配数量' },
                { type: 'number', min: 1, message: '分配数量必须大于0' },
                { type: 'number', max: poolRemaining, message: `不能超过积分池剩余(${poolRemaining})` }
              ]}
            >
              <InputNumber
                min={1}
                max={poolRemaining}
                style={{ width: '100%' }}
                placeholder="请输入分配积分数量"
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value.replace(/\$\s?|(,*)/g, '')}
              />
            </Form.Item>

            <Form.Item
              name="reason"
              label="分配原因"
              rules={[
                { required: true, message: '请输入分配原因' },
                { max: 200, message: '分配原因不能超过200个字符' }
              ]}
            >
              <Input.TextArea
                rows={3}
                placeholder="请输入分配原因，如：项目奖励、任务完成等"
                maxLength={200}
                showCount
              />
            </Form.Item>
          </Form>

          {user.role !== 'user' && (
            <Alert
              message="提示"
              description={`${user.username} 是${user.role === 'admin' ? '组管理员' : '超级管理员'}，请确认是否分配积分。`}
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </>
      )}
    </Modal>
  )
}

export default DistributeCreditsModal
