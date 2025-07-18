/**
 * 组积分池设置弹窗组件
 */

import React from 'react'
import { Modal, Form, InputNumber, Alert, Space, Statistic, Row, Col } from 'antd'
import { WalletOutlined } from '@ant-design/icons'

const GroupCreditsPoolModal = ({
  visible,
  group,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()

  React.useEffect(() => {
    if (visible && group) {
      form.setFieldsValue({
        credits_pool: group.credits_pool || 0
      })
    }
  }, [visible, group, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(group.id, values.credits_pool)
      form.resetFields()
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <WalletOutlined />
          设置组积分池 - {group?.name}
        </Space>
      }
      open={visible}
      onOk={handleSubmit}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
      width={600}
    >
      {group && (
        <>
          <Alert
            message="积分池说明"
            description="设置该组的积分池总额，组管理员可以将积分池中的积分分配给组内成员。"
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />
          
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Statistic
                title="当前积分池"
                value={group.credits_pool || 0}
                suffix="积分"
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="已使用"
                value={group.credits_pool_used || 0}
                suffix="积分"
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="剩余"
                value={(group.credits_pool || 0) - (group.credits_pool_used || 0)}
                suffix="积分"
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
          </Row>

          <Form form={form} layout="vertical">
            <Form.Item
              name="credits_pool"
              label="积分池总额"
              rules={[
                { required: true, message: '请输入积分池总额' },
                { type: 'number', min: group.credits_pool_used || 0, message: `不能低于已使用额度(${group.credits_pool_used || 0})` }
              ]}
            >
              <InputNumber
                min={0}
                max={999999999}
                style={{ width: '100%' }}
                placeholder="请输入积分池总额"
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value.replace(/\$\s?|(,*)/g, '')}
              />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  )
}

export default GroupCreditsPoolModal
