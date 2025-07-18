/**
 * 组员上限设置弹窗组件
 */

import React from 'react'
import { Modal, Form, InputNumber, Alert, Space, Row, Col, Tag } from 'antd'
import { TeamOutlined, WarningOutlined } from '@ant-design/icons'

const GroupUserLimitModal = ({
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
        user_limit: group.user_limit || 10
      })
    }
  }, [visible, group, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(group.id, values.user_limit)
      form.resetFields()
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  const currentCount = group?.user_count || 0
  const currentLimit = group?.user_limit || 10
  const percentage = (currentCount / currentLimit) * 100
  const isFull = currentCount >= currentLimit

  return (
    <Modal
      title={
        <Space>
          <TeamOutlined />
          设置组员上限 - {group?.name}
        </Space>
      }
      open={visible}
      onOk={handleSubmit}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定设置"
      cancelText="取消"
      width={500}
    >
      {group && (
        <>
          <Alert
            message="组员上限设置"
            description="设置该组最多可以容纳的用户数量。上限不能低于当前组员数。"
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />
          
          <div style={{ marginBottom: 24, padding: '16px', background: '#f5f5f5', borderRadius: '8px' }}>
            <Row gutter={16}>
              <Col span={12}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#666', fontSize: '12px', marginBottom: 8 }}>
                    当前组员数
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: isFull ? '#ff4d4f' : '#000' }}>
                    {currentCount}
                  </div>
                  <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>人</div>
                  {isFull && <Tag color="error" style={{ marginTop: 8 }}>已满</Tag>}
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#666', fontSize: '12px', marginBottom: 8 }}>
                    当前上限
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
                    {currentLimit}
                  </div>
                  <div style={{ color: '#999', fontSize: '12px', marginTop: 4 }}>人</div>
                  <div style={{ marginTop: 8 }}>
                    <Tag color={percentage >= 80 ? 'warning' : 'success'}>
                      使用率 {Math.round(percentage)}%
                    </Tag>
                  </div>
                </div>
              </Col>
            </Row>
          </div>

          <Form form={form} layout="vertical">
            <Form.Item
              name="user_limit"
              label="新的组员上限"
              rules={[
                { required: true, message: '请输入组员上限' },
                { type: 'number', min: currentCount, message: `不能低于当前组员数(${currentCount})` },
                { type: 'number', min: 1, message: '组员上限至少为1' },
                { type: 'number', max: 9999, message: '组员上限不能超过9999' }
              ]}
            >
              <InputNumber
                min={currentCount}
                max={9999}
                style={{ width: '100%' }}
                placeholder="请输入新的组员上限"
                addonAfter="人"
              />
            </Form.Item>
          </Form>

          {currentCount > 0 && (
            <Alert
              message="提示"
              description={`当前组内有 ${currentCount} 个用户，设置的上限不能低于此数值。`}
              type="warning"
              icon={<WarningOutlined />}
              style={{ marginTop: 16 }}
            />
          )}
        </>
      )}
    </Modal>
  )
}

export default GroupUserLimitModal
