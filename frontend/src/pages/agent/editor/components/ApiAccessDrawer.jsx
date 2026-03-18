/**
 * API接入管理抽屉组件 v2.0
 * 
 * 优化：
 * - 接入文档全面完善：4个端点全覆盖 + 请求参数表格 + 完整请求/响应示例
 * - 每个代码块统一一键复制按钮
 * - 新增 JavaScript/Node.js 示例
 * - 新增获取对话历史 + 结束会话文档
 * - 标注同步模式说明和超时建议
 * 
 * @module pages/agent/editor/components/ApiAccessDrawer
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Drawer, Button, Space, Tag, Input, InputNumber, DatePicker,
  Form, Descriptions, Tabs, Typography,
  message, Modal, Spin, Empty, Table, Alert
} from 'antd';
import {
  KeyOutlined, CopyOutlined, ReloadOutlined, DeleteOutlined,
  ApiOutlined, SafetyOutlined, BarChartOutlined, BookOutlined,
  ExclamationCircleOutlined, ClockCircleOutlined,
  ThunderboltOutlined, SendOutlined, MessageOutlined,
  CodeOutlined, HistoryOutlined, CloseCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import useAgentStore from '../../../../stores/agentStore';
import './ApiAccessDrawer.less';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;
const { TextArea } = Input;

const ApiAccessDrawer = ({ open, onClose, workflow }) => {
  const {
    apiKeyInfo, apiKeyLoading, apiKeyLogs, apiKeyLogsLoading,
    fetchApiKey, createApiKey, updateApiKeyConfig, deleteApiKey, fetchApiKeyLogs
  } = useAgentStore();

  const [showFullKey, setShowFullKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [configForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && workflow?.id) {
      fetchApiKey(workflow.id);
      setNewApiKey(null);
      setShowFullKey(false);
    }
  }, [open, workflow?.id]);

  useEffect(() => {
    if (apiKeyInfo) {
      configForm.setFieldsValue({
        rate_limit_per_minute: apiKeyInfo.rate_limit_per_minute || 10,
        ip_whitelist: (apiKeyInfo.ip_whitelist || []).join('\n'),
        expires_at: apiKeyInfo.expires_at ? dayjs(apiKeyInfo.expires_at) : null,
        max_calls: apiKeyInfo.max_calls || null
      });
    }
  }, [apiKeyInfo, configForm]);

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
          const result = await createApiKey(workflow.id, true);
          if (result?.api_key) {
            setNewApiKey(result.api_key);
            setShowFullKey(true);
            fetchApiKey(workflow.id);
          }
        }
      });
    } else {
      const result = await createApiKey(workflow.id, false);
      if (result?.api_key) {
        setNewApiKey(result.api_key);
        setShowFullKey(true);
        fetchApiKey(workflow.id);
      }
    }
  }, [workflow?.id, createApiKey, fetchApiKey]);

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
        await deleteApiKey(workflow.id);
        setNewApiKey(null);
        setShowFullKey(false);
      }
    });
  }, [workflow?.id, deleteApiKey]);

  /* 保存访问控制配置 */
  const handleSaveConfig = useCallback(async (values) => {
    setSaving(true);
    try {
      const config = {
        rate_limit_per_minute: values.rate_limit_per_minute,
        ip_whitelist: values.ip_whitelist
          ? values.ip_whitelist.split('\n').map(ip => ip.trim()).filter(Boolean)
          : [],
        expires_at: values.expires_at ? values.expires_at.format('YYYY-MM-DD HH:mm:ss') : null,
        max_calls: values.max_calls || null
      };
      await updateApiKeyConfig(workflow.id, config);
      message.success('配置已保存');
    } catch (error) { /* store已处理 */ }
    finally { setSaving(false); }
  }, [workflow?.id, updateApiKeyConfig]);

  /* 复制到剪贴板 */
  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      /* 降级方案 */
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success('已复制到剪贴板');
    });
  }, []);

  /* API基地址 */
  const getApiBaseUrl = () => `${window.location.origin}/api/v1/agent`;

  /**
   * v2.0 通用代码块组件 - 统一一键复制按钮
   */
  const CodeBlock = ({ code, maxHeight = 220 }) => (
    <div className="api-code-block" style={{ maxHeight }}>
      <Button
        size="small"
        icon={<CopyOutlined />}
        className="api-copy-btn"
        onClick={() => handleCopy(code)}
      />
      {code}
    </div>
  );

  /* ========== API Key 面板 ========== */
  const renderKeyPanel = () => (
    <div>
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
                <Button type="primary" icon={<CopyOutlined />} onClick={() => handleCopy(newApiKey)}>复制</Button>
              </div>
            </div>
          }
        />
      )}

      {apiKeyLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : apiKeyInfo ? (
        <>
          <div className="api-key-card">
            <div className="api-key-header">
              <span className="api-key-value">{apiKeyInfo.api_key_masked}</span>
              <Tag color={apiKeyInfo.status === 'active' ? 'success' : 'error'} style={{ borderRadius: 6, fontWeight: 600 }}>
                {apiKeyInfo.status === 'active' ? '已启用' : '已停用'}
              </Tag>
            </div>
            <div className="api-key-meta">
              <span className="meta-item"><ClockCircleOutlined /> 创建于 {dayjs(apiKeyInfo.created_at).format('YYYY-MM-DD HH:mm')}</span>
              {apiKeyInfo.expires_at && (
                <span className="meta-item"><ExclamationCircleOutlined /> 到期 {dayjs(apiKeyInfo.expires_at).format('YYYY-MM-DD')}</span>
              )}
            </div>
          </div>

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
              <div className="stat-value">{apiKeyInfo.last_called_at ? dayjs(apiKeyInfo.last_called_at).fromNow() : '暂无'}</div>
              <div className="stat-label">最后调用</div>
            </div>
          </div>

          <div className="api-actions">
            <Button icon={<ReloadOutlined />} onClick={() => handleGenerateKey(true)}>重新生成</Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleDeleteKey}>删除</Button>
          </div>
        </>
      ) : (
        <div className="api-empty-state">
          <div className="api-empty-icon"><KeyOutlined /></div>
          <div className="api-empty-title">开启外部API接入</div>
          <div className="api-empty-desc">生成API Key后，外部系统可通过HTTP接口调用此工作流</div>
          <Button type="primary" icon={<KeyOutlined />} onClick={() => handleGenerateKey(false)}>生成 API Key</Button>
          <div className="api-empty-hint">发布工作流时也会自动生成</div>
        </div>
      )}
    </div>
  );

  /* ========== 访问控制 ========== */
  const renderAccessControl = () => (
    <div>
      {!apiKeyInfo && (
        <Alert type="info" message="请先生成API Key后再配置" showIcon className="api-access-alert" />
      )}
      <Form form={configForm} layout="vertical" onFinish={handleSaveConfig} disabled={!apiKeyInfo} className="api-access-form">
        <Form.Item label="频率限制" name="rate_limit_per_minute" tooltip="每分钟最大调用次数，0表示不限制">
          <InputNumber min={0} max={1000} style={{ width: '100%' }} placeholder="默认10" addonAfter="次/分钟" />
        </Form.Item>
        <Form.Item label="IP白名单" name="ip_whitelist" tooltip="每行一个IP，为空不限制">
          <TextArea rows={3} placeholder={"每行一个IP地址\n192.168.1.100\n10.0.0.1"} />
        </Form.Item>
        <Form.Item label="有效期" name="expires_at" tooltip="过期后API Key自动失效">
          <DatePicker showTime style={{ width: '100%' }} placeholder="不设置则永久有效" />
        </Form.Item>
        <Form.Item label="调用次数上限" name="max_calls" tooltip="累计达到此数后自动停用">
          <InputNumber min={0} max={10000000} style={{ width: '100%' }} placeholder="不设置则不限制" addonAfter="次" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} disabled={!apiKeyInfo} block className="api-save-btn">保存配置</Button>
      </Form>
    </div>
  );

  /* ========== 接入文档 v2.0 ========== */
  const renderDocs = () => {
    const baseUrl = getApiBaseUrl();
    return (
      <div className="api-docs">
        {/* 概述 */}
        <div className="api-docs-section">
          <div className="api-docs-title"><InfoCircleOutlined style={{ color: '#1890ff' }} /> 接口概述</div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
            <p style={{ margin: '0 0 8px' }}>所有接口采用 <Text strong>同步请求-响应</Text> 模式，工作流执行完成后一次性返回结果。</p>
            <p style={{ margin: '0 0 8px' }}>认证方式：在请求头中携带 <Text code>Authorization: Bearer YOUR_API_KEY</Text></p>
            <p style={{ margin: '0 0 8px' }}>内容类型：<Text code>Content-Type: application/json</Text></p>
            <p style={{ margin: '0 0 4px' }}>基础地址：<Text code copyable={{ onCopy: () => handleCopy(baseUrl) }}>{baseUrl}</Text></p>
          </div>
          <Alert
            type="info"
            showIcon
            icon={<ClockCircleOutlined />}
            style={{ marginTop: 12, borderRadius: 8 }}
            message="超时建议：工作流包含多个AI节点时执行可能需要 10-60 秒，建议客户端设置至少 120 秒超时。"
          />
        </div>

        {/* ===== 1. 一次性执行 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><SendOutlined style={{ color: '#1890ff' }} /> 1. 一次性执行</div>
          <div className="api-docs-endpoint">POST {baseUrl}/run</div>
          <div className="api-docs-desc">执行一次工作流，返回最终结果。适合单次问答、数据处理等场景。</div>

          <Text strong style={{ display: 'block', margin: '10px 0 6px', fontSize: 13 }}>请求参数</Text>
          <Descriptions column={1} size="small" bordered className="api-params-table">
            <Descriptions.Item label="query"><Text code>string</Text> 必填 — 用户输入的问题或指令</Descriptions.Item>
            <Descriptions.Item label="variables"><Text code>object</Text> 可选 — 额外变量，会合并到工作流输入</Descriptions.Item>
          </Descriptions>

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>cURL 示例</Text>
          <CodeBlock code={`curl -X POST ${baseUrl}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "你好，请介绍一下你自己"}'`} />

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>成功响应</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "output": "你好！我是AI助手，很高兴为你服务...",
    "credits_used": 10,
    "execution_id": 123,
    "duration_ms": 2500
  }
}`} />
        </div>

        {/* ===== 2. 多轮对话 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><MessageOutlined style={{ color: '#722ed1' }} /> 2. 多轮对话</div>
          <div className="api-docs-endpoint">POST {baseUrl}/chat</div>
          <div className="api-docs-desc">创建或继续对话会话。首次不传 session_id 自动创建，后续携带 session_id 继续对话。</div>

          <Text strong style={{ display: 'block', margin: '10px 0 6px', fontSize: 13 }}>请求参数</Text>
          <Descriptions column={1} size="small" bordered className="api-params-table">
            <Descriptions.Item label="message"><Text code>string</Text> 必填 — 用户消息内容</Descriptions.Item>
            <Descriptions.Item label="session_id"><Text code>string</Text> 可选 — 会话ID，不传则自动创建新会话</Descriptions.Item>
          </Descriptions>

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>cURL 示例</Text>
          <CodeBlock code={`# 首次调用（自动创建会话）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "你好"}'

# 后续调用（携带 session_id 继续对话）
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "返回的session_id", "message": "继续聊"}'`} />

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>成功响应</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "session_id": "sess_abc123",
    "reply": "你好！有什么我可以帮助你的？",
    "credits_used": 10,
    "message_count": 2,
    "duration_ms": 1800
  }
}`} />
        </div>

        {/* ===== 3. 获取对话历史 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><HistoryOutlined style={{ color: '#52c41a' }} /> 3. 获取对话历史</div>
          <div className="api-docs-endpoint">GET {baseUrl}/chat/:session_id</div>
          <div className="api-docs-desc">获取指定会话的完整对话记录。会话默认 30 分钟后自动过期。</div>

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>cURL 示例</Text>
          <CodeBlock code={`curl -X GET ${baseUrl}/chat/sess_abc123 \\
  -H "Authorization: Bearer YOUR_API_KEY"`} />

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>成功响应</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "session_id": "sess_abc123",
    "messages": [
      { "role": "user", "content": "你好", "timestamp": 1710600000000 },
      { "role": "assistant", "content": "你好！有什么可以帮你？", "timestamp": 1710600002000 }
    ],
    "message_count": 2
  }
}`} />
        </div>

        {/* ===== 4. 结束对话会话 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><CloseCircleOutlined style={{ color: '#ff4d4f' }} /> 4. 结束对话会话</div>
          <div className="api-docs-endpoint">DELETE {baseUrl}/chat/:session_id</div>
          <div className="api-docs-desc">主动结束会话，释放服务端资源。不调用也会在 30 分钟后自动过期清理。</div>

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>cURL 示例</Text>
          <CodeBlock code={`curl -X DELETE ${baseUrl}/chat/sess_abc123 \\
  -H "Authorization: Bearer YOUR_API_KEY"`} />
        </div>

        {/* ===== Python 示例 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><CodeOutlined style={{ color: '#52c41a' }} /> Python 完整示例</div>
          <CodeBlock maxHeight={360} code={`import requests

API_KEY = "YOUR_API_KEY"
BASE = "${baseUrl}"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# ===== 一次性执行 =====
resp = requests.post(
    f"{BASE}/run",
    headers=HEADERS,
    json={"query": "帮我总结一下今天的工作"},
    timeout=120  # 建议至少120秒
)
data = resp.json()
if data["success"]:
    print(f"回复: {data['data']['output']}")
    print(f"消耗积分: {data['data']['credits_used']}")

# ===== 多轮对话 =====
session_id = None
while True:
    msg = input("你: ")
    if msg.lower() in ("quit", "exit", "q"):
        # 结束会话
        if session_id:
            requests.delete(
                f"{BASE}/chat/{session_id}",
                headers=HEADERS
            )
            print("会话已结束")
        break

    body = {"message": msg}
    if session_id:
        body["session_id"] = session_id

    r = requests.post(
        f"{BASE}/chat",
        headers=HEADERS,
        json=body,
        timeout=120
    )
    d = r.json()["data"]
    session_id = d["session_id"]
    print(f"AI: {d['reply']}")
    print(f"  (积分: {d['credits_used']}, 耗时: {d['duration_ms']}ms)")`} />
        </div>

        {/* ===== JavaScript/Node.js 示例 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><CodeOutlined style={{ color: '#faad14' }} /> JavaScript / Node.js 示例</div>
          <CodeBlock maxHeight={320} code={`const API_KEY = "YOUR_API_KEY";
const BASE = "${baseUrl}";
const headers = {
  "Authorization": \`Bearer \${API_KEY}\`,
  "Content-Type": "application/json"
};

// ===== 一次性执行 =====
async function run(query) {
  const resp = await fetch(\`\${BASE}/run\`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120000) // 120秒超时
  });
  const data = await resp.json();
  if (data.success) {
    console.log("回复:", data.data.output);
    console.log("积分:", data.data.credits_used);
  }
  return data;
}

// ===== 多轮对话 =====
async function chat(message, sessionId = null) {
  const body = { message };
  if (sessionId) body.session_id = sessionId;

  const resp = await fetch(\`\${BASE}/chat\`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const data = await resp.json();
  return data.data; // { session_id, reply, credits_used }
}

// 使用示例
run("你好，请介绍一下你自己");`} />
        </div>

        {/* ===== 错误码 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><ExclamationCircleOutlined style={{ color: '#ff4d4f' }} /> 错误码说明</div>
          <Descriptions column={1} size="small" bordered className="api-error-table">
            <Descriptions.Item label="400">请求参数缺失或格式错误（缺少 query/message）</Descriptions.Item>
            <Descriptions.Item label="401">API Key 缺失、无效或格式错误</Descriptions.Item>
            <Descriptions.Item label="402">工作流创建者积分不足（积分消耗归属工作流创建者）</Descriptions.Item>
            <Descriptions.Item label="403">工作流未发布 / IP 不在白名单 / Key 已过期 / 调用次数超限</Descriptions.Item>
            <Descriptions.Item label="404">对话会话不存在或已过期（30分钟自动清理）</Descriptions.Item>
            <Descriptions.Item label="429">调用频率超过限制（默认 10 次/分钟，可在访问控制中配置）</Descriptions.Item>
            <Descriptions.Item label="500">工作流内部执行错误（节点配置问题等）</Descriptions.Item>
          </Descriptions>

          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>错误响应格式</Text>
          <CodeBlock code={`{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "积分不足，请联系工作流创建者充值"
  }
}`} />
        </div>

        {/* ===== 注意事项 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title"><InfoCircleOutlined style={{ color: '#8c8c8c' }} /> 注意事项</div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 2 }}>
            <p style={{ margin: 0 }}>1. 当前为 <Text strong>同步模式</Text>，请求会等待工作流执行完成后返回，建议设置 120 秒以上超时</p>
            <p style={{ margin: 0 }}>2. 积分消耗归属 <Text strong>工作流创建者</Text>，非 API 调用方</p>
            <p style={{ margin: 0 }}>3. 多轮对话的会话存储在内存中，<Text strong>30 分钟无活动自动过期</Text></p>
            <p style={{ margin: 0 }}>4. API Key 请妥善保管，泄露后请立即重新生成</p>
            <p style={{ margin: 0 }}>5. 工作流必须处于 <Text strong>已发布</Text> 状态才能通过外部 API 调用</p>
          </div>
        </div>
      </div>
    );
  };

  /* ========== 调用日志 ========== */
  const renderLogs = () => {
    const columns = [
      { title: '时间', dataIndex: 'created_at', width: 140, render: (t) => dayjs(t).format('MM-DD HH:mm:ss') },
      { title: '类型', dataIndex: 'call_type', width: 65, render: (t) => <Tag color={t === 'run' ? 'blue' : 'purple'} style={{ borderRadius: 4 }}>{t === 'run' ? '执行' : '对话'}</Tag> },
      { title: '状态', dataIndex: 'status', width: 65, render: (s) => <Tag color={s === 'success' ? 'success' : 'error'} style={{ borderRadius: 4 }}>{s === 'success' ? '成功' : '失败'}</Tag> },
      { title: '积分', dataIndex: 'credits_used', width: 55, render: (v) => <Text strong>{v || 0}</Text> },
      { title: '耗时', dataIndex: 'duration_ms', width: 65, render: (d) => d ? <Text type="secondary">{(d / 1000).toFixed(1)}s</Text> : '-' },
      { title: 'IP', dataIndex: 'caller_ip', width: 110, ellipsis: true, render: (ip) => <Text code style={{ fontSize: 11 }}>{ip || '-'}</Text> }
    ];

    return (
      <div className="api-logs">
        <div className="api-logs-header">
          <Text type="secondary" style={{ fontSize: 13 }}>
            {apiKeyLogs?.pagination?.total ? `共 ${apiKeyLogs.pagination.total} 条记录` : '暂无记录'}
          </Text>
          <Button onClick={() => fetchApiKeyLogs(workflow.id)} icon={<ReloadOutlined />} size="small">刷新</Button>
        </div>
        <Table
          columns={columns}
          dataSource={apiKeyLogs?.logs || []}
          rowKey="id"
          size="small"
          loading={apiKeyLogsLoading}
          pagination={{ size: 'small', total: apiKeyLogs?.pagination?.total || 0, pageSize: 20, showTotal: (t) => `${t}条` }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" /> }}
        />
      </div>
    );
  };

  return (
    <Drawer
      title={
        <Space>
          <ApiOutlined style={{ color: '#1890ff' }} />
          <span style={{ fontWeight: 600 }}>API 接入</span>
          {workflow && <Tag style={{ borderRadius: 6, fontWeight: 500 }}>{workflow.name}</Tag>}
        </Space>
      }
      placement="right"
      width={620}
      onClose={onClose}
      open={open}
      className="api-drawer"
    >
      <Tabs
        defaultActiveKey="key"
        size="small"
        items={[
          { key: 'key', label: <span><KeyOutlined /> 密钥</span>, children: renderKeyPanel() },
          { key: 'access', label: <span><SafetyOutlined /> 访问控制</span>, children: renderAccessControl() },
          { key: 'docs', label: <span><BookOutlined /> 接入文档</span>, children: renderDocs() },
          { key: 'logs', label: <span><BarChartOutlined /> 调用日志</span>, children: renderLogs() }
        ]}
      />
    </Drawer>
  );
};

export default ApiAccessDrawer;
