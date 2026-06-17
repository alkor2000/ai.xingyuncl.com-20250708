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
  Divider,
  Table,
  Popconfirm,
  Tag,
  Typography
} from 'antd';
import {
  ReloadOutlined,
  SaveOutlined,
  InfoCircleOutlined,
  CopyOutlined,
  PlusOutlined,
  DeleteOutlined,
  ApiOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;
const { Option } = Select;
const { Text, Paragraph } = Typography;

/**
 * SSO 单点登录配置（多平台版）
 *
 * 功能：
 *   1. 全局配置：启用开关 / 全局密钥 / 全局目标组 / 默认积分 / 签名有效期 / IP白名单
 *      —— 用于不携带 platform_key 的老对接方（向后兼容）
 *   2. 多平台列表：每行一个平台（平台标识 / 名称 / 密钥 / 目标组 / 默认积分 / 算法 / 启用）
 *      —— 携带 platform_key 的请求按平台独立密钥验签，落入平台指定的组
 *   3. 对接文档：与后端真实实现一致（uuid 签名主体；多平台与全局两套示例）
 *
 * 说明：
 *   - 密钥在后端做掩码后下发（形如 ab****yz），未改动时回传掩码即可保留原值
 *   - 修改平台标识(platform_key)后必须重新填写密钥（后端按 platform_key 回填原密钥，改标识会导致原密钥匹配不到）
 *   - 新增文案使用 t(key, '中文兜底') 形式，locale 未补充 key 时显示中文，不影响使用
 */
const SSOSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState([]);
  const [ssoUrl, setSsoUrl] = useState('');

  // 多平台列表（受控状态，独立于 antd Form 管理）
  const [platforms, setPlatforms] = useState([]);

  useEffect(() => {
    loadSettings();
    loadGroups();
    generateSSOUrl();
  }, []);

  // 加载 SSO 配置
  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/settings/sso');
      if (response.data && response.data.data) {
        const data = response.data.data;
        // 全局字段交给 Form
        form.setFieldsValue({
          enabled: data.enabled,
          shared_secret: data.shared_secret,
          target_group_id: data.target_group_id,
          default_credits: data.default_credits,
          signature_valid_minutes: data.signature_valid_minutes,
          ip_whitelist_enabled: data.ip_whitelist_enabled,
          allowed_ips: data.allowed_ips
        });
        // 平台列表交给受控状态，补一个本地行 id 便于表格渲染
        const list = Array.isArray(data.platforms) ? data.platforms : [];
        setPlatforms(list.map((p, idx) => ({ ...p, _rowId: `row_${idx}_${Date.now()}` })));
      }
    } catch (error) {
      console.error('Load SSO settings error:', error);
      message.error(t('admin.sso.loadError', '加载SSO配置失败'));
    } finally {
      setLoading(false);
    }
  };

  // 加载用户组列表
  const loadGroups = async () => {
    try {
      const response = await api.get('/admin/user-groups');
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

  // 生成 SSO 接口地址
  const generateSSOUrl = () => {
    const protocol = window.location.protocol;
    const host = window.location.host;
    setSsoUrl(`${protocol}//${host}/api/auth/sso`);
  };

  // 保存配置（全局 + 平台列表）
  const handleSave = async (values) => {
    // 前端基础校验：平台标识非空且不重复
    const keys = platforms.map(p => (p.platform_key || '').trim());
    if (keys.some(k => !k)) {
      message.error(t('admin.sso.platformKeyEmpty', '存在平台标识为空的行，请填写或删除'));
      return;
    }
    const dupSet = new Set();
    for (const k of keys) {
      if (dupSet.has(k)) {
        message.error(t('admin.sso.platformKeyDup', '平台标识重复：') + k);
        return;
      }
      dupSet.add(k);
    }

    // C项校验：启用的平台必须选择目标组
    for (const p of platforms) {
      const enabled = p.enabled !== false;
      if (enabled && (p.target_group_id === undefined || p.target_group_id === null)) {
        const keyLabel = (p.platform_key || '').trim() || t('admin.sso.thisPlatform', '该平台');
        message.error(
          t('admin.sso.platformGroupRequired', '请为启用的平台选择目标组：') + keyLabel
        );
        return;
      }
    }

    setSaving(true);
    try {
      // 组装提交体：全局字段 + 清洗后的平台列表（去掉本地 _rowId）
      const payload = {
        ...values,
        platforms: platforms.map(p => ({
          platform_key: (p.platform_key || '').trim(),
          name: (p.name || '').trim(),
          secret: p.secret || '',
          target_group_id: p.target_group_id,
          default_credits: p.default_credits,
          algorithm: p.algorithm === 'sha256' ? 'sha256' : 'md5',
          enabled: p.enabled !== false
        }))
      };

      await api.put('/admin/settings/sso', payload);
      message.success(t('admin.sso.saveSuccess', 'SSO配置保存成功'));
      // 重新加载以获取掩码后的密钥
      loadSettings();
    } catch (error) {
      console.error('Save SSO settings error:', error);
      // 后端校验错误（422）会带具体中文提示
      const errMsg =
        error?.response?.data?.errors?.[0] ||
        error?.response?.data?.message ||
        t('admin.sso.saveError', 'SSO配置保存失败');
      message.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  // 生成全局密钥
  const handleGenerateSecret = async () => {
    try {
      const response = await api.post('/admin/settings/sso/generate-secret');
      if (response.data && response.data.data && response.data.data.secret) {
        form.setFieldsValue({ shared_secret: response.data.data.secret });
        message.success(t('admin.sso.secretGenerated', '密钥已生成'));
      }
    } catch (error) {
      console.error('Generate secret error:', error);
      message.error(t('admin.sso.secretGenerateError', '生成密钥失败'));
    }
  };

  // 为指定平台行生成密钥
  const handleGeneratePlatformSecret = async (rowId) => {
    try {
      const response = await api.post('/admin/settings/sso/generate-secret');
      if (response.data && response.data.data && response.data.data.secret) {
        const secret = response.data.data.secret;
        setPlatforms(prev =>
          prev.map(p => (p._rowId === rowId ? { ...p, secret } : p))
        );
        message.success(t('admin.sso.secretGenerated', '密钥已生成'));
      }
    } catch (error) {
      console.error('Generate platform secret error:', error);
      message.error(t('admin.sso.secretGenerateError', '生成密钥失败'));
    }
  };

  // 复制文本到剪贴板
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('admin.sso.copied', '已复制'));
    }).catch(() => {
      message.error(t('admin.sso.copyError', '复制失败'));
    });
  };

  // 添加一个空平台行
  const handleAddPlatform = () => {
    setPlatforms(prev => [
      ...prev,
      {
        _rowId: `row_new_${Date.now()}`,
        platform_key: '',
        name: '',
        secret: '',
        target_group_id: undefined,
        default_credits: 100,
        algorithm: 'md5',
        enabled: true
      }
    ]);
  };

  // 删除指定平台行
  const handleRemovePlatform = (rowId) => {
    setPlatforms(prev => prev.filter(p => p._rowId !== rowId));
  };

  // 更新指定平台行的某个字段
  const updatePlatformField = (rowId, field, value) => {
    setPlatforms(prev =>
      prev.map(p => (p._rowId === rowId ? { ...p, [field]: value } : p))
    );
  };

  // 平台列表表格列定义
  const platformColumns = [
    {
      title: t('admin.sso.platformKey', '平台标识'),
      dataIndex: 'platform_key',
      width: 150,
      render: (val, record) => (
        <Input
          value={val}
          placeholder="school_a"
          onChange={e => updatePlatformField(record._rowId, 'platform_key', e.target.value)}
        />
      )
    },
    {
      title: t('admin.sso.platformName', '平台名称'),
      dataIndex: 'name',
      width: 140,
      render: (val, record) => (
        <Input
          value={val}
          placeholder={t('admin.sso.platformNamePlaceholder', '如：学校A')}
          onChange={e => updatePlatformField(record._rowId, 'name', e.target.value)}
        />
      )
    },
    {
      title: t('admin.sso.platformSecret', '密钥'),
      dataIndex: 'secret',
      width: 220,
      render: (val, record) => (
        <Input.Password
          value={val}
          placeholder={t('admin.sso.platformSecretPlaceholder', '该平台独立密钥')}
          onChange={e => updatePlatformField(record._rowId, 'secret', e.target.value)}
          addonAfter={
            <Tooltip title={t('admin.sso.generateSecret', '生成密钥')}>
              <ReloadOutlined
                style={{ cursor: 'pointer' }}
                onClick={() => handleGeneratePlatformSecret(record._rowId)}
              />
            </Tooltip>
          }
        />
      )
    },
    {
      title: t('admin.sso.targetGroup', '目标组'),
      dataIndex: 'target_group_id',
      width: 150,
      render: (val, record) => (
        <Select
          value={val}
          style={{ width: '100%' }}
          placeholder={t('admin.sso.selectGroup', '选择用户组')}
          onChange={v => updatePlatformField(record._rowId, 'target_group_id', v)}
        >
          {Array.isArray(groups) && groups.map(group => (
            <Option key={group.id} value={group.id}>{group.name}</Option>
          ))}
        </Select>
      )
    },
    {
      title: t('admin.sso.defaultCredits', '默认积分'),
      dataIndex: 'default_credits',
      width: 110,
      render: (val, record) => (
        <InputNumber
          value={val}
          min={0}
          max={1000000}
          style={{ width: '100%' }}
          onChange={v => updatePlatformField(record._rowId, 'default_credits', v)}
        />
      )
    },
    {
      title: t('admin.sso.algorithm', '算法'),
      dataIndex: 'algorithm',
      width: 110,
      render: (val, record) => (
        <Select
          value={val || 'md5'}
          style={{ width: '100%' }}
          onChange={v => updatePlatformField(record._rowId, 'algorithm', v)}
        >
          <Option value="md5">MD5</Option>
          <Option value="sha256">SHA-256</Option>
        </Select>
      )
    },
    {
      title: t('admin.sso.platformEnabled', '启用'),
      dataIndex: 'enabled',
      width: 70,
      render: (val, record) => (
        <Switch
          checked={val !== false}
          onChange={v => updatePlatformField(record._rowId, 'enabled', v)}
        />
      )
    },
    {
      title: t('common.action', '操作'),
      key: 'action',
      width: 70,
      render: (_, record) => (
        <Popconfirm
          title={t('admin.sso.removePlatformConfirm', '确定删除该平台？')}
          onConfirm={() => handleRemovePlatform(record._rowId)}
          okText={t('common.confirm', '确定')}
          cancelText={t('common.cancel', '取消')}
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  if (loading) {
    return (
      <Card>
        <Spin spinning={loading} tip={t('common.loading', '加载中...')}>
          <div style={{ minHeight: 200 }} />
        </Spin>
      </Card>
    );
  }

  return (
    <Card title={t('admin.sso.title', 'SSO 单点登录配置')} className="sso-settings">
      <Alert
        message={t('admin.sso.description', 'SSO 单点登录')}
        description={
          <div>
            <p>{t('admin.sso.descriptionDetail', '外部平台可通过签名验证免密登录本平台。支持多平台分别落入不同用户组。')}</p>
            <div style={{ marginTop: 8 }}>
              <strong>{t('admin.sso.endpoint', '接口地址')}:</strong>
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

      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item
          name="enabled"
          label={t('admin.sso.enabled', '启用 SSO')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Divider orientation="left">
          {t('admin.sso.globalConfig', '全局配置（默认平台 / 兼容旧对接）')}
        </Divider>

        <Alert
          message={t(
            'admin.sso.globalConfigTip',
            '全局配置用于「不携带 platform_key」的请求（老对接方）。新的多平台对接请使用下方的平台列表。'
          )}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form.Item
          name="shared_secret"
          label={
            <Space>
              {t('admin.sso.sharedSecret', '全局共享密钥')}
              <Tooltip title={t('admin.sso.sharedSecretTip', '用于全局模式的签名密钥')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <Input.Password
            placeholder={t('admin.sso.sharedSecretPlaceholder', '请输入或生成共享密钥')}
            addonAfter={
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleGenerateSecret}
                style={{ border: 'none' }}
              >
                {t('admin.sso.generateSecret', '生成密钥')}
              </Button>
            }
          />
        </Form.Item>

        <Form.Item
          name="target_group_id"
          label={
            <Space>
              {t('admin.sso.targetGroup', '全局目标组')}
              <Tooltip title={t('admin.sso.targetGroupTip', '全局模式下用户落入的用户组')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: t('admin.sso.targetGroupRequired', '请选择目标组') }]}
        >
          <Select placeholder={t('admin.sso.selectGroup', '选择用户组')}>
            {Array.isArray(groups) && groups.map(group => (
              <Option key={group.id} value={group.id}>{group.name}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="default_credits"
          label={
            <Space>
              {t('admin.sso.defaultCredits', '默认积分')}
              <Tooltip title={t('admin.sso.defaultCreditsTip', '全局模式下新建用户的默认积分')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: t('admin.sso.defaultCreditsRequired', '请输入默认积分') }]}
        >
          <InputNumber
            min={0}
            max={1000000}
            style={{ width: '100%' }}
            placeholder={t('admin.sso.defaultCreditsPlaceholder', '如：100')}
          />
        </Form.Item>

        <Form.Item
          name="signature_valid_minutes"
          label={
            <Space>
              {t('admin.sso.signatureValidMinutes', '签名有效期')}
              <Tooltip title={t('admin.sso.signatureValidMinutesTip', '请求时间戳的有效窗口')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          rules={[{ required: true, message: t('admin.sso.signatureValidMinutesRequired', '请输入签名有效期') }]}
        >
          <InputNumber
            min={1}
            max={60}
            style={{ width: '100%' }}
            placeholder={t('admin.sso.signatureValidMinutesPlaceholder', '如：5')}
            addonAfter={t('common.minutes', '分钟')}
          />
        </Form.Item>

        <Divider />

        <Form.Item
          name="ip_whitelist_enabled"
          label={t('admin.sso.ipWhitelistEnabled', '启用 IP 白名单（全局）')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="allowed_ips"
          label={
            <Space>
              {t('admin.sso.allowedIps', '允许的 IP（全局）')}
              <Tooltip title={t('admin.sso.allowedIpsTip', '多个IP用英文逗号分隔')}>
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          dependencies={['ip_whitelist_enabled']}
        >
          <TextArea
            rows={3}
            placeholder={t('admin.sso.allowedIpsPlaceholder', '如：1.2.3.4,5.6.7.8')}
          />
        </Form.Item>

        <Divider orientation="left">
          <Space>
            <ApiOutlined />
            {t('admin.sso.platformsTitle', 'SSO 平台列表（多平台 → 多组）')}
          </Space>
        </Divider>

        <Alert
          message={t(
            'admin.sso.platformsTip',
            '每个外部平台一行：请求携带对应的 platform_key 时，用该平台的独立密钥验签，并落入该平台指定的用户组。'
          )}
          description={t(
            'admin.sso.platformsTipDetail',
            '注意：修改某平台的「平台标识」后，必须重新填写该平台密钥（否则保存时原密钥会因标识变更而丢失）。平台 IP 白名单与全局白名单互相独立，平台关闭即不限制 IP。'
          )}
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="_rowId"
          columns={platformColumns}
          dataSource={platforms}
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          locale={{ emptyText: t('admin.sso.platformsEmpty', '暂无平台，点击下方按钮添加') }}
        />

        <Button
          type="dashed"
          onClick={handleAddPlatform}
          icon={<PlusOutlined />}
          style={{ width: '100%', marginTop: 16 }}
        >
          {t('admin.sso.addPlatform', '添加平台')}
        </Button>

        <Divider />

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
              {t('common.save', '保存')}
            </Button>
            <Button onClick={loadSettings}>
              {t('common.reset', '重置')}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Divider />

      <Alert
        message={t('admin.sso.integrationGuide', '对接说明')}
        description={
          <div>
            <Paragraph>
              <Text strong>{t('admin.sso.signatureRule', '签名规则')}：</Text>
              {t('admin.sso.signatureRuleDetail', '签名主体为用户唯一标识 uuid。')}
            </Paragraph>

            <h4>{t('admin.sso.multiPlatformMode', '一、多平台模式（推荐，按平台落不同组）')}</h4>
            <Paragraph type="secondary">
              {t('admin.sso.multiPlatformModeDesc', '请求体携带 platform_key，使用对应平台的密钥与算法计算签名。')}
            </Paragraph>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
{`POST /api/auth/sso
Content-Type: application/json

{
  "uuid": "external-user-id-123",
  "name": "张三",
  "platform_key": "school_a",
  "timestamp": 1234567890,
  "signature": "<hash>"
}

签名（默认 MD5）：
signature = MD5(uuid + timestamp + 该平台密钥)
若平台算法设为 SHA-256：
signature = SHA256(uuid + timestamp + 该平台密钥)`}
            </pre>

            <h4>{t('admin.sso.globalMode', '二、全局模式（兼容旧对接，不带 platform_key）')}</h4>
            <Paragraph type="secondary">
              {t('admin.sso.globalModeDesc', '请求体不携带 platform_key，使用全局共享密钥计算签名（MD5）。')}
            </Paragraph>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
{`POST /api/auth/sso
Content-Type: application/json

{
  "uuid": "external-user-id-123",
  "name": "张三",
  "timestamp": 1234567890,
  "signature": "<hash>"
}

签名：
signature = MD5(uuid + timestamp + 全局共享密钥)`}
            </pre>

            <h4>{t('admin.sso.phpExample', 'PHP 示例（多平台模式）')}</h4>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto' }}>
{`<?php
$uuid         = 'external-user-id-123';
$name         = '张三';
$platform_key = 'school_a';          // 与后台平台标识一致
$timestamp    = time();
$secret       = 'your_platform_secret'; // 该平台的独立密钥

// 默认 MD5；若平台算法设为 sha256，请改用 hash('sha256', ...)
$signature = md5($uuid . $timestamp . $secret);

$data = [
    'uuid'         => $uuid,
    'name'         => $name,
    'platform_key' => $platform_key,
    'timestamp'    => $timestamp,
    'signature'    => $signature
];

$ch = curl_init('${ssoUrl}');
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if (!empty($result['success'])) {
    // 使用返回的 accessToken / refreshToken 完成登录
    // 例如下发到前端，或携带 token 跳转
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
