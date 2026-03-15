/**
 * API接入管理抽屉组件
 * 
 * 功能：
 * 1. 显示/生成/重新生成API Key
 * 2. 配置访问控制（频率限制、IP白名单、有效期、调用次数上限）
 * 3. 显示调用统计和接入文档
 * 4. 调用日志查看
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  Drawer, Button, Space, Tag, Input, InputNumber, DatePicker,
  Form, Descriptions, Statistic, Card, Tabs, Typography,
  message, Modal, Spin, Empty, Table, Alert, Tooltip, Switch, Row, Col
} from 'antd'
import {
  KeyOutlined, CopyOutlined, ReloadOutlined, DeleteOutlined,
  ApiOutlined, SafetyOutlined, BarChartOutlined, BookOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloudServerOutlined, LockOutlined, ThunderboltOutlined,
  EyeOutlined, EyeInvisibleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import useAgentStore from '../../../../stores/agentStore'

const { Text, Paragraph, Title } = Typography
const { TextArea } = Input
const { TabPane } = Tabs

const ApiAccessDrawer = ({ open, onClose, workflow }) => {
  const {
    apiKeyInfo, apiKeyLoading, apiKeyLogs, apiKeyLogsLoading,
    fetchApiKey, createApiKey, updateApiKeyConfig, deleteApiKey, fetchApiKeyLogs
  } = useAgentStore()

  const [showFullKey, setShowFullKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState(null)
  const [configForm] = Form.useForm()
  const [saving, setSaving] = useState(false)

  /* 打开时加载API Key信息 */
  useEffect(() => {
    if (open && workflow?.id) {
      fetchApiKey(workflow.id)
      setNewApiKey(null)
      setShowFullKey(false)
    }
  }, [open, workflow?.id])

  /* API Key信息变化时同步表单 */
  useEffect(() => {
    if (apiKeyInfo) {
      configForm.setFieldsValue({
        rate_limit_per_minute: apiKeyInfo.rate_limit_per_minute || 10,
        ip_whitelist: (apiKeyInfo.ip_whitelist || []).join('\n'),
        expires_at: apiKeyInfo.expires_at ? dayjs(apiKeyInfo.expires_at) : null,
        max_calls: apiKeyInfo.max_calls || null
      })
    }
  }, [apiKeyInfo, configForm])

  /* 生成/重新生成API Key */
  const handleGenerateKey = useCallback(async (regenerate = false) => {
    if (regenerate) {
      Modal.confirm({
        title: '确认重新生成',
        icon: <ExclamationCircleOutlined />,
        content: '重新生成后，旧的API Key将立即失效，所有使用旧Key的外部调用将中断。确定继续？',
        okText: '确认重新生成',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          const result = await createApiKey(workflow.id, true)
          if (result?.api_key) {
            setNewApiKey(result.api_key)
            setShowFullKey(true)
            fetchApiKey(workflow.id)
          }
        }
      })
    } else {
      const result = await createApiKey(workflow.id, false)
      if (result?.api_key) {
        setNewApiKey(result.api_key)
        setShowFullKey(true)
        fetchApiKey(workflow.id)
      }
    }
  }, [workflow?.id, createApiKey, fetchApiKey])

  /* 删除API Key */
  const handleDeleteKey = useCallback(() => {
    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: '删除后所有外部API调用将立即失效，且调用统计将清零。确定删除？',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteApiKey(workflow.id)
        setNewApiKey(null)
        setShowFullKey(false)
      }
    })
  }, [workflow?.id, deleteApiKey])

  /* 保存访问控制配置 */
  const handleSaveConfig = useCallback(async (values) => {
    setSaving(true)
    try {
      const config = {
        rate_limit_per_minute: values.rate_limit_per_minute,
        ip_whitelist: values.ip_whitelist
          ? values.ip_whitelist.split('\n').map(ip => ip.trim()).filter(Boolean)
          : [],
        expires_at: values.expires_at ? values.expires_at.format('YYYY-MM-DD HH:mm:ss') : null,
        max_calls: values.max_calls || null
      }
      await updateApiKeyConfig(workflow.id, config)
      message.success('配置已保存')
    } catch (error) {
      /* store已处理错误提示 */
    } finally {
      setSaving(false)
    }
  }, [workflow?.id, updateApiKeyConfig])

  /* 复制到剪贴板 */
  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  }, [])

  /* 获取API基地址 */
  const getApiBaseUrl = () => {
    const origin = window.location.origin
    return `${origin}/api/v1/agent`
  }

  /* ========== 渲染：API Key 面板 ========== */
  const renderKeyPanel = () => (
    <div style={{ padding: '0' }}>
      {/* 新生成的Key提示 */}
      {newApiKey && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="请立即复制并妥善保管此API Key"
          description={
            <div>
              <Text>此密钥仅显示一次，关闭后将无法再次查看完整密钥。</Text>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Input.Password
                  value={newApiKey}
                  readOnly
                  visibilityToggle={{ visible: showFullKey, onVisibleChange: setShowFullKey }}
                  style={{ fontFamily: 'monospace', flex: 1 }}
                />
                <Button icon={<CopyOutlined />} onClick={() => handleCopy(newApiKey)}>复制</Button>
              </div>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {apiKeyLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : apiKeyInfo ? (
        <>
          {/* Key信息卡片 */}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="密钥">
                <Space>
                  <Text code style={{ fontFamily: 'monospace' }}>
                    {apiKeyInfo.api_key_masked}
                  </Text>
                  <Tag color={apiKeyInfo.status === 'active' ? 'success' : 'error'}>
                    {apiKeyInfo.status === 'active' ? '启用' : '停用'}
                  </Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(apiKeyInfo.created_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* 统计卡片 */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="总调用次数" value={apiKeyInfo.total_calls || 0}
                  prefix={<ThunderboltOutlined />} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="消耗积分" value={apiKeyInfo.total_credits_used || 0}
                  prefix={<BarChartOutlined />} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="最后调用"
                  value={apiKeyInfo.last_called_at ? dayjs(apiKeyInfo.last_called_at).fromNow() : '暂无'}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ fontSize: 14, marginTop: 4 }} />
              </Card>
            </Col>
          </Row>

          {/* 操作按钮 */}
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => handleGenerateKey(true)}>
              重新生成
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleDeleteKey}>
              删除Key
            </Button>
          </Space>
        </>
      ) : (
        /* 未生成Key */
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <KeyOutlined style={{ fontSize: 48, color: '#ccc', marginBottom: 16 }} />
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">尚未生成API Key</Text>
          </div>
          <Button type="primary" icon={<KeyOutlined />} onClick={() => handleGenerateKey(false)}>
            生成API Key
          </Button>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              发布工作流时会自动生成，也可以手动生成
            </Text>
          </div>
        </div>
      )}
    </div>
  )

  /* ========== 渲染：访问控制面板 ========== */
  const renderAccessControl = () => (
    <Form form={configForm} layout="vertical" onFinish={handleSaveConfig}
      disabled={!apiKeyInfo}>
      {!apiKeyInfo && (
        <Alert type="info" message="请先生成API Key后再配置访问控制" showIcon
          style={{ marginBottom: 16 }} />
      )}

      <Form.Item label="每分钟最大调用次数" name="rate_limit_per_minute"
        tooltip="限制外部系统每分钟的调用频率，0表示不限制">
        <InputNumber min={0} max={1000} style={{ width: '100%' }}
          placeholder="默认10次/分钟" addonAfter="次/分钟" />
      </Form.Item>

      <Form.Item label="IP白名单" name="ip_whitelist"
        tooltip="每行一个IP地址，为空则不限制IP">
        <TextArea rows={3} placeholder="每行一个IP，例如：&#10;192.168.1.100&#10;10.0.0.1" />
      </Form.Item>

      <Form.Item label="有效期" name="expires_at"
        tooltip="过期后API Key自动失效">
        <DatePicker showTime style={{ width: '100%' }}
          placeholder="不设置则永久有效" />
      </Form.Item>

      <Form.Item label="最大调用次数" name="max_calls"
        tooltip="累计调用达到此次数后自动停用">
        <InputNumber min={0} max={10000000} style={{ width: '100%' }}
          placeholder="不设置则不限制" addonAfter="次" />
      </Form.Item>

      <Button type="primary" htmlType="submit" loading={saving}
        disabled={!apiKeyInfo} block>
        保存配置
      </Button>
    </Form>
  )

  /* ========== 渲染：接入文档面板 ========== */
  const renderDocs = () => {
    const baseUrl = getApiBaseUrl()
    return (
      <div>
        <Title level={5}>一次性执行</Title>
        <Paragraph>
          <Text strong>POST {baseUrl}/run</Text>
        </Paragraph>
        <div style={{ position: 'relative' }}>
          <pre style={{
            background: '#1e1e1e', color: '#d4d4d4', padding: 16,
            borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 200
          }}>
{`curl -X POST ${baseUrl}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "你好，请介绍一下你自己"}'`}
          </pre>
          <Button size="small" icon={<CopyOutlined />}
            style={{ position: 'absolute', top: 8, right: 8 }}
            onClick={() => handleCopy(`curl -X POST ${baseUrl}/run \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"query": "你好"}'`)} />
        </div>

        <Title level={5} style={{ marginTop: 24 }}>多轮对话</Title>
        <Paragraph>
          <Text strong>POST {baseUrl}/chat</Text>
        </Paragraph>
        <pre style={{
          background: '#1e1e1e', color: '#d4d4d4', padding: 16,
          borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 200
        }}>
{`# 首次调用（自动创建会话）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "你好"}'

# 后续调用（携带session_id）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "SESSION_ID", "message": "继续聊"}'`}
        </pre>

        <Title level={5} style={{ marginTop: 24 }}>Python示例</Title>
        <pre style={{
          background: '#1e1e1e', color: '#d4d4d4', padding: 16,
          borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 240
        }}>
{`import requests

API_KEY = "YOUR_API_KEY"
BASE_URL = "${baseUrl}"

# 一次性执行
resp = requests.post(f"{BASE_URL}/run",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"query": "你好"})
print(resp.json())

# 多轮对话
session_id = None
while True:
    msg = input("你: ")
    body = {"message": msg}
    if session_id:
        body["session_id"] = session_id
    resp = requests.post(f"{BASE_URL}/chat",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json=body)
    data = resp.json()["data"]
    session_id = data["session_id"]
    print(f"AI: {data['reply']}")`}
        </pre>

        <Title level={5} style={{ marginTop: 24 }}>响应格式</Title>
        <pre style={{
          background: '#1e1e1e', color: '#d4d4d4', padding: 16,
          borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 160
        }}>
{`{
  "success": true,
  "data": {
    "output": "AI回复内容",     // run模式
    "reply": "AI回复内容",      // chat模式
    "session_id": "xxx",        // chat模式
    "credits_used": 10,
    "duration_ms": 2500
  }
}`}
        </pre>

        <Title level={5} style={{ marginTop: 24 }}>错误码</Title>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="401">API Key缺失或无效</Descriptions.Item>
          <Descriptions.Item label="402">创建者积分不足</Descriptions.Item>
          <Descriptions.Item label="403">工作流未发布 / IP不在白名单 / Key已过期</Descriptions.Item>
          <Descriptions.Item label="429">调用频率超限</Descriptions.Item>
          <Descriptions.Item label="500">工作流执行错误</Descriptions.Item>
        </Descriptions>
      </div>
    )
  }

  /* ========== 渲染：调用日志 ========== */
  const renderLogs = () => {
    const columns = [
      {
        title: '时间', dataIndex: 'created_at', width: 150,
        render: (t) => dayjs(t).format('MM-DD HH:mm:ss')
      },
      {
        title: '类型', dataIndex: 'call_type', width: 60,
        render: (t) => <Tag color={t === 'run' ? 'blue' : 'purple'}>{t}</Tag>
      },
      {
        title: '状态', dataIndex: 'status', width: 60,
        render: (s) => <Tag color={s === 'success' ? 'success' : 'error'}>{s}</Tag>
      },
      { title: '积分', dataIndex: 'credits_used', width: 50 },
      {
        title: '耗时', dataIndex: 'duration_ms', width: 70,
        render: (d) => d ? `${(d / 1000).toFixed(1)}s` : '-'
      },
      { title: 'IP', dataIndex: 'caller_ip', width: 120, ellipsis: true }
    ]

    return (
      <div>
        <Button onClick={() => fetchApiKeyLogs(workflow.id)} icon={<ReloadOutlined />}
          style={{ marginBottom: 12 }} size="small">
          刷新
        </Button>
        <Table
          columns={columns}
          dataSource={apiKeyLogs?.logs || []}
          rowKey="id"
          size="small"
          loading={apiKeyLogsLoading}
          pagination={{
            size: 'small',
            total: apiKeyLogs?.pagination?.total || 0,
            pageSize: 20,
            showTotal: (t) => `共${t}条`
          }}
          locale={{ emptyText: <Empty description="暂无调用记录" /> }}
        />
      </div>
    )
  }

  return (
    <Drawer
      title={
        <Space>
          <ApiOutlined />
          <span>API接入管理</span>
          {workflow && <Tag>{workflow.name}</Tag>}
        </Space>
      }
      placement="right"
      width={560}
      onClose={onClose}
      open={open}
    >
      <Tabs defaultActiveKey="key" size="small" items={[
        {
          key: 'key',
          label: <span><KeyOutlined /> API Key</span>,
          children: renderKeyPanel()
        },
        {
          key: 'access',
          label: <span><SafetyOutlined /> 访问控制</span>,
          children: renderAccessControl()
        },
        {
          key: 'docs',
          label: <span><BookOutlined /> 接入文档</span>,
          children: renderDocs()
        },
        {
          key: 'logs',
          label: <span><BarChartOutlined /> 调用日志</span>,
          children: renderLogs()
        }
      ]} />
    </Drawer>
  )
}

export default ApiAccessDrawer
