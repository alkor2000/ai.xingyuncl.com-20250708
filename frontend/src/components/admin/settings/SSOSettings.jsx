import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Form, 
  Input, 
  InputNumber, 
  Switch, 
  Button, 
  Space, 
  Alert, 
  message, 
  Spin,
  Select,
  Tooltip,
  Divider
} from 'antd';
import { 
  KeyOutlined, 
  ReloadOutlined, 
  SaveOutlined,
  InfoCircleOutlined,
  CopyOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;
const { Option } = Select;

const SSOSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState([]);
  const [ssoUrl, setSsoUrl] = useState('');

  useEffect(() => {
    loadSettings();
    loadGroups();
    generateSSOUrl();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/settings/sso');
      if (response.data && response.data.data) {
        form.setFieldsValue(response.data.data);
      }
    } catch (error) {
      console.error('Load SSO settings error:', error);
      message.error(t('admin.sso.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const response = await api.get('/admin/user-groups');
      // 修复：直接使用response.data.data作为数组
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        setGroups(response.data.data);
      } else {
        setGroups([]);
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
      setGroups([]);
    }
  };

  const generateSSOUrl = () => {
    const protocol = window.location.protocol;
    const host = window.location.host;
    setSsoUrl(`${protocol}//${host}/api/auth/sso`);
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      await api.put('/admin/settings/sso', values);
      message.success(t('admin.sso.saveSuccess'));
      // 重新加载设置以获取处理后的数据
      loadSettings();
    } catch (error) {
      console.error('Save SSO settings error:', error);
      message.error(t('admin.sso.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSecret = async () => {
    try {
      const response = await api.post('/admin/settings/sso/generate-secret');
      if (response.data && response.data.data && response.data.data.secret) {
        form.setFieldsValue({
          shared_secret: response.data.data.secret
        });
        message.success(t('admin.sso.secretGenerated'));
      }
    } catch (error) {
      console.error('Generate secret error:', error);
      message.error(t('admin.sso.secretGenerateError'));
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('admin.sso.copied'));
    }).catch(() => {
      message.error(t('admin.sso.copyError'));
    });
  };

  if (loading) {
    return (
      <Card>
        <Spin spinning={loading} tip={t('common.loading')}>
          <div style={{ minHeight: 200 }} />
        </Spin>
      </Card>
    );
  }

  return (
    <Card title={t('admin.sso.title')} className="sso-settings">
      <Alert
        message={t('admin.sso.description')}
        description={
          <div>
            <p>{t('admin.sso.descriptionDetail')}</p>
            <div style={{ marginTop: 8 }}>
              <strong>{t('admin.sso.endpoint')}:</strong>
              <Input
                value={ssoUrl}
                readOnly
                addonAfter={
                  <CopyOutlined 
                    onClick={() => copyToClipboard(ssoUrl)}
                    style={{ cursor: 'pointer' }}
                  />
                }
                style={{ marginTop: 4 }}
              />
            </div>
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
      >
        <Form.Item
          name="enabled"
          label={t('admin.sso.enabled')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Divider />

        <Form.Item
          name="shared_secret"
          label={
            <Space>
              {t('admin.sso.sharedSecret')}
              <Tooltip title={t('admin.sso.sharedSecretTip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <Input.Password
            placeholder={t('admin.sso.sharedSecretPlaceholder')}
            addonAfter={
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleGenerateSecret}
                style={{ border: 'none' }}
              >
                {t('admin.sso.generateSecret')}
              </Button>
            }
          />
        </Form.Item>

        <Form.Item
          name="target_group_id"
          label={
            <Space>
              {t('admin.sso.targetGroup')}
              <Tooltip title={t('admin.sso.targetGroupTip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[
            {
              required: true,
              message: t('admin.sso.targetGroupRequired')
            }
          ]}
        >
          <Select placeholder={t('admin.sso.selectGroup')}>
            {Array.isArray(groups) && groups.map(group => (
              <Option key={group.id} value={group.id}>
                {group.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="default_credits"
          label={
            <Space>
              {t('admin.sso.defaultCredits')}
              <Tooltip title={t('admin.sso.defaultCreditsTip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[
            {
              required: true,
              message: t('admin.sso.defaultCreditsRequired')
            }
          ]}
        >
          <InputNumber
            min={0}
            max={1000000}
            style={{ width: '100%' }}
            placeholder={t('admin.sso.defaultCreditsPlaceholder')}
          />
        </Form.Item>

        <Form.Item
          name="signature_valid_minutes"
          label={
            <Space>
              {t('admin.sso.signatureValidMinutes')}
              <Tooltip title={t('admin.sso.signatureValidMinutesTip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[
            {
              required: true,
              message: t('admin.sso.signatureValidMinutesRequired')
            }
          ]}
        >
          <InputNumber
            min={1}
            max={60}
            style={{ width: '100%' }}
            placeholder={t('admin.sso.signatureValidMinutesPlaceholder')}
            addonAfter={t('common.minutes')}
          />
        </Form.Item>

        <Divider />

        <Form.Item
          name="ip_whitelist_enabled"
          label={t('admin.sso.ipWhitelistEnabled')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="allowed_ips"
          label={
            <Space>
              {t('admin.sso.allowedIps')}
              <Tooltip title={t('admin.sso.allowedIpsTip')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          dependencies={['ip_whitelist_enabled']}
        >
          <TextArea
            rows={4}
            placeholder={t('admin.sso.allowedIpsPlaceholder')}
            disabled={!form.getFieldValue('ip_whitelist_enabled')}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              icon={<SaveOutlined />}
            >
              {t('common.save')}
            </Button>
            <Button onClick={loadSettings}>
              {t('common.reset')}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Divider />

      <Alert
        message={t('admin.sso.integrationGuide')}
        description={
          <div>
            <h4>{t('admin.sso.requestFormat')}</h4>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
{`POST /api/auth/sso
Content-Type: application/json

{
  "username": "user@example.com",
  "timestamp": 1234567890,
  "signature": "sha256_hash"
}`}
            </pre>
            <h4>{t('admin.sso.signatureGeneration')}</h4>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
{`signature = SHA256(username + timestamp + shared_secret)`}
            </pre>
            <h4>{t('admin.sso.phpExample')}</h4>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto' }}>
{`<?php
$username = 'user@example.com';
$timestamp = time();
$shared_secret = 'your_shared_secret';

$signature = hash('sha256', $username . $timestamp . $shared_secret);

$data = [
    'username' => $username,
    'timestamp' => $timestamp,
    'signature' => $signature
];

$ch = curl_init('${ssoUrl}');
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    // 使用返回的 token 和 redirectUrl
    header('Location: ' . $result['data']['redirectUrl']);
}
?>`}
            </pre>
          </div>
        }
        type="warning"
        style={{ marginTop: 24 }}
      />
    </Card>
  );
};

export default SSOSettings;
