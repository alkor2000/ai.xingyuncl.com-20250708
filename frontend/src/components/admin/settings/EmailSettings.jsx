/**
 * 邮件设置组件
 */

import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Button, Space, message, InputNumber, Alert } from 'antd'
import { MailOutlined, SendOutlined, SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import apiClient from '../../../utils/api'

const EmailSettings = ({ disabled = false }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')

  // 获取邮件设置
  useEffect(() => {
    fetchEmailSettings()
  }, [])

  const fetchEmailSettings = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/admin/settings/email')
      if (response.data.success) {
        form.setFieldsValue(response.data.data)
      }
    } catch (error) {
      message.error('获取邮件设置失败')
    } finally {
      setLoading(false)
    }
  }

  // 保存邮件设置
  const handleSave = async (values) => {
    try {
      setSaving(true)
      const response = await apiClient.put('/admin/settings/email', values)
      if (response.data.success) {
        message.success('邮件设置保存成功')
        // 重新获取设置（密码会被掩码）
        fetchEmailSettings()
      }
    } catch (error) {
      message.error(error.response?.data?.message || '保存邮件设置失败')
    } finally {
      setSaving(false)
    }
  }

  // 测试邮件发送
  const handleTest = async () => {
    if (!testEmail) {
      message.warning('请输入测试邮箱地址')
      return
    }

    try {
      setTesting(true)
      const response = await apiClient.post('/admin/settings/email/test', {
        test_email: testEmail
      })
      if (response.data.success) {
        message.success('测试邮件发送成功，请检查收件箱')
      }
    } catch (error) {
      message.error(error.response?.data?.message || '测试邮件发送失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card
      title={
        <Space>
          <MailOutlined />
          <span>邮件服务设置</span>
        </Space>
      }
      loading={loading}
    >
      <Alert
        message="配置说明"
        description={
          <div>
            <p>1. 支持阿里云企业邮箱、QQ邮箱、163邮箱等SMTP服务</p>
            <p>2. 阿里云企业邮箱SMTP服务器：smtp.qiye.aliyun.com，端口：465（SSL）或 25</p>
            <p>3. 请确保邮箱账号已开启SMTP服务，部分邮箱需要使用授权码而非密码</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        disabled={disabled}
      >
        <Form.Item
          label="SMTP服务器"
          name="smtp_host"
          rules={[{ required: true, message: '请输入SMTP服务器地址' }]}
        >
          <Input 
            placeholder="例如：smtp.qiye.aliyun.com" 
            prefix={<MailOutlined />}
          />
        </Form.Item>

        <Form.Item
          label="端口"
          name="smtp_port"
          rules={[
            { required: true, message: '请输入端口号' },
            { type: 'number', min: 1, max: 65535, message: '端口号必须在1-65535之间' }
          ]}
        >
          <InputNumber 
            style={{ width: '100%' }}
            placeholder="例如：465（SSL）或 25" 
          />
        </Form.Item>

        <Form.Item
          label="邮箱账号"
          name="smtp_user"
          rules={[
            { required: true, message: '请输入邮箱账号' },
            { type: 'email', message: '请输入有效的邮箱地址' }
          ]}
        >
          <Input 
            placeholder="发送邮件的邮箱账号" 
          />
        </Form.Item>

        <Form.Item
          label="邮箱密码/授权码"
          name="smtp_pass"
          rules={[{ required: true, message: '请输入邮箱密码或授权码' }]}
          extra="部分邮箱需要使用授权码而非密码"
        >
          <Input.Password 
            placeholder="邮箱密码或SMTP授权码" 
          />
        </Form.Item>

        <Form.Item
          label="发件人名称"
          name="smtp_from"
        >
          <Input 
            placeholder="例如：AI Platform（可选）" 
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={saving}
              icon={<SaveOutlined />}
              disabled={disabled}
            >
              保存设置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Card 
        title="测试邮件发送" 
        size="small"
        style={{ marginTop: 24 }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="输入接收测试邮件的邮箱地址"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            disabled={disabled}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleTest}
            loading={testing}
            disabled={disabled || !testEmail}
          >
            发送测试邮件
          </Button>
        </Space>
      </Card>
    </Card>
  )
}

export default EmailSettings
