/**
 * API接入管理抽屉组件
 * iOS毛玻璃科技风设计，与系统整体风格统一
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
  Form, Descriptions, Tabs, Typography,
  message, Modal, Spin, Empty, Table, Alert
} from 'antd'
import {
  KeyOutlined, CopyOutlined, ReloadOutlined, DeleteOutlined,
  ApiOutlined, SafetyOutlined, BarChartOutlined, BookOutlined,
  ExclamationCircleOutlined, ClockCircleOutlined,
  ThunderboltOutlined, SendOutlined, MessageOutlined,
  CodeOutlined, PythonOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import useAgentStore from '../../../../stores/agentStore'
import './ApiAccessDrawer.less'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { Text } = Typography
const { TextArea } = Input

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
        content: '重新生成后旧Key立即失效，所有外部调用将中断。确定继续？',
        okText: '确认',
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
      content: '删除后所有外部API调用将立即失效。确定删除？',
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
      /* store已处理 */
    } finally {
      setSaving(false)
    }
  }, [workflow?.id, updateApiKeyConfig])

  /* 复制到剪贴板 */
  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败')
    })
  }, [])

  /* API基地址 */
  const getApiBaseUrl = () => `${window.location.origin}/api/v1/agent`

  /* ========== API Key 面板 ========== */
  const renderKeyPanel = () => (
    <div>
      {/* 新Key提示 */}
      {newApiKey && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          className="api-new-key-alert"
          message="请立即复制并妥善保管"
          description={
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>此密钥仅显示一次，关闭后无法再次查看。</Text>
              <div className="api-new-key-row">
                <Input.Password
                  value={newApiKey}
                  readOnly
                  visibilityToggle={{ visible: showFullKey, onVisibleChange: setShowFullKey }}
                  style={{ flex: 1 }}
                />
                <Button type="primary" icon={<CopyOutlined />} onClick={() => handleCopy(newApiKey)}>
                  复制
                </Button>
              </div>
            </div>
          }
        />
      )}

      {apiKeyLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : apiKeyInfo ? (
        <>
          {/* Key信息卡片 */}
          <div className="api-key-card">
            <div className="api-key-header">
              <span className="api-key-value">{apiKeyInfo.api_key_masked}</span>
              <Tag color={apiKeyInfo.status === 'active' ? 'success' : 'error'}
                style={{ borderRadius: 6, fontWeight: 600 }}>
                {apiKeyInfo.status === 'active' ? '已启用' : '已停用'}
              </Tag>
            </div>
            <div className="api-key-meta">
              <span className="meta-item">
                <ClockCircleOutlined />
                创建于 {dayjs(apiKeyInfo.created_at).format('YYYY-MM-DD HH:mm')}
              </span>
              {apiKeyInfo.expires_at && (
                <span className="meta-item">
                  <ExclamationCircleOutlined />
                  到期 {dayjs(apiKeyInfo.expires_at).format('YYYY-MM-DD')}
                </span>
              )}
            </div>
          </div>

          {/* 统计 */}
          <div className="api-stats-grid">
            <div className="api-stat-card calls">
              <span className="stat-icon"><ThunderboltOutlined /></span>
              <div className="stat-value">{apiKeyInfo.total_calls || 0}</div>
              <div className="stat-label">总调用</div>
            </div>
            <div className="api-stat-card credits">
              <span className="stat-icon"><BarChartOutlined /></span>
              <div className="stat-value">{apiKeyInfo.total_credits_used || 0}</div>
              <div className="stat-label">消耗积分</div>
            </div>
            <div className="api-stat-card time">
              <span className="stat-icon"><ClockCircleOutlined /></span>
              <div className="stat-value">
                {apiKeyInfo.last_called_at ? dayjs(apiKeyInfo.last_called_at).fromNow() : '暂无'}
              </div>
              <div className="stat-label">最后调用</div>
            </div>
          </div>

          {/* 操作 */}
          <div className="api-actions">
            <Button icon={<ReloadOutlined />} onClick={() => handleGenerateKey(true)}>
              重新生成
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleDeleteKey}>
              删除
            </Button>
          </div>
        </>
      ) : (
        /* 空状态 */
        <div className="api-empty-state">
          <div className="api-empty-icon">
            <KeyOutlined />
          </div>
          <div className="api-empty-title">开启外部API接入</div>
          <div className="api-empty-desc">
            生成API Key后，外部系统可通过HTTP接口调用此工作流
          </div>
          <Button type="primary" icon={<KeyOutlined />} onClick={() => handleGenerateKey(false)}>
            生成 API Key
          </Button>
          <div className="api-empty-hint">发布工作流时也会自动生成</div>
        </div>
      )}
    </div>
  )

  /* ========== 访问控制 ========== */
  const renderAccessControl = () => (
    <div>
      {!apiKeyInfo && (
        <Alert type="info" message="请先生成API Key后再配置" showIcon className="api-access-alert" />
      )}
      <Form form={configForm} layout="vertical" onFinish={handleSaveConfig}
        disabled={!apiKeyInfo} className="api-access-form">

        <Form.Item label="频率限制" name="rate_limit_per_minute"
          tooltip="每分钟最大调用次数，0表示不限制">
          <InputNumber min={0} max={1000} style={{ width: '100%' }}
            placeholder="默认10" addonAfter="次/分钟" />
        </Form.Item>

        <Form.Item label="IP白名单" name="ip_whitelist"
          tooltip="每行一个IP，为空不限制">
          <TextArea rows={3} placeholder={"每行一个IP地址\n192.168.1.100\n10.0.0.1"} />
        </Form.Item>

        <Form.Item label="有效期" name="expires_at"
          tooltip="过期后API Key自动失效">
          <DatePicker showTime style={{ width: '100%' }} placeholder="不设置则永久有效" />
        </Form.Item>

        <Form.Item label="调用次数上限" name="max_calls"
          tooltip="累计达到此数后自动停用">
          <InputNumber min={0} max={10000000} style={{ width: '100%' }}
            placeholder="不设置则不限制" addonAfter="次" />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={saving}
          disabled={!apiKeyInfo} block className="api-save-btn">
          保存配置
        </Button>
      </Form>
    </div>
  )

  /* ========== 接入文档 ========== */
  const renderDocs = () => {
    const baseUrl = getApiBaseUrl()
    return (
      <div className="api-docs">
        {/* 一次性执行 */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <SendOutlined style={{ color: '#1890ff' }} /> 一次性执行
          </div>
          <div className="api-docs-endpoint">POST {baseUrl}/run</div>
          <div className="api-code-block">
            <Button size="small" icon={<CopyOutlined />} className="api-copy-btn"
              onClick={() => handleCopy(`curl -X POST ${baseUrl}/run \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"query": "你好"}'`)} />
{`curl -X POST ${baseUrl}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "你好，请介绍一下你自己"}'`}
          </div>
        </div>

        {/* 多轮对话 */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <MessageOutlined style={{ color: '#722ed1' }} /> 多轮对话
          </div>
          <div className="api-docs-endpoint">POST {baseUrl}/chat</div>
          <div className="api-code-block">
{`# 首次调用（自动创建会话）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "你好"}'

# 后续调用（携带session_id继续对话）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "SID", "message": "继续聊"}'`}
          </div>
        </div>

        {/* Python示例 */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <CodeOutlined style={{ color: '#52c41a' }} /> Python 示例
          </div>
          <div className="api-code-block">
            <Button size="small" icon={<CopyOutlined />} className="api-copy-btn"
              onClick={() => handleCopy(`import requests\n\nAPI_KEY = "YOUR_API_KEY"\nBASE = "${baseUrl}"\n\n# 一次性执行\nresp = requests.post(f"{BASE}/run",\n    headers={"Authorization": f"Bearer {API_KEY}"},\n    json={"query": "你好"})\nprint(resp.json())\n\n# 多轮对话\nsid = None\nwhile True:\n    msg = input("你: ")\n    body = {"message": msg}\n    if sid: body["session_id"] = sid\n    r = requests.post(f"{BASE}/chat",\n        headers={"Authorization": f"Bearer {API_KEY}"},\n        json=body)\n    d = r.json()["data"]\n    sid = d["session_id"]\n    print(f"AI: {d['reply']}")`)} />
{`import requests

API_KEY = "YOUR_API_KEY"
BASE = "${baseUrl}"

# 一次性执行
resp = requests.post(f"{BASE}/run",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"query": "你好"})
print(resp.json())

# 多轮对话
sid = None
while True:
    msg = input("你: ")
    body = {"message": msg}
    if sid: body["session_id"] = sid
    r = requests.post(f"{BASE}/chat",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json=body)
    d = r.json()["data"]
    sid = d["session_id"]
    print(f"AI: {d['reply']}")`}
          </div>
        </div>

        {/* 响应格式 */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <CodeOutlined style={{ color: '#faad14' }} /> 响应格式
          </div>
          <div className="api-code-block">
{`{
  "success": true,
  "data": {
    "output": "AI回复",      // run模式
    "reply": "AI回复",       // chat模式
    "session_id": "xxx",     // chat模式
    "credits_used": 10,
    "duration_ms": 2500
  }
}`}
          </div>
        </div>

        {/* 错误码 */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} /> 错误码
          </div>
          <Descriptions column={1} size="small" bordered className="api-error-table">
            <Descriptions.Item label="401">API Key缺失或无效</Descriptions.Item>
            <Descriptions.Item label="402">工作流创建者积分不足</Descriptions.Item>
            <Descriptions.Item label="403">未发布 / IP限制 / 过期</Descriptions.Item>
            <Descriptions.Item label="429">调用频率超限</Descriptions.Item>
            <Descriptions.Item label="500">工作流执行错误</Descriptions.Item>
          </Descriptions>
        </div>
      </div>
    )
  }

  /* ========== 调用日志 ========== */
  const renderLogs = () => {
    const columns = [
      {
        title: '时间', dataIndex: 'created_at', width: 140,
        render: (t) => dayjs(t).format('MM-DD HH:mm:ss')
      },
      {
        title: '类型', dataIndex: 'call_type', width: 65,
        render: (t) => (
          <Tag color={t === 'run' ? 'blue' : 'purple'} style={{ borderRadius: 4 }}>
            {t === 'run' ? '执行' : '对话'}
          </Tag>
        )
      },
      {
        title: '状态', dataIndex: 'status', width: 65,
        render: (s) => (
          <Tag color={s === 'success' ? 'success' : 'error'} style={{ borderRadius: 4 }}>
            {s === 'success' ? '成功' : '失败'}
          </Tag>
        )
      },
      {
        title: '积分', dataIndex: 'credits_used', width: 55,
        render: (v) => <Text strong>{v || 0}</Text>
      },
      {
        title: '耗时', dataIndex: 'duration_ms', width: 65,
        render: (d) => d ? <Text type="secondary">{(d / 1000).toFixed(1)}s</Text> : '-'
      },
      {
        title: 'IP', dataIndex: 'caller_ip', width: 110, ellipsis: true,
        render: (ip) => <Text code style={{ fontSize: 11 }}>{ip || '-'}</Text>
      }
    ]

    return (
      <div className="api-logs">
        <div className="api-logs-header">
          <Text type="secondary" style={{ fontSize: 13 }}>
            {apiKeyLogs?.pagination?.total ? `共 ${apiKeyLogs.pagination.total} 条记录` : '暂无记录'}
          </Text>
          <Button onClick={() => fetchApiKeyLogs(workflow.id)} icon={<ReloadOutlined />} size="small">
            刷新
          </Button>
        </div>
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
            showTotal: (t) => `${t}条`
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" /> }}
        />
      </div>
    )
  }

  return (
    <Drawer
      title={
        <Space>
          <ApiOutlined style={{ color: '#1890ff' }} />
          <span style={{ fontWeight: 600 }}>API 接入</span>
          {workflow && (
            <Tag style={{ borderRadius: 6, fontWeight: 500 }}>{workflow.name}</Tag>
          )}
        </Space>
      }
      placement="right"
      width={580}
      onClose={onClose}
      open={open}
      className="api-drawer"
    >
      <Tabs defaultActiveKey="key" size="small"
        items={[
          {
            key: 'key',
            label: <span><KeyOutlined /> 密钥</span>,
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
        ]}
      />
    </Drawer>
  )
}

export default ApiAccessDrawer
