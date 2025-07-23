/**
 * 组有效期设置弹窗组件
 */

import React, { useEffect } from 'react'
import { Modal, Form, Input, Button, Space, Alert, Checkbox } from 'antd'
import { CalendarOutlined } from '@ant-design/icons'

const GroupExpireDateModal = ({
  visible,
  group,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()

  useEffect(() => {
    if (visible && group) {
      form.setFieldsValue({
        expire_date: group.expire_date || '',
        sync_to_users: false
      })
    }
  }, [visible, group, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      onSubmit(group.id, values.expire_date || null, values.sync_to_users)
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <CalendarOutlined />
          设置组有效期 - {group?.name}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          确定
        </Button>
      ]}
      width={500}
    >
      <Alert
        message="组有效期说明"
        description={
          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
            <li>设置组有效期后，组内所有用户默认继承该有效期</li>
            <li>可以选择是否立即同步到所有组员</li>
            <li>超级管理员账号不受有效期限制</li>
            <li>清空有效期将使组永久有效</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical">
        <Form.Item
          name="expire_date"
          label="组有效期"
          extra="留空表示永久有效，格式：YYYY-MM-DD"
          rules={[
            {
              pattern: /^\d{4}-\d{2}-\d{2}$/,
              message: '请输入正确的日期格式（YYYY-MM-DD）'
            }
          ]}
        >
          <Input 
            placeholder="例如：2025-12-31" 
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          name="sync_to_users"
          valuePropName="checked"
        >
          <Checkbox>
            立即同步到所有组员
            <span style={{ color: '#999', marginLeft: 8 }}>
              (将覆盖组内所有用户的账号有效期，超管除外)
            </span>
          </Checkbox>
        </Form.Item>

        {group && (
          <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
            <div style={{ fontSize: 12, color: '#666' }}>
              <div>当前组员数: {group.user_count || 0} 人</div>
              {group.expire_date && (
                <div style={{ marginTop: 4 }}>
                  当前有效期: {group.expire_date}
                </div>
              )}
            </div>
          </div>
        )}
      </Form>
    </Modal>
  )
}

export default GroupExpireDateModal
