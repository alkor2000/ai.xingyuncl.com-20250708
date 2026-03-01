/**
 * 速率限制设置组件
 * 
 * v1.1 (2026-03-01):
 *   - 新增chat对话限流配置卡片
 *   - 预设模板同步新增chat配置
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Form,
  InputNumber,
  Input,
  Switch,
  Row,
  Col,
  Button,
  Space,
  Alert,
  Spin,
  message,
  Tooltip,
  Tag
} from 'antd'
import {
  ThunderboltOutlined,
  SaveOutlined,
  InfoCircleOutlined,
  ClockCircleOutlined,
  NumberOutlined
} from '@ant-design/icons'
import apiClient from '../../../utils/api'

const { TextArea } = Input

// 速率限制配置说明 - v1.1 新增chat
const RATE_LIMIT_INFO = {
  chat: {
    title: 'AI对话限制',
    description: '控制用户发送AI对话消息的频率，防止滥用API调用',
    icon: '💬'
  },
  auth: {
    title: '认证请求限制',
    description: '控制登录、注册、刷新令牌等认证相关接口的请求频率',
    icon: '🔐'
  },
  emailCode: {
    title: '邮箱验证码限制',
    description: '控制发送邮箱验证码的请求频率，防止恶意发送',
    icon: '📧'
  },
  global: {
    title: '全局API限制',
    description: '控制所有API接口的总体请求频率',
    icon: '🌐'
  },
  adminRead: {
    title: '管理读取限制',
    description: '控制管理后台读取操作（GET请求）的频率',
    icon: '📖'
  },
  adminWrite: {
    title: '管理写入限制',
    description: '控制管理后台写入操作（POST/PUT/DELETE）的频率',
    icon: '✏️'
  }
}

// 预设配置模板 - v1.1 新增chat
const PRESETS = {
  loose: {
    name: '宽松',
    color: 'green',
    config: {
      chat: { windowMinutes: 1, max: 60, message: '对话频率过高，请稍后再试' },
      auth: { windowMinutes: 15, max: 200, message: '认证请求过于频繁，请稍后再试' },
      emailCode: { windowMinutes: 60, max: 20, message: '发送验证码过于频繁，请稍后再试' },
      global: { windowMinutes: 15, max: 5000, message: '请求过于频繁，请稍后再试' },
      adminRead: { windowMinutes: 15, max: 5000, message: '读取操作过于频繁，请稍后再试' },
      adminWrite: { windowMinutes: 15, max: 1000, message: '写入操作过于频繁，请稍后再试' }
    }
  },
  standard: {
    name: '标准',
    color: 'blue',
    config: {
      chat: { windowMinutes: 1, max: 15, message: '对话频率过高，请稍后再试' },
      auth: { windowMinutes: 15, max: 100, message: '认证请求过于频繁，请稍后再试' },
      emailCode: { windowMinutes: 60, max: 10, message: '发送验证码过于频繁，请稍后再试' },
      global: { windowMinutes: 15, max: 2000, message: '请求过于频繁，请稍后再试' },
      adminRead: { windowMinutes: 15, max: 3000, message: '读取操作过于频繁，请稍后再试' },
      adminWrite: { windowMinutes: 15, max: 500, message: '写入操作过于频繁，请稍后再试' }
    }
  },
  strict: {
    name: '严格',
    color: 'orange',
    config: {
      chat: { windowMinutes: 1, max: 5, message: '对话频率过高，请稍后再试' },
      auth: { windowMinutes: 15, max: 30, message: '认证请求过于频繁，请稍后再试' },
      emailCode: { windowMinutes: 60, max: 5, message: '发送验证码过于频繁，请稍后再试' },
      global: { windowMinutes: 15, max: 500, message: '请求过于频繁，请稍后再试' },
      adminRead: { windowMinutes: 15, max: 1000, message: '读取操作过于频繁，请稍后再试' },
      adminWrite: { windowMinutes: 15, max: 100, message: '写入操作过于频繁，请稍后再试' }
    }
  }
}

const RateLimitSettings = ({ disabled = false }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({})

  // 获取速率限制设置
  const fetchSettings = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/settings/rate-limit')
      if (response.data.success) {
        setSettings(response.data.data)
        form.setFieldsValue(response.data.data)
      }
    } catch (error) {
      message.error('获取速率限制设置失败')
    } finally {
      setLoading(false)
    }
  }

  // 保存设置
  const handleSave = async (values) => {
    setSaving(true)
    try {
      const response = await apiClient.put('/admin/settings/rate-limit', values)
      if (response.data.success) {
        message.success('速率限制设置保存成功')
        setSettings(values)
      }
    } catch (error) {
      message.error(error.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 应用预设
  const applyPreset = (preset) => {
    form.setFieldsValue(preset.config)
    message.info(`已应用${preset.name}预设`)
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Spin size="large" />
        </div>
      </Card>
    )
  }

  return (
    <>
      {disabled && (
        <Alert
          message="只读模式"
          description="只有超级管理员可以修改速率限制设置"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>速率限制设置</span>
          </Space>
        }
        extra={
          !disabled && (
            <Space>
              {Object.entries(PRESETS).map(([key, preset]) => (
                <Button
                  key={key}
                  size="small"
                  onClick={() => applyPreset(preset)}
                >
                  <Tag color={preset.color}>{preset.name}模式</Tag>
                </Button>
              ))}
            </Space>
          )
        }
      >
        <Alert
          message="速率限制说明"
          description={
            <div>
              <p>速率限制用于防止恶意请求和保护系统稳定性。</p>
              <p>• 时间窗口：在指定的时间范围内统计请求次数</p>
              <p>• 最大请求数：时间窗口内允许的最大请求次数</p>
              <p>• 修改后立即生效，无需重启服务</p>
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
          <Row gutter={24}>
            {Object.entries(RATE_LIMIT_INFO).map(([key, info]) => (
              <Col xs={24} lg={12} key={key}>
                <Card 
                  title={
                    <Space>
                      <span>{info.icon}</span>
                      <span>{info.title}</span>
                    </Space>
                  }
                  size="small"
                  style={{ marginBottom: 16 }}
                >
                  <p style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
                    {info.description}
                  </p>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name={[key, 'windowMinutes']}
                        label={
                          <Space>
                            <ClockCircleOutlined />
                            时间窗口
                          </Space>
                        }
                        rules={[
                          { required: true, message: '请输入时间窗口' },
                          { type: 'number', min: 1, max: 1440, message: '范围：1-1440分钟' }
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          min={1}
                          max={1440}
                          addonAfter="分钟"
                          placeholder="15"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name={[key, 'max']}
                        label={
                          <Space>
                            <NumberOutlined />
                            最大请求数
                          </Space>
                        }
                        rules={[
                          { required: true, message: '请输入最大请求数' },
                          { type: 'number', min: 1, max: 100000, message: '范围：1-100000' }
                        ]}
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          min={1}
                          max={100000}
                          addonAfter="次"
                          placeholder="100"
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item
                    name={[key, 'message']}
                    label="提示消息"
                    rules={[{ required: true, message: '请输入提示消息' }]}
                  >
                    <TextArea
                      rows={2}
                      placeholder="请求过于频繁，请稍后再试"
                      maxLength={200}
                      showCount
                    />
                  </Form.Item>

                  <Form.Item
                    name={[key, 'enabled']}
                    label="启用状态"
                    valuePropName="checked"
                    initialValue={true}
                  >
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>

                  {/* 显示计算结果 */}
                  <Form.Item shouldUpdate>
                    {({ getFieldValue }) => {
                      const windowMinutes = getFieldValue([key, 'windowMinutes']) || 15
                      const max = getFieldValue([key, 'max']) || 100
                      const rate = (max / windowMinutes * 60).toFixed(1)
                      return (
                        <Alert
                          message={`平均速率：${rate} 次/小时`}
                          type="success"
                          showIcon
                          icon={<InfoCircleOutlined />}
                        />
                      )
                    }}
                  </Form.Item>
                </Card>
              </Col>
            ))}
          </Row>

          {!disabled && (
            <Form.Item style={{ textAlign: 'center', marginTop: 24 }}>
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  htmlType="submit"
                  loading={saving}
                  size="large"
                >
                  保存设置
                </Button>
                <Button onClick={() => form.resetFields()} size="large">
                  重置
                </Button>
              </Space>
            </Form.Item>
          )}
        </Form>
      </Card>
    </>
  )
}

export default RateLimitSettings
