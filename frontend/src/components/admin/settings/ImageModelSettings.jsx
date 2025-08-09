/**
 * 图像模型管理组件
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Popconfirm,
  Tooltip
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PoweroffOutlined,
  KeyOutlined,
  FireOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;

const ImageModelSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState(null);

  // 加载模型列表
  const loadModels = async () => {
    setLoading(true);
    try {
      const response = await api.get('/image/admin/models');
      if (response.data.success) {
        setModels(response.data.data);
      }
    } catch (error) {
      console.error('加载图像模型失败:', error);
      message.error('加载模型列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  // 处理表单提交
  const handleSubmit = async (values) => {
    try {
      // 处理sizes_supported字段
      const processedValues = { ...values };
      if (values.sizes_supported) {
        try {
          // 尝试解析JSON字符串
          const sizesArray = JSON.parse(values.sizes_supported);
          if (!Array.isArray(sizesArray)) {
            message.error('尺寸配置必须是JSON数组格式');
            return;
          }
          processedValues.sizes_supported = sizesArray;
        } catch (error) {
          message.error('尺寸配置格式错误，请输入有效的JSON数组');
          return;
        }
      }

      if (editingModel) {
        // 更新模型
        const response = await api.put(`/image/admin/models/${editingModel.id}`, processedValues);
        if (response.data.success) {
          message.success('模型更新成功');
          setModalVisible(false);
          form.resetFields();
          setEditingModel(null);
          loadModels();
        }
      } else {
        // 创建模型
        const response = await api.post('/image/admin/models', processedValues);
        if (response.data.success) {
          message.success('模型创建成功');
          setModalVisible(false);
          form.resetFields();
          loadModels();
        }
      }
    } catch (error) {
      console.error('保存模型失败:', error);
      message.error(error.response?.data?.message || '保存失败');
    }
  };

  // 切换模型状态
  const toggleModelStatus = async (id) => {
    try {
      const response = await api.patch(`/image/admin/models/${id}/toggle`);
      if (response.data.success) {
        message.success('状态更新成功');
        loadModels();
      }
    } catch (error) {
      console.error('切换状态失败:', error);
      message.error('操作失败');
    }
  };

  // 删除模型
  const deleteModel = async (id) => {
    try {
      const response = await api.delete(`/image/admin/models/${id}`);
      if (response.data.success) {
        message.success('模型删除成功');
        loadModels();
      }
    } catch (error) {
      console.error('删除模型失败:', error);
      message.error('删除失败');
    }
  };

  // 打开编辑窗口
  const openEditModal = (model) => {
    setEditingModel(model);
    form.setFieldsValue({
      ...model,
      sizes_supported: model.sizes_supported ? JSON.stringify(model.sizes_supported, null, 2) : '',
      api_key: '' // 编辑时不显示原密钥
    });
    setModalVisible(true);
  };

  // 打开新增窗口 - 修复bug：应该设置为true
  const openAddModal = () => {
    setEditingModel(null);
    form.resetFields();
    setModalVisible(true); // 修复：这里应该是true，不是false
  };

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (text, record) => (
        <Space>
          <FireOutlined style={{ color: '#ff6b6b' }} />
          <div>
            <div>{text}</div>
            <div style={{ fontSize: '12px', color: '#8c8c8c' }}>{record.name}</div>
          </div>
        </Space>
      )
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      render: (provider) => (
        <Tag color={provider === 'volcano' ? 'red' : 'blue'}>
          {provider}
        </Tag>
      )
    },
    {
      title: '模型ID',
      dataIndex: 'model_id',
      key: 'model_id',
      ellipsis: true
    },
    {
      title: '单价(积分)',
      dataIndex: 'price_per_image',
      key: 'price_per_image',
      render: (price) => (
        <Tag color="blue">{price} 积分/张</Tag>
      )
    },
    {
      title: 'API配置',
      key: 'api_config',
      render: (_, record) => (
        <Space>
          {record.has_api_key ? (
            <Tag icon={<CheckCircleOutlined />} color="success">已配置</Tag>
          ) : (
            <Tag icon={<CloseCircleOutlined />} color="error">未配置</Tag>
          )}
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive) => (
        <Tag color={isActive ? 'success' : 'default'}>
          {isActive ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          <Tooltip title={record.is_active ? '禁用' : '启用'}>
            <Button
              type="link"
              icon={<PoweroffOutlined />}
              onClick={() => toggleModelStatus(record.id)}
              style={{ color: record.is_active ? '#ff4d4f' : '#52c41a' }}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除这个模型吗？"
            onConfirm={() => deleteModel(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card
      title="图像生成模型管理"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAddModal}
        >
          添加模型
        </Button>
      }
    >
      <Table
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={loading}
        pagination={false}
      />

      <Modal
        title={editingModel ? '编辑模型' : '添加模型'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingModel(null);
        }}
        onOk={() => form.submit()}
        width={700}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="name"
            label="模型标识"
            rules={[{ required: true, message: '请输入模型标识' }]}
            extra="唯一标识，如：volcano_seedream"
          >
            <Input placeholder="模型标识" disabled={!!editingModel} />
          </Form.Item>

          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="如：火山方舟 SeedDream" />
          </Form.Item>

          <Form.Item
            name="description"
            label="模型描述"
          >
            <TextArea rows={2} placeholder="描述模型的功能特点" />
          </Form.Item>

          <Form.Item
            name="provider"
            label="提供商"
            rules={[{ required: true }]}
            initialValue="volcano"
          >
            <Select>
              <Select.Option value="volcano">火山方舟</Select.Option>
              <Select.Option value="openai">OpenAI</Select.Option>
              <Select.Option value="stable-diffusion">Stable Diffusion</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="endpoint"
            label="API端点"
            rules={[{ required: true, message: '请输入API端点' }]}
          >
            <Input placeholder="https://ark.cn-beijing.volces.com/api/v3/images/generations" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API密钥"
            extra={editingModel ? "留空则不更新密钥" : "请输入API密钥"}
            rules={editingModel ? [] : [{ required: true, message: '请输入API密钥' }]}
          >
            <Input.Password placeholder="输入API密钥" />
          </Form.Item>

          <Form.Item
            name="model_id"
            label="模型ID"
            rules={[{ required: true, message: '请输入模型ID' }]}
          >
            <Input placeholder="如：doubao-seedream-3-0-t2i-250415" />
          </Form.Item>

          <Form.Item
            name="price_per_image"
            label="单价（积分/张）"
            rules={[{ required: true }]}
            initialValue={2}
          >
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="sizes_supported"
            label="支持的尺寸（JSON数组）"
            extra='如：["1024x1024", "864x1152", "1280x720"]'
            initialValue='["1024x1024"]'
          >
            <TextArea 
              rows={3} 
              placeholder='["1024x1024", "864x1152"]'
            />
          </Form.Item>

          <Form.Item
            name="default_size"
            label="默认尺寸"
            initialValue="1024x1024"
          >
            <Input placeholder="1024x1024" />
          </Form.Item>

          <Form.Item
            name="default_guidance_scale"
            label="默认引导系数"
            initialValue={2.5}
          >
            <InputNumber min={1} max={10} step={0.5} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="sort_order"
            label="排序"
            initialValue={0}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="启用"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default ImageModelSettings;
