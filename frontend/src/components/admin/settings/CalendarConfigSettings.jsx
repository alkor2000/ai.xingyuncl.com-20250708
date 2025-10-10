/**
 * 日历配置管理组件 - 积分倍数和提示词模板
 */
import React, { useState, useEffect } from 'react';
import { 
  Card, Form, InputNumber, Button, message, Alert, Space, Typography, 
  Divider, Table, Modal, Input, Switch, Popconfirm, Tag 
} from 'antd';
import { 
  SaveOutlined, CalendarOutlined, DollarOutlined, PlusOutlined, 
  EditOutlined, DeleteOutlined, StarOutlined, StarFilled 
} from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const CalendarConfigSettings = () => {
  const [configForm] = Form.useForm();
  const [templateForm] = Form.useForm();
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  
  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);
  
  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/calendar/config');
      if (response.data.success) {
        const { config, templates } = response.data.data;
        configForm.setFieldsValue(config);
        setTemplates(templates);
      }
    } catch (error) {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 保存积分倍数配置
  const handleSaveConfig = async (values) => {
    setSaving(true);
    try {
      const response = await apiClient.put('/admin/calendar/config', values);
      if (response.data.success) {
        message.success('积分倍数配置保存成功');
      }
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };
  
  // 创建/更新模板
  const handleTemplateSubmit = async (values) => {
    try {
      if (editingTemplate) {
        await apiClient.put(`/admin/calendar/templates/${editingTemplate.id}`, values);
        message.success('模板更新成功');
      } else {
        await apiClient.post('/admin/calendar/templates', values);
        message.success('模板创建成功');
      }
      setTemplateModalVisible(false);
      templateForm.resetFields();
      setEditingTemplate(null);
      loadConfig();
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败');
    }
  };
  
  // 删除模板
  const handleDeleteTemplate = async (id) => {
    try {
      await apiClient.delete(`/admin/calendar/templates/${id}`);
      message.success('模板删除成功');
      loadConfig();
    } catch (error) {
      message.error(error.response?.data?.message || '删除失败');
    }
  };
  
  // 设置默认模板
  const handleSetDefault = async (id) => {
    try {
      await apiClient.put(`/admin/calendar/templates/${id}/default`);
      message.success('默认模板设置成功');
      loadConfig();
    } catch (error) {
      message.error('设置失败');
    }
  };
  
  // 打开编辑模态框
  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    templateForm.setFieldsValue(template);
    setTemplateModalVisible(true);
  };
  
  // 模板表格列
  const templateColumns = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (text, record) => (
        <Space>
          <Text strong>{text}</Text>
          {record.is_default && <Tag color="gold" icon={<StarFilled />}>默认</Tag>}
        </Space>
      )
    },
    {
      title: '提示词内容',
      dataIndex: 'prompt',
      key: 'prompt',
      ellipsis: true,
      render: (text) => (
        <Paragraph ellipsis={{ rows: 2, expandable: true }}>
          {text}
        </Paragraph>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      width: 200,
      ellipsis: true
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (is_active) => (
        <Tag color={is_active ? 'success' : 'default'}>
          {is_active ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          {!record.is_default && (
            <Button
              size="small"
              icon={<StarOutlined />}
              onClick={() => handleSetDefault(record.id)}
            >
              设为默认
            </Button>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditTemplate(record)}
          >
            编辑
          </Button>
          {!record.is_default && (
            <Popconfirm
              title="确认删除此模板？"
              onConfirm={() => handleDeleteTemplate(record.id)}
              okText="确认"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];
  
  // 变量说明表格
  const variablesData = [
    { key: '1', variable: '{scanDateStart}', description: '扫描开始日期' },
    { key: '2', variable: '{scanDateEnd}', description: '扫描结束日期' },
    { key: '3', variable: '{eventsCount}', description: '事项总数' },
    { key: '4', variable: '{eventsData}', description: '事项JSON数据' },
    { key: '5', variable: '{categoryDistribution}', description: '分类分布统计' },
    { key: '6', variable: '{statusDistribution}', description: '状态分布统计' },
    { key: '7', variable: '{importanceDistribution}', description: '重要度分布统计' }
  ];
  
  const variablesColumns = [
    { title: '变量名', dataIndex: 'variable', key: 'variable', width: 200 },
    { title: '说明', dataIndex: 'description', key: 'description' }
  ];
  
  return (
    <Card
      title={
        <Space>
          <CalendarOutlined style={{ color: '#1890ff' }} />
          <span>日历AI分析配置</span>
        </Space>
      }
      loading={loading}
    >
      {/* 积分倍数配置 */}
      <Alert
        message="积分倍数配置"
        description="设置AI分析的积分消耗倍数，实际消耗 = 基础积分 × 倍数。范围：1.0-10.0"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form
        form={configForm}
        layout="horizontal"
        onFinish={handleSaveConfig}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 8 }}
      >
        <Form.Item
          label="积分倍数"
          name="credits_multiplier"
          tooltip="AI分析积分消耗倍数，例如设置为2.0，则实际消耗为基础积分的2倍"
          rules={[
            { required: true, message: '请输入积分倍数' },
            { type: 'number', min: 1.0, max: 10.0, message: '倍数必须在1.0-10.0之间' }
          ]}
        >
          <InputNumber
            min={1.0}
            max={10.0}
            step={0.1}
            style={{ width: 200 }}
            addonAfter="倍"
            placeholder="例如: 1.5"
          />
        </Form.Item>
        
        <Form.Item wrapperCol={{ offset: 4 }}>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
          >
            保存倍数配置
          </Button>
        </Form.Item>
      </Form>
      
      <Divider />
      
      {/* 提示词模板管理 */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={5}>
            <DollarOutlined /> AI分析提示词模板
          </Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingTemplate(null);
              templateForm.resetFields();
              setTemplateModalVisible(true);
            }}
          >
            创建新模板
          </Button>
        </div>
        
        <Table
          columns={templateColumns}
          dataSource={templates}
          rowKey="id"
          pagination={false}
          size="middle"
        />
      </div>
      
      {/* 模板编辑模态框 */}
      <Modal
        title={editingTemplate ? '编辑模板' : '创建模板'}
        open={templateModalVisible}
        onCancel={() => {
          setTemplateModalVisible(false);
          templateForm.resetFields();
          setEditingTemplate(null);
        }}
        footer={null}
        width={800}
      >
        <Alert
          message="支持的变量"
          description={
            <Table
              columns={variablesColumns}
              dataSource={variablesData}
              pagination={false}
              size="small"
              style={{ marginTop: 12 }}
            />
          }
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
        
        <Form
          form={templateForm}
          layout="vertical"
          onFinish={handleTemplateSubmit}
        >
          <Form.Item
            label="模板名称"
            name="name"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="例如: 综合分析" />
          </Form.Item>
          
          <Form.Item
            label="提示词内容"
            name="prompt"
            rules={[{ required: true, message: '请输入提示词' }]}
          >
            <TextArea
              rows={8}
              placeholder="请输入提示词，可使用上方列出的变量..."
            />
          </Form.Item>
          
          <Form.Item
            label="模板描述"
            name="description"
          >
            <Input placeholder="简要描述模板用途" />
          </Form.Item>
          
          <Form.Item
            label="显示顺序"
            name="display_order"
            initialValue={0}
          >
            <InputNumber min={0} max={999} style={{ width: 200 }} />
          </Form.Item>
          
          <Form.Item
            label="启用状态"
            name="is_active"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          
          <Form.Item
            label="设为默认"
            name="is_default"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingTemplate ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setTemplateModalVisible(false);
                templateForm.resetFields();
                setEditingTemplate(null);
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default CalendarConfigSettings;
