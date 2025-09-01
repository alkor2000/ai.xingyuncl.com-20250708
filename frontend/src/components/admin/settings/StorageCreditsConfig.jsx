/**
 * 存储积分配置组件
 */
import React, { useState, useEffect } from 'react';
import { Card, Form, InputNumber, Button, message, Alert, Space, Typography, Divider } from 'antd';
import { SaveOutlined, CloudUploadOutlined, DollarOutlined } from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { Title, Text, Paragraph } = Typography;

const StorageCreditsConfig = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);
  
  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/storage-credits/config');
      if (response.data.success) {
        form.setFieldsValue(response.data.data);
      }
    } catch (error) {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 保存配置
  const handleSave = async (values) => {
    setSaving(true);
    try {
      const response = await apiClient.put('/admin/storage-credits/config', values);
      if (response.data.success) {
        message.success('配置保存成功');
      }
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };
  
  // 计算示例 - 修复计算逻辑以匹配后端
  const calculateExample = (values) => {
    const examples = [
      { size: 1, label: '1MB文件' },
      { size: 10, label: '10MB文件' },
      { size: 50, label: '50MB文件' },
      { size: 100, label: '100MB文件' }
    ];
    
    return examples.map(ex => {
      let credits = 0;
      const baseCredits = parseInt(values?.base_credits || 2);
      const creditsPerInterval = parseFloat(values?.credits_per_5mb || 1);
      
      if (ex.size <= 5) {
        // 5MB及以下，只收基础积分
        credits = baseCredits;
      } else {
        // 超过5MB，按区间收费
        const extraIntervals = Math.ceil((ex.size - 5) / 5);
        credits = extraIntervals * creditsPerInterval;
      }
      
      return { ...ex, credits: Math.ceil(credits) };
    });
  };
  
  return (
    <Card
      title={
        <Space>
          <CloudUploadOutlined style={{ color: '#1890ff' }} />
          <span>存储积分配置</span>
        </Space>
      }
      loading={loading}
    >
      <Alert
        message="简化配置说明"
        description="上传文件时的积分计算公式：基础积分 + (文件大小/5MB) × 每5MB积分"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        onValuesChange={(_, values) => {
          // 实时更新示例
          form.setFieldsValue(values);
        }}
      >
        <Form.Item
          label="基础积分"
          name="base_credits"
          tooltip="5MB及以下文件的积分消耗"
          rules={[{ required: true, message: '请输入基础积分' }]}
        >
          <InputNumber
            min={0}
            max={100}
            style={{ width: 200 }}
            addonAfter="积分"
            placeholder="例如: 2"
          />
        </Form.Item>
        
        <Form.Item
          label="大小积分"
          name="credits_per_5mb"
          tooltip="超过5MB部分，每5MB区间收取的积分"
          rules={[{ required: true, message: '请输入大小积分' }]}
        >
          <InputNumber
            min={0}
            max={100}
            precision={2}
            style={{ width: 200 }}
            addonAfter="积分/5MB"
            placeholder="例如: 1"
          />
        </Form.Item>
        
        <Form.Item
          label="最大文件限制"
          name="max_file_size"
          tooltip="单个文件的最大大小限制"
          rules={[{ required: true, message: '请输入最大文件大小' }]}
        >
          <InputNumber
            min={1}
            max={1000}
            style={{ width: 200 }}
            addonAfter="MB"
            placeholder="例如: 100"
          />
        </Form.Item>
        
        <Divider />
        
        {/* 积分计算示例 */}
        <div style={{ marginBottom: 24 }}>
          <Title level={5}>
            <DollarOutlined /> 积分计算示例
          </Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {calculateExample(form.getFieldsValue()).map(ex => (
              <div key={ex.size} style={{ 
                padding: '8px 12px', 
                background: '#f5f5f5', 
                borderRadius: 4,
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <Text>{ex.label}</Text>
                <Text strong style={{ color: '#1890ff' }}>{ex.credits} 积分</Text>
              </div>
            ))}
          </Space>
        </div>
        
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
            size="large"
          >
            保存配置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default StorageCreditsConfig;
