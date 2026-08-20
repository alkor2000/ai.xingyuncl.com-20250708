/**
 * API接入管理抽屉组件 v2.1
 *
 * v2.0 优化：
 * - 接入文档全面完善：4个端点全覆盖 + 请求参数表格 + 完整请求/响应示例
 * - 每个代码块统一一键复制按钮
 * - 新增 JavaScript/Node.js 示例
 * - 新增获取对话历史 + 结束会话文档
 * - 标注同步模式说明和超时建议
 *
 * v2.1 国际化改造 + 一处全局 Bug 修复：
 * 【Bug 修复】原代码在模块顶层写死 dayjs.locale('zh-cn')。
 *   dayjs.locale() 是全局设置而非实例级设置，只要本文件被加载（打开编辑器即会加载），
 *   整个应用的 dayjs 语言就被永久锁定为中文，导致 WorkflowList 等其他组件
 *   在英文环境下的相对时间（如 "2 days ago"）仍然显示为中文"2 天前"。
 *   现改为在组件内 useEffect 中根据 i18n.language 动态设置，与 WorkflowList 保持一致口径。
 * 【国际化】接入 useTranslation，约 129 处硬编码中文全部替换为 agent.api.* 翻译键。
 *   代码示例（cURL / Python / JS）的代码本体保持原样不翻译，
 *   仅其中的注释与输出提示文字走 i18n，符合开发者文档通行做法。
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
import 'dayjs/locale/en';
import { useTranslation } from 'react-i18next';
import useAgentStore from '../../../../stores/agentStore';
import './ApiAccessDrawer.less';

/* 仅注册插件，不在模块层设置全局语言（避免污染其他组件） */
dayjs.extend(relativeTime);

const { Text } = Typography;
const { TextArea } = Input;

/** 每页日志条数 */
const LOGS_PAGE_SIZE = 20;

