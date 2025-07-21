/**
 * 自定义首页设置组件
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Row,
  Col,
  Switch,
  Button,
  Space,
  Alert,
  message,
  Spin
} from 'antd'
import {
  SaveOutlined,
  ReloadOutlined,
  EyeOutlined,
  LockOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import apiClient from '../../../utils/api'

const CustomHomepage = ({ disabled = false }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    enabled: false,
    content: '',
    updated_at: null
  })
  const [previewMode, setPreviewMode] = useState(false)

  // 加载配置
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/admin/settings/custom-homepage')
      
      if (response.data.success) {
        setConfig(response.data.data)
      }
    } catch (error) {
      message.error(t('admin.settings.customHomepage.loadError'))
    } finally {
      setLoading(false)
    }
  }

  // 保存配置
  const handleSave = async () => {
    try {
      setSaving(true)
      
      const response = await apiClient.put('/admin/settings/custom-homepage', {
        enabled: config.enabled,
        content: config.content
      })
      
      if (response.data.success) {
        message.success(t('admin.settings.save.success'))
        setConfig(response.data.data)
      }
    } catch (error) {
      message.error(t('admin.settings.save.failed'))
    } finally {
      setSaving(false)
    }
  }

  // 恢复默认
  const handleReset = () => {
    const defaultContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>欢迎使用AI平台</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            margin: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .login-button {
            background: #1890ff;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        .login-button:hover {
            background: #1677ff;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>欢迎使用AI平台</h1>
        <p>我们提供先进的人工智能服务，帮助您提升工作效率。请登录以开始使用。</p>
        <a href="/login" class="login-button">立即登录</a>
    </div>
</body>
</html>`
    
    setConfig({
      ...config,
      content: defaultContent
    })
    message.info(t('admin.settings.customHomepage.resetSuccess'))
  }

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      </Card>
    )
  }

  return (
    <>
      {disabled && (
        <Alert
          message={t('admin.settings.readOnlyMode')}
          description={t('admin.settings.readOnlyDescription')}
          type="warning"
          showIcon
          icon={<LockOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        title={
          <Space>
            <GlobalOutlined />
            <span>{t('admin.settings.customHomepage.title')}</span>
          </Space>
        }
        extra={
          <Space>
            <span>{t('admin.settings.customHomepage.enabled')}:</span>
            <Switch
              checked={config.enabled}
              onChange={(checked) => setConfig({ ...config, enabled: checked })}
              disabled={disabled}
            />
          </Space>
        }
      >
        <Alert
          message={t('admin.settings.customHomepage.tips')}
          description={t('admin.settings.customHomepage.description')}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Row gutter={16}>
          <Col span={previewMode ? 12 : 24}>
            <div style={{ marginBottom: 16 }}>
              <CodeMirror
                value={config.content}
                height="500px"
                extensions={[html()]}
                onChange={(value) => setConfig({ ...config, content: value })}
                editable={!disabled}
                theme="light"
              />
            </div>
          </Col>

          {previewMode && (
            <Col span={12}>
              <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '8px', background: '#fafafa', borderBottom: '1px solid #d9d9d9' }}>
                  <strong>{t('admin.settings.customHomepage.preview')}</strong>
                </div>
                <iframe
                  title="preview"
                  style={{
                    width: '100%',
                    height: '500px',
                    border: 'none',
                    background: '#fff'
                  }}
                  srcDoc={config.content}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                />
              </div>
            </Col>
          )}
        </Row>

        {!disabled && (
          <div style={{ marginTop: 16 }}>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                {t('admin.settings.save')}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleReset}
              >
                {t('admin.settings.customHomepage.reset')}
              </Button>
              <Button
                icon={<EyeOutlined />}
                onClick={() => setPreviewMode(!previewMode)}
              >
                {previewMode ? t('admin.settings.customHomepage.closePreview') : t('admin.settings.customHomepage.openPreview')}
              </Button>
            </Space>
          </div>
        )}

        {config.updated_at && (
          <div style={{ marginTop: 16, color: '#999', fontSize: '12px' }}>
            {t('admin.settings.customHomepage.lastUpdate')}: {new Date(config.updated_at).toLocaleString()}
          </div>
        )}
      </Card>
    </>
  )
}

export default CustomHomepage
