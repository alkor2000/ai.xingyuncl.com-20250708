/**
 * 思维导图积分配置组件
 */
import React, { useState, useEffect } from 'react';
import { Card, Form, InputNumber, Button, message, Alert, Space, Typography, Divider, Table } from 'antd';
import { SaveOutlined, ShareAltOutlined, DollarOutlined } from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { Title, Text } = Typography;

const MindmapCreditsConfig = () => {
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
      const response = await apiClient.get('/admin/mindmap-credits/config');
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
      const response = await apiClient.put('/admin/mindmap-credits/config', values);
      if (response.data.success) {
        message.success('配置保存成功');
      }
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };
  
  // 操作示例数据
  const exampleData = [
    { 
      key: '1',
      operation: '保存思维导图', 
      field: 'save_credits',
      description: '用户保存或更新思维导图时扣减的积分',
      current: form.getFieldValue('save_credits') || 0
    },
    { 
      key: '2',
      operation: '导出SVG矢量图', 
      field: 'export_svg_credits',
      description: '导出为SVG格式文件时扣减的积分',
      current: form.getFieldValue('export_svg_credits') || 0
    },
    { 
      key: '3',
      operation: '导出Markdown文件', 
      field: 'export_markdown_credits',
      description: '导出为Markdown格式文件时扣减的积分',
      current: form.getFieldValue('export_markdown_credits') || 0
    }
  ];
  
  const columns = [
    {
      title: '操作类型',
      dataIndex: 'operation',
      key: 'operation',
      width: 200
    },
    {
      title: '说明',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '当前积分',
      dataIndex: 'current',
      key: 'current',
      width: 120,
      render: (value) => (
        <Text strong style={{ color: value > 0 ? '#1890ff' : '#52c41a' }}>
          {value > 0 ? `${value} 积分` : '免费'}
        </Text>
      )
    }
  ];
  
  return (
    <Card
      title={
        <Space>
          <ShareAltOutlined style={{ color: '#1890ff' }} />
          <span>思维导图积分配置</span>
        </Space>
      }
      loading={loading}
    >
      <Alert
        message="配置说明"
        description="设置思维导图各项操作所需的积分值，设置为0表示该操作免费。积分值范围：0-999"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        onValuesChange={(_, values) => {
          form.setFieldsValue(values);
        }}
      >
        <Form.Item
          label="保存思维导图积分"
          name="save_credits"
          tooltip="用户保存或更新思维导图时扣减的积分，设置为0表示免费"
          rules={[
            { required: true, message: '请输入积分值' },
            { type: 'number', min: 0, max: 999, message: '积分值必须在0-999之间' }
          ]}
        >
          <InputNumber
            min={0}
            max={999}
            style={{ width: 200 }}
            addonAfter="积分"
            placeholder="例如: 5"
          />
        </Form.Item>
        
        <Form.Item
          label="导出SVG矢量图积分"
          name="export_svg_credits"
          tooltip="导出为SVG格式文件时扣减的积分，设置为0表示免费"
          rules={[
            { required: true, message: '请输入积分值' },
            { type: 'number', min: 0, max: 999, message: '积分值必须在0-999之间' }
          ]}
        >
          <InputNumber
            min={0}
            max={999}
            style={{ width: 200 }}
            addonAfter="积分"
            placeholder="例如: 2"
          />
        </Form.Item>
        
        <Form.Item
          label="导出Markdown文件积分"
          name="export_markdown_credits"
          tooltip="导出为Markdown格式文件时扣减的积分，设置为0表示免费"
          rules={[
            { required: true, message: '请输入积分值' },
            { type: 'number', min: 0, max: 999, message: '积分值必须在0-999之间' }
          ]}
        >
          <InputNumber
            min={0}
            max={999}
            style={{ width: 200 }}
            addonAfter="积分"
            placeholder="例如: 1"
          />
        </Form.Item>
        
        <Divider />
        
        {/* 配置预览表格 */}
        <div style={{ marginBottom: 24 }}>
          <Title level={5}>
            <DollarOutlined /> 当前配置预览
          </Title>
          <Table 
            columns={columns} 
            dataSource={exampleData}
            pagination={false}
            size="small"
            style={{ marginTop: 16 }}
          />
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

export default MindmapCreditsConfig;
