/**
 * OCR配置组件
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  message,
  Alert,
  Row,
  Col,
  Typography,
  Divider,
  Switch
} from 'antd';
import {
  ScanOutlined,
  KeyOutlined,
  DollarOutlined,
  SaveOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

const OcrSettings = ({ disabled = false }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  // 获取OCR配置
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/ocr/config');
      if (response.data.success) {
        const data = response.data.data;
        setConfig(data);
        setHasApiKey(data.has_api_key);
        
        // 设置表单值
        form.setFieldsValue({
          enabled: data.enabled === 'true',
          credits_per_image: parseInt(data.credits_per_image || 5),
          credits_per_pdf_page: parseInt(data.credits_per_pdf_page || 3),
          max_file_size_mb: parseInt(data.max_file_size_mb || 50),
          max_pdf_pages: parseInt(data.max_pdf_pages || 100),
          mistral_model: data.mistral_model || 'mistral-ocr-latest'
        });
      }
    } catch (error) {
      console.error('获取OCR配置失败:', error);
      message.error('获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    if (disabled) {
      message.warning('您没有权限修改配置');
      return;
    }

    try {
      const values = await form.validateFields();
      setLoading(true);

      // 准备更新数据
      const updates = {
        enabled: values.enabled ? 'true' : 'false',
        credits_per_image: String(values.credits_per_image),
        credits_per_pdf_page: String(values.credits_per_pdf_page),
        max_file_size_mb: String(values.max_file_size_mb),
        max_pdf_pages: String(values.max_pdf_pages),
        mistral_model: values.mistral_model
      };

      // 如果输入了API密钥，添加到更新数据中
      if (values.mistral_api_key) {
        updates.mistral_api_key = values.mistral_api_key;
      }

      const response = await apiClient.put('/ocr/admin/config', updates);
      
      if (response.data.success) {
        message.success('OCR配置已更新');
        // 清空API密钥输入框
        form.setFieldValue('mistral_api_key', '');
        // 重新获取配置
        await fetchConfig();
      } else {
        message.error(response.data.message || '更新失败');
      }
    } catch (error) {
      console.error('保存OCR配置失败:', error);
      message.error('保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 初始化加载配置
  useEffect(() => {
    fetchConfig();
  }, []);

  return (
    <Card title={
      <Space>
        <ScanOutlined />
        <span>OCR识别配置</span>
      </Space>
    }>
      <Alert
        message="OCR服务说明"
        description={
          <div>
            <p>本系统使用 Mistral OCR API 提供文字识别服务，支持：</p>
            <ul>
              <li>图片格式：JPG、PNG、WebP、BMP等</li>
              <li>PDF文档：最大50MB，最多1000页</li>
              <li>输出格式：纯文本和Markdown格式</li>
              <li>表格识别：自动识别并转换为Markdown表格</li>
            </ul>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form
        form={form}
        layout="vertical"
        disabled={disabled || loading}
      >
        <Row gutter={24}>
          <Col span={24}>
            <Title level={5}>
              <KeyOutlined /> API配置
            </Title>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="启用OCR功能"
              name="enabled"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="OCR模型"
              name="mistral_model"
              rules={[{ required: true, message: '请输入模型名称' }]}
            >
              <Input placeholder="mistral-ocr-latest" />
            </Form.Item>
          </Col>
          
          <Col span={24}>
            <Form.Item
              label={
                <Space>
                  <span>Mistral API密钥</span>
                  {hasApiKey && (
                    <Text type="success" style={{ fontSize: 12 }}>
                      (已配置)
                    </Text>
                  )}
                </Space>
              }
              name="mistral_api_key"
              extra={
                hasApiKey 
                  ? "API密钥已配置。如需更新，请输入新密钥"
                  : "请前往 https://console.mistral.ai 获取API密钥"
              }
            >
              <Input.Password 
                placeholder={hasApiKey ? "留空则不更新" : "请输入API密钥"} 
                autoComplete="new-password"
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider />

        <Row gutter={24}>
          <Col span={24}>
            <Title level={5}>
              <DollarOutlined /> 积分配置
            </Title>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="图片OCR积分（每张）"
              name="credits_per_image"
              rules={[
                { required: true, message: '请输入积分数' },
                { type: 'number', min: 0, message: '积分数不能小于0' }
              ]}
            >
              <InputNumber 
                min={0} 
                max={100}
                style={{ width: '100%' }}
                placeholder="每张图片消耗积分"
              />
            </Form.Item>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="PDF OCR积分（每页）"
              name="credits_per_pdf_page"
              rules={[
                { required: true, message: '请输入积分数' },
                { type: 'number', min: 0, message: '积分数不能小于0' }
              ]}
            >
              <InputNumber 
                min={0} 
                max={100}
                style={{ width: '100%' }}
                placeholder="每页PDF消耗积分"
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider />

        <Row gutter={24}>
          <Col span={24}>
            <Title level={5}>限制配置</Title>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="最大文件大小（MB）"
              name="max_file_size_mb"
              rules={[
                { required: true, message: '请输入最大文件大小' },
                { type: 'number', min: 1, max: 50, message: '范围：1-50MB' }
              ]}
            >
              <InputNumber 
                min={1} 
                max={50}
                style={{ width: '100%' }}
                placeholder="单个文件最大大小"
              />
            </Form.Item>
          </Col>
          
          <Col span={12}>
            <Form.Item
              label="最大PDF页数"
              name="max_pdf_pages"
              rules={[
                { required: true, message: '请输入最大页数' },
                { type: 'number', min: 1, max: 1000, message: '范围：1-1000页' }
              ]}
            >
              <InputNumber 
                min={1} 
                max={1000}
                style={{ width: '100%' }}
                placeholder="PDF最大页数限制"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row>
          <Col span={24}>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={loading}
                disabled={disabled}
              >
                保存配置
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchConfig}
                loading={loading}
              >
                刷新配置
              </Button>
            </Space>
          </Col>
        </Row>
      </Form>
    </Card>
  );
};

export default OcrSettings;
