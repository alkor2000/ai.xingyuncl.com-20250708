/**
 * HTML编辑器设置组件
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Form,
  InputNumber,
  Switch,
  Button,
  Space,
  Alert,
  Row,
  Col,
  Divider,
  Typography,
  message,
  Select
} from 'antd';
import {
  SaveOutlined,
  DollarOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  BarChartOutlined
} from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { Title, Text } = Typography;

const HtmlEditorSettings = ({ disabled = false }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/settings');
      if (response.data.success) {
        const data = response.data.data;
        
        // 提取HTML编辑器相关设置
        const htmlEditorSettings = {
          enabled: data.html_editor?.enabled ?? true,
          credits_per_page: data.html_editor?.credits_per_page ?? 10,
          credits_per_update: data.html_editor?.credits_per_update ?? 2,
          credits_per_publish: data.html_editor?.credits_per_publish ?? 5,
          max_pages_per_user: data.html_editor?.max_pages_per_user ?? 100,
          max_file_size_mb: data.html_editor?.max_file_size_mb ?? 10,
          storage_limit_mb: data.html_editor?.storage_limit_mb ?? 1000,
          enable_oss: data.html_editor?.enable_oss ?? false,
          default_storage: data.html_editor?.default_storage ?? 'local'
        };
        
        setSettings(htmlEditorSettings);
        form.setFieldsValue(htmlEditorSettings);
      }
    } catch (error) {
      console.error('加载HTML编辑器设置失败:', error);
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  // 保存设置
  const handleSave = async (values) => {
    if (disabled) {
      message.warning('您没有权限修改设置');
      return;
    }

    setSaving(true);
    try {
      // 获取完整的系统设置
      const settingsResponse = await apiClient.get('/admin/settings');
      const fullSettings = settingsResponse.data.data;
      
      // 更新HTML编辑器部分
      fullSettings.html_editor = {
        ...values
      };
      
      // 保存设置
      const response = await apiClient.put('/admin/settings', fullSettings);
      
      if (response.data.success) {
        message.success('HTML编辑器设置保存成功');
        setSettings(values);
      } else {
        message.error('保存失败');
      }
    } catch (error) {
      console.error('保存HTML编辑器设置失败:', error);
      message.error('保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {disabled && (
        <Alert
          message="只读模式"
          description="组管理员只能查看设置，不能修改"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={settings}
      >
        <Row gutter={24}>
          <Col xs={24} lg={12}>
            {/* 积分设置 */}
            <Card 
              title={
                <Space>
                  <DollarOutlined />
                  <span>积分消耗设置</span>
                </Space>
              }
              size="small"
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name="credits_per_page"
                label="创建页面消耗积分"
                tooltip="用户创建一个新的HTML页面需要消耗的积分数量（设为0表示免费）"
              >
                <InputNumber
                  min={0}
                  max={1000}
                  step={1}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="积分"
                />
              </Form.Item>

              <Form.Item
                name="credits_per_update"
                label="更新页面消耗积分"
                tooltip="用户更新HTML页面内容需要消耗的积分数量（设为0表示免费，仅修改标题不消耗）"
              >
                <InputNumber
                  min={0}
                  max={100}
                  step={1}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="积分"
                />
              </Form.Item>

              <Form.Item
                name="credits_per_publish"
                label="生成永久链接消耗积分"
                tooltip="用户发布页面生成永久链接需要消耗的积分数量（设为0表示免费）"
              >
                <InputNumber
                  min={0}
                  max={500}
                  step={1}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="积分"
                />
              </Form.Item>

              <Alert
                message="积分策略说明"
                description={
                  <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                    <li>创建页面时一次性扣除积分</li>
                    <li>更新页面内容时扣除积分（仅修改标题不扣除）</li>
                    <li>生成永久链接时扣除积分，链接永久有效</li>
                    <li>删除页面不退还积分</li>
                    <li>设置为0表示该操作免费</li>
                  </ul>
                }
                type="info"
                showIcon
                style={{ marginTop: 16 }}
              />
            </Card>

            {/* 功能开关 */}
            <Card
              title={
                <Space>
                  <SettingOutlined />
                  <span>功能开关</span>
                </Space>
              }
              size="small"
            >
              <Form.Item
                name="enabled"
                label="启用HTML编辑器"
                valuePropName="checked"
                tooltip="关闭后用户将无法访问HTML编辑器功能"
              >
                <Switch 
                  disabled={disabled || loading}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                />
              </Form.Item>

              <Form.Item
                name="enable_oss"
                label="启用OSS存储"
                valuePropName="checked"
                tooltip="开启后可以将文件上传到阿里云OSS"
              >
                <Switch 
                  disabled={disabled || loading}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                />
              </Form.Item>

              <Form.Item
                name="default_storage"
                label="默认存储方式"
                tooltip="选择文件的默认存储位置"
              >
                <Select
                  disabled={disabled || loading}
                  options={[
                    { value: 'local', label: '本地存储' },
                    { value: 'oss', label: 'OSS存储' }
                  ]}
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            {/* 限制设置 */}
            <Card
              title={
                <Space>
                  <DatabaseOutlined />
                  <span>用户限制设置</span>
                </Space>
              }
              size="small"
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name="max_pages_per_user"
                label="每用户最大页面数"
                tooltip="限制每个用户最多可以创建的页面数量"
              >
                <InputNumber
                  min={1}
                  max={10000}
                  step={1}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="个"
                />
              </Form.Item>

              <Form.Item
                name="max_file_size_mb"
                label="单个文件最大大小"
                tooltip="限制上传的单个文件最大大小"
              >
                <InputNumber
                  min={1}
                  max={100}
                  step={1}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="MB"
                />
              </Form.Item>

              <Form.Item
                name="storage_limit_mb"
                label="每用户存储限制"
                tooltip="限制每个用户的总存储空间"
              >
                <InputNumber
                  min={10}
                  max={100000}
                  step={10}
                  style={{ width: '100%' }}
                  disabled={disabled || loading}
                  addonAfter="MB"
                />
              </Form.Item>
            </Card>

            {/* 当前使用情况 */}
            <Card
              title={
                <Space>
                  <BarChartOutlined />
                  <span>使用统计</span>
                </Space>
              }
              size="small"
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">总页面数：</Text>
                  <Text strong>-</Text>
                </div>
                <div>
                  <Text type="secondary">活跃用户数：</Text>
                  <Text strong>-</Text>
                </div>
                <div>
                  <Text type="secondary">总存储使用：</Text>
                  <Text strong>-</Text>
                </div>
                <div>
                  <Text type="secondary">今日创建页面：</Text>
                  <Text strong>-</Text>
                </div>
                <div>
                  <Text type="secondary">今日消耗积分：</Text>
                  <Text strong>-</Text>
                </div>
              </Space>
              <Divider />
              <Text type="secondary" style={{ fontSize: 12 }}>
                统计功能正在开发中...
              </Text>
            </Card>
          </Col>
        </Row>

        {!disabled && (
          <Form.Item style={{ textAlign: 'center', marginTop: 24 }}>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={saving}
                disabled={loading}
              >
                保存设置
              </Button>
              <Button 
                onClick={() => form.resetFields()}
                disabled={loading || saving}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        )}
      </Form>
    </div>
  );
};

export default HtmlEditorSettings;