const ApiAccessDrawer = ({ open, onClose, workflow }) => {
  const { t, i18n } = useTranslation();

  const {
    apiKeyInfo, apiKeyLoading, apiKeyLogs, apiKeyLogsLoading,
    fetchApiKey, createApiKey, updateApiKeyConfig, deleteApiKey, fetchApiKeyLogs
  } = useAgentStore();

  const [showFullKey, setShowFullKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [configForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  /**
   * dayjs 语言跟随 i18n 设置
   * 修复原先在模块顶层写死 zh-cn 导致的全局语言污染问题
   */
  useEffect(() => {
    const lang = i18n.language || 'zh-CN';
    dayjs.locale(lang.startsWith('zh') ? 'zh-cn' : 'en');
  }, [i18n.language]);

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

  /* 生成 / 重新生成 API Key */
  const handleGenerateKey = useCallback(async (regenerate = false) => {
    if (regenerate) {
      Modal.confirm({
        title: t('agent.api.confirmRegenTitle'),
        icon: <ExclamationCircleOutlined />,
        content: t('agent.api.confirmRegenContent'),
        okText: t('agent.api.confirmOk'),
        okType: 'danger',
        cancelText: t('agent.api.confirmCancel'),
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
  }, [workflow?.id, createApiKey, fetchApiKey, t]);

  /* 删除 API Key */
  const handleDeleteKey = useCallback(() => {
    Modal.confirm({
      title: t('agent.api.confirmDeleteTitle'),
      icon: <ExclamationCircleOutlined />,
      content: t('agent.api.confirmDeleteContent'),
      okText: t('agent.api.confirmDeleteOk'),
      okType: 'danger',
      cancelText: t('agent.api.confirmCancel'),
      onOk: async () => {
        await deleteApiKey(workflow.id);
        setNewApiKey(null);
        setShowFullKey(false);
      }
    });
  }, [workflow?.id, deleteApiKey, t]);

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
      message.success(t('agent.api.configSaved'));
    } catch (error) {
      /* 错误提示由 store 层统一处理 */
    } finally {
      setSaving(false);
    }
  }, [workflow?.id, updateApiKeyConfig, t]);

  /* 复制到剪贴板（含降级方案） */
  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('agent.api.copied'));
    }).catch(() => {
      /* 部分浏览器或非 HTTPS 环境下 clipboard API 不可用，降级为 execCommand */
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      message.success(t('agent.api.copied'));
    });
  }, [t]);

  /* API 基地址 */
  const getApiBaseUrl = () => `${window.location.origin}/api/v1/agent`;

  /**
   * 通用代码块组件 - 统一一键复制按钮
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
          message={t('agent.api.newKeyTitle')}
          description={
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('agent.api.newKeyDesc')}
              </Text>
              <div className="api-new-key-row">
                <Input.Password
                  value={newApiKey}
                  readOnly
                  visibilityToggle={{ visible: showFullKey, onVisibleChange: setShowFullKey }}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(newApiKey)}
                >
                  {t('agent.api.copy')}
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
          {/* 密钥卡片：脱敏密钥 + 状态 + 创建/到期时间 */}
          <div className="api-key-card">
            <div className="api-key-header">
              <span className="api-key-value">{apiKeyInfo.api_key_masked}</span>
              <Tag
                color={apiKeyInfo.status === 'active' ? 'success' : 'error'}
                style={{ borderRadius: 6, fontWeight: 600 }}
              >
                {apiKeyInfo.status === 'active'
                  ? t('agent.api.statusActive')
                  : t('agent.api.statusInactive')}
              </Tag>
            </div>
            <div className="api-key-meta">
              <span className="meta-item">
                <ClockCircleOutlined />{' '}
                {t('agent.api.createdAt', {
                  time: dayjs(apiKeyInfo.created_at).format('YYYY-MM-DD HH:mm')
                })}
              </span>
              {apiKeyInfo.expires_at && (
                <span className="meta-item">
                  <ExclamationCircleOutlined />{' '}
                  {t('agent.api.expireAt', {
                    time: dayjs(apiKeyInfo.expires_at).format('YYYY-MM-DD')
                  })}
                </span>
              )}
            </div>
          </div>

          {/* 统计卡片：总调用 / 消耗积分 / 最后调用 */}
          <div className="api-stats-grid">
            <div className="api-stat-card calls">
              <span className="stat-icon"><ThunderboltOutlined /></span>
              <div className="stat-value">{apiKeyInfo.total_calls || 0}</div>
              <div className="stat-label">{t('agent.api.statTotalCalls')}</div>
            </div>
            <div className="api-stat-card credits">
              <span className="stat-icon"><BarChartOutlined /></span>
              <div className="stat-value">{apiKeyInfo.total_credits_used || 0}</div>
              <div className="stat-label">{t('agent.api.statCredits')}</div>
            </div>
            <div className="api-stat-card time">
              <span className="stat-icon"><ClockCircleOutlined /></span>
              <div className="stat-value">
                {apiKeyInfo.last_called_at
                  ? dayjs(apiKeyInfo.last_called_at).fromNow()
                  : t('agent.api.statNever')}
              </div>
              <div className="stat-label">{t('agent.api.statLastCall')}</div>
            </div>
          </div>

          <div className="api-actions">
            <Button icon={<ReloadOutlined />} onClick={() => handleGenerateKey(true)}>
              {t('agent.api.regenerate')}
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleDeleteKey}>
              {t('agent.api.delete')}
            </Button>
          </div>
        </>
      ) : (
        /* 空状态：尚未生成 API Key */
        <div className="api-empty-state">
          <div className="api-empty-icon"><KeyOutlined /></div>
          <div className="api-empty-title">{t('agent.api.emptyTitle')}</div>
          <div className="api-empty-desc">{t('agent.api.emptyDesc')}</div>
          <Button
            type="primary"
            icon={<KeyOutlined />}
            onClick={() => handleGenerateKey(false)}
          >
            {t('agent.api.generateKey')}
          </Button>
          <div className="api-empty-hint">{t('agent.api.emptyHint')}</div>
        </div>
      )}
    </div>
  );

  /* ========== 访问控制 ========== */
  const renderAccessControl = () => (
    <div>
      {!apiKeyInfo && (
        <Alert
          type="info"
          message={t('agent.api.needKeyFirst')}
          showIcon
          className="api-access-alert"
        />
      )}
      <Form
        form={configForm}
        layout="vertical"
        onFinish={handleSaveConfig}
        disabled={!apiKeyInfo}
        className="api-access-form"
      >
        <Form.Item
          label={t('agent.api.rateLimit')}
          name="rate_limit_per_minute"
          tooltip={t('agent.api.rateLimitTip')}
        >
          <InputNumber
            min={0}
            max={1000}
            style={{ width: '100%' }}
            placeholder={t('agent.api.rateLimitPlaceholder')}
            addonAfter={t('agent.api.rateLimitUnit')}
          />
        </Form.Item>

        <Form.Item
          label={t('agent.api.ipWhitelist')}
          name="ip_whitelist"
          tooltip={t('agent.api.ipWhitelistTip')}
        >
          <TextArea
            rows={3}
            placeholder={`${t('agent.api.ipWhitelistPlaceholder')}\n192.168.1.100\n10.0.0.1`}
          />
        </Form.Item>

        <Form.Item
          label={t('agent.api.expiresAt')}
          name="expires_at"
          tooltip={t('agent.api.expiresAtTip')}
        >
          <DatePicker
            showTime
            style={{ width: '100%' }}
            placeholder={t('agent.api.expiresAtPlaceholder')}
          />
        </Form.Item>

        <Form.Item
          label={t('agent.api.maxCalls')}
          name="max_calls"
          tooltip={t('agent.api.maxCallsTip')}
        >
          <InputNumber
            min={0}
            max={10000000}
            style={{ width: '100%' }}
            placeholder={t('agent.api.maxCallsPlaceholder')}
            addonAfter={t('agent.api.timesUnit')}
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          loading={saving}
          disabled={!apiKeyInfo}
          block
          className="api-save-btn"
        >
          {t('agent.api.saveConfig')}
        </Button>
      </Form>
    </div>
  );

  /* ========== 接入文档 ========== */
  const renderDocs = () => {
    const baseUrl = getApiBaseUrl();

    /* 小标题统一样式 */
    const subTitleStyle = { display: 'block', margin: '12px 0 6px', fontSize: 13 };
    const firstSubTitleStyle = { display: 'block', margin: '10px 0 6px', fontSize: 13 };

    return (
      <div className="api-docs">
        {/* ===== 概述 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <InfoCircleOutlined style={{ color: '#1890ff' }} /> {t('agent.api.docsOverview')}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
            <p style={{ margin: '0 0 8px' }}>{t('agent.api.docsOverviewMode')}</p>
            <p style={{ margin: '0 0 8px' }}>
              {t('agent.api.docsOverviewAuth')}{' '}
              <Text code>Authorization: Bearer YOUR_API_KEY</Text>
            </p>
            <p style={{ margin: '0 0 8px' }}>
              {t('agent.api.docsOverviewContentType')}{' '}
              <Text code>Content-Type: application/json</Text>
            </p>
            <p style={{ margin: '0 0 4px' }}>
              {t('agent.api.docsOverviewBaseUrl')}{' '}
              <Text code copyable={{ onCopy: () => handleCopy(baseUrl) }}>{baseUrl}</Text>
            </p>
          </div>
          <Alert
            type="info"
            showIcon
            icon={<ClockCircleOutlined />}
            style={{ marginTop: 12, borderRadius: 8 }}
            message={t('agent.api.docsTimeoutTip')}
          />
        </div>

        {/* ===== 1. 一次性执行 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <SendOutlined style={{ color: '#1890ff' }} /> {t('agent.api.docsRunTitle')}
          </div>
          <div className="api-docs-endpoint">POST {baseUrl}/run</div>
          <div className="api-docs-desc">{t('agent.api.docsRunDesc')}</div>

          <Text strong style={firstSubTitleStyle}>{t('agent.api.docsReqParams')}</Text>
          <Descriptions column={1} size="small" bordered className="api-params-table">
            <Descriptions.Item label="query">
              <Text code>string</Text> {t('agent.api.docsRequired')} — {t('agent.api.docsRunParamQuery')}
            </Descriptions.Item>
            <Descriptions.Item label="variables">
              <Text code>object</Text> {t('agent.api.docsOptional')} — {t('agent.api.docsRunParamVariables')}
            </Descriptions.Item>
          </Descriptions>

          <Text strong style={subTitleStyle}>{t('agent.api.docsCurlExample')}</Text>
          <CodeBlock code={`curl -X POST ${baseUrl}/run \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "${t('agent.api.codeSampleQuery')}"}'`} />

          <Text strong style={subTitleStyle}>{t('agent.api.docsSuccessResp')}</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "output": "...",
    "credits_used": 10,
    "execution_id": 123,
    "duration_ms": 2500
  }
}`} />
        </div>

        {/* ===== 2. 多轮对话 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <MessageOutlined style={{ color: '#722ed1' }} /> {t('agent.api.docsChatTitle')}
          </div>
          <div className="api-docs-endpoint">POST {baseUrl}/chat</div>
          <div className="api-docs-desc">{t('agent.api.docsChatDesc')}</div>

          <Text strong style={firstSubTitleStyle}>{t('agent.api.docsReqParams')}</Text>
          <Descriptions column={1} size="small" bordered className="api-params-table">
            <Descriptions.Item label="message">
              <Text code>string</Text> {t('agent.api.docsRequired')} — {t('agent.api.docsChatParamMessage')}
            </Descriptions.Item>
            <Descriptions.Item label="session_id">
              <Text code>string</Text> {t('agent.api.docsOptional')} — {t('agent.api.docsChatParamSession')}
            </Descriptions.Item>
          </Descriptions>

          <Text strong style={subTitleStyle}>{t('agent.api.docsCurlExample')}</Text>
          <CodeBlock code={`# ${t('agent.api.docsChatCommentFirst')}
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "${t('agent.api.codeSampleHello')}"}'

# ${t('agent.api.docsChatCommentNext')}
curl -X POST ${baseUrl}/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "${t('agent.api.codeSampleSessionId')}", "message": "${t('agent.api.codeSampleContinue')}"}'`} />

          <Text strong style={subTitleStyle}>{t('agent.api.docsSuccessResp')}</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "session_id": "sess_abc123",
    "reply": "...",
    "credits_used": 10,
    "message_count": 2,
    "duration_ms": 1800
  }
}`} />
        </div>

        {/* ===== 3. 获取对话历史 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <HistoryOutlined style={{ color: '#52c41a' }} /> {t('agent.api.docsHistoryTitle')}
          </div>
          <div className="api-docs-endpoint">GET {baseUrl}/chat/:session_id</div>
          <div className="api-docs-desc">{t('agent.api.docsHistoryDesc')}</div>

          <Text strong style={subTitleStyle}>{t('agent.api.docsCurlExample')}</Text>
          <CodeBlock code={`curl -X GET ${baseUrl}/chat/sess_abc123 \\
  -H "Authorization: Bearer YOUR_API_KEY"`} />

          <Text strong style={subTitleStyle}>{t('agent.api.docsSuccessResp')}</Text>
          <CodeBlock code={`{
  "success": true,
  "data": {
    "session_id": "sess_abc123",
    "messages": [
      { "role": "user", "content": "...", "timestamp": 1710600000000 },
      { "role": "assistant", "content": "...", "timestamp": 1710600002000 }
    ],
    "message_count": 2
  }
}`} />
        </div>

        {/* ===== 4. 结束对话会话 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> {t('agent.api.docsEndTitle')}
          </div>
          <div className="api-docs-endpoint">DELETE {baseUrl}/chat/:session_id</div>
          <div className="api-docs-desc">{t('agent.api.docsEndDesc')}</div>

          <Text strong style={subTitleStyle}>{t('agent.api.docsCurlExample')}</Text>
          <CodeBlock code={`curl -X DELETE ${baseUrl}/chat/sess_abc123 \\
  -H "Authorization: Bearer YOUR_API_KEY"`} />
        </div>

        {/* ===== Python 示例 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <CodeOutlined style={{ color: '#52c41a' }} /> {t('agent.api.docsPythonTitle')}
          </div>
          <CodeBlock maxHeight={360} code={`import requests

API_KEY = "YOUR_API_KEY"
BASE = "${baseUrl}"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# ===== ${t('agent.api.codeCommentRun')} =====
resp = requests.post(
    f"{BASE}/run",
    headers=HEADERS,
    json={"query": "${t('agent.api.codeSampleQuery2')}"},
    timeout=120  # ${t('agent.api.codeCommentTimeout')}
)
data = resp.json()
if data["success"]:
    print(f"${t('agent.api.codeLabelReply')}: {data['data']['output']}")
    print(f"${t('agent.api.codeLabelCreditsUsed')}: {data['data']['credits_used']}")

# ===== ${t('agent.api.codeCommentChat')} =====
session_id = None
while True:
    msg = input("${t('agent.api.codePromptUser')}")
    if msg.lower() in ("quit", "exit", "q"):
        # ${t('agent.api.codeCommentEndSession')}
        if session_id:
            requests.delete(
                f"{BASE}/chat/{session_id}",
                headers=HEADERS
            )
            print("${t('agent.api.codeLabelSessionEnded')}")
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
    print(f"  (${t('agent.api.codeLabelCredits')}: {d['credits_used']}, ${t('agent.api.codeLabelDuration')}: {d['duration_ms']}ms)")`} />
        </div>

        {/* ===== JavaScript / Node.js 示例 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <CodeOutlined style={{ color: '#faad14' }} /> {t('agent.api.docsJsTitle')}
          </div>
          <CodeBlock maxHeight={320} code={`const API_KEY = "YOUR_API_KEY";
const BASE = "${baseUrl}";
const headers = {
  "Authorization": \`Bearer \${API_KEY}\`,
  "Content-Type": "application/json"
};

// ===== ${t('agent.api.codeCommentRun')} =====
async function run(query) {
  const resp = await fetch(\`\${BASE}/run\`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120000) // ${t('agent.api.codeCommentTimeoutMs')}
  });
  const data = await resp.json();
  if (data.success) {
    console.log("${t('agent.api.codeLabelReply')}:", data.data.output);
    console.log("${t('agent.api.codeLabelCredits')}:", data.data.credits_used);
  }
  return data;
}

// ===== ${t('agent.api.codeCommentChat')} =====
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

// ${t('agent.api.codeCommentUsage')}
run("${t('agent.api.codeSampleQuery')}");`} />
        </div>

        {/* ===== 错误码 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} /> {t('agent.api.docsErrorTitle')}
          </div>
          <Descriptions column={1} size="small" bordered className="api-error-table">
            <Descriptions.Item label="400">{t('agent.api.docsError400')}</Descriptions.Item>
            <Descriptions.Item label="401">{t('agent.api.docsError401')}</Descriptions.Item>
            <Descriptions.Item label="402">{t('agent.api.docsError402')}</Descriptions.Item>
            <Descriptions.Item label="403">{t('agent.api.docsError403')}</Descriptions.Item>
            <Descriptions.Item label="404">{t('agent.api.docsError404')}</Descriptions.Item>
            <Descriptions.Item label="429">{t('agent.api.docsError429')}</Descriptions.Item>
            <Descriptions.Item label="500">{t('agent.api.docsError500')}</Descriptions.Item>
          </Descriptions>

          <Text strong style={subTitleStyle}>{t('agent.api.docsErrorFormat')}</Text>
          <CodeBlock code={`{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Insufficient credits"
  }
}`} />
        </div>

        {/* ===== 注意事项 ===== */}
        <div className="api-docs-section">
          <div className="api-docs-title">
            <InfoCircleOutlined style={{ color: '#8c8c8c' }} /> {t('agent.api.docsNoticeTitle')}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 2 }}>
            <p style={{ margin: 0 }}>{t('agent.api.docsNotice1')}</p>
            <p style={{ margin: 0 }}>{t('agent.api.docsNotice2')}</p>
            <p style={{ margin: 0 }}>{t('agent.api.docsNotice3')}</p>
            <p style={{ margin: 0 }}>{t('agent.api.docsNotice4')}</p>
            <p style={{ margin: 0 }}>{t('agent.api.docsNotice5')}</p>
          </div>
        </div>
      </div>
    );
  };

  /* ========== 调用日志 ========== */
  const renderLogs = () => {
    const columns = [
      {
        title: t('agent.api.logColTime'),
        dataIndex: 'created_at',
        width: 140,
        render: (val) => dayjs(val).format('MM-DD HH:mm:ss')
      },
      {
        title: t('agent.api.logColType'),
        dataIndex: 'call_type',
        width: 65,
        render: (val) => (
          <Tag color={val === 'run' ? 'blue' : 'purple'} style={{ borderRadius: 4 }}>
            {val === 'run' ? t('agent.api.logTypeRun') : t('agent.api.logTypeChat')}
          </Tag>
        )
      },
      {
        title: t('agent.api.logColStatus'),
        dataIndex: 'status',
        width: 65,
        render: (val) => (
          <Tag color={val === 'success' ? 'success' : 'error'} style={{ borderRadius: 4 }}>
            {val === 'success' ? t('agent.api.logStatusSuccess') : t('agent.api.logStatusFailed')}
          </Tag>
        )
      },
      {
        title: t('agent.api.logColCredits'),
        dataIndex: 'credits_used',
        width: 55,
        render: (val) => <Text strong>{val || 0}</Text>
      },
      {
        title: t('agent.api.logColDuration'),
        dataIndex: 'duration_ms',
        width: 65,
        render: (val) => val ? <Text type="secondary">{(val / 1000).toFixed(1)}s</Text> : '-'
      },
      {
        title: t('agent.api.logColIp'),
        dataIndex: 'caller_ip',
        width: 110,
        ellipsis: true,
        render: (ip) => <Text code style={{ fontSize: 11 }}>{ip || '-'}</Text>
      }
    ];

    return (
      <div className="api-logs">
        <div className="api-logs-header">
          <Text type="secondary" style={{ fontSize: 13 }}>
            {apiKeyLogs?.pagination?.total
              ? t('agent.api.logTotal', { count: apiKeyLogs.pagination.total })
              : t('agent.api.logEmpty')}
          </Text>
          <Button
            onClick={() => fetchApiKeyLogs(workflow.id)}
            icon={<ReloadOutlined />}
            size="small"
          >
            {t('agent.api.refresh')}
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
            pageSize: LOGS_PAGE_SIZE,
            showTotal: (total) => t('agent.api.logPageTotal', { count: total })
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('agent.api.logEmptyTable')}
              />
            )
          }}
        />
      </div>
    );
  };

  return (
    <Drawer
      title={
        <Space>
          <ApiOutlined style={{ color: '#1890ff' }} />
          <span style={{ fontWeight: 600 }}>{t('agent.api.drawerTitle')}</span>
          {workflow && (
            <Tag style={{ borderRadius: 6, fontWeight: 500 }}>{workflow.name}</Tag>
          )}
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
          {
            key: 'key',
            label: <span><KeyOutlined /> {t('agent.api.tabKey')}</span>,
            children: renderKeyPanel()
          },
          {
            key: 'access',
            label: <span><SafetyOutlined /> {t('agent.api.tabAccess')}</span>,
            children: renderAccessControl()
          },
          {
            key: 'docs',
            label: <span><BookOutlined /> {t('agent.api.tabDocs')}</span>,
            children: renderDocs()
          },
          {
            key: 'logs',
            label: <span><BarChartOutlined /> {t('agent.api.tabLogs')}</span>,
            children: renderLogs()
          }
        ]}
      />
    </Drawer>
  );
};

export default ApiAccessDrawer;
