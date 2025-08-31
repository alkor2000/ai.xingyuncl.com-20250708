/**
 * 视频模型配置管理组件
 */
import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Switch,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Tag,
  Tooltip,
  Popconfirm
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  VideoCameraOutlined,
  KeyOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { TextArea } = Input;
const { Option } = Select;

const VideoModelSettings = () => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [form] = Form.useForm();

  // 加载模型列表
  const loadModels = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/video/admin/models');
      if (response.data.success) {
        setModels(response.data.data);
      }
    } catch (error) {
      message.error('加载视频模型失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  // 保存模型
  const handleSave = async (values) => {
    try {
      if (editingModel) {
        await apiClient.put(`/video/admin/models/${editingModel.id}`, values);
        message.success('更新成功');
      } else {
        await apiClient.post('/video/admin/models', values);
        message.success('创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      loadModels();
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败');
    }
  };

  // 删除模型
  const handleDelete = async (id) => {
    try {
      await apiClient.delete(`/video/admin/models/${id}`);
      message.success('删除成功');
      loadModels();
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 切换状态
  const handleToggleStatus = async (id) => {
    try {
      await apiClient.patch(`/video/admin/models/${id}/toggle`);
      message.success('状态更新成功');
      loadModels();
    } catch (error) {
      message.error('状态更新失败');
    }
  };

  // 打开编辑弹窗
  const openEditModal = (model) => {
    setEditingModel(model);
    form.setFieldsValue({
      ...model,
      resolutions_supported: model.resolutions_supported || ['720p'],
      durations_supported: model.durations_supported || [5],
      fps_supported: model.fps_supported || [24],
      ratios_supported: model.ratios_supported || ['16:9']
    });
    setModalVisible(true);
  };

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingModel(null);
    form.resetFields();
    form.setFieldsValue({
      provider: 'volcano',
      generation_type: 'async',
      supports_text_to_video: true,
      supports_image_to_video: false,
      supports_first_frame: false,
      supports_last_frame: false,
      resolutions_supported: ['720p'],
      durations_supported: [5],
      fps_supported: [24],
      ratios_supported: ['16:9'],
      default_resolution: '720p',
      default_duration: 5,
      default_fps: 24,
      default_ratio: '16:9',
      base_price: 50,
      max_prompt_length: 500,
      is_active: true,
      sort_order: 0
    });
    setModalVisible(true);
  };

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (text, record) => (
        <Space>
          <VideoCameraOutlined />
          <span>{text}</span>
          {record.has_api_key && (
            <Tooltip title="已配置API密钥">
              <KeyOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      render: (text) => <Tag color="blue">{text}</Tag>
    },
    {
      title: '模型ID',
      dataIndex: 'model_id',
      key: 'model_id',
      ellipsis: true
    },
    {
      title: '支持能力',
      key: 'capabilities',
      render: (_, record) => (
        <Space wrap>
          {record.supports_text_to_video && <Tag color="green">文生视频</Tag>}
          {record.supports_image_to_video && <Tag color="cyan">图生视频</Tag>}
          {record.supports_first_frame && <Tag color="orange">首帧</Tag>}
          {record.supports_last_frame && <Tag color="purple">尾帧</Tag>}
        </Space>
      )
    },
    {
      title: '分辨率',
      dataIndex: 'resolutions_supported',
      key: 'resolutions_supported',
      render: (resolutions) => resolutions?.join(', ')
    },
    {
      title: '基础价格',
      dataIndex: 'base_price',
      key: 'base_price',
      render: (price) => `${price} 积分`
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active, record) => (
        <Switch
          checked={active}
          onChange={() => handleToggleStatus(record.id)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此模型吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card
      title={
        <Space>
          <VideoCameraOutlined />
          <span>视频生成模型配置</span>
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
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
        title={editingModel ? '编辑视频模型' : '添加视频模型'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={800}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
        >
          <Form.Item
            name="name"
            label="模型标识"
            rules={[{ required: true, message: '请输入模型标识' }]}
          >
            <Input placeholder="例如: doubao_seedance_pro" disabled={!!editingModel} />
          </Form.Item>

          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="例如: Doubao-Seedance-1.0-pro" />
          </Form.Item>

          <Form.Item
            name="model_id"
            label="模型ID"
            rules={[{ required: true, message: '请输入模型ID' }]}
          >
            <Input placeholder="例如: doubao-seedance-1-0-pro-250528" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API密钥"
            tooltip="留空则不更新密钥"
          >
            <Input.Password placeholder="请输入API密钥" />
          </Form.Item>

          <Form.Item
            name="endpoint"
            label="API端点"
            rules={[{ required: true, message: '请输入API端点' }]}
          >
            <Input placeholder="例如: https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" />
          </Form.Item>

          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={2} placeholder="模型描述" />
          </Form.Item>

          <Space size="large" style={{ width: '100%' }}>
            <Form.Item
              name="supports_text_to_video"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="文生视频" unCheckedChildren="文生视频" />
            </Form.Item>

            <Form.Item
              name="supports_first_frame"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="首帧图生" unCheckedChildren="首帧图生" />
            </Form.Item>
          </Space>

          <Form.Item
            name="base_price"
            label="基础价格（积分）"
            rules={[{ required: true, message: '请输入基础价格' }]}
          >
            <InputNumber min={0} max={10000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="启用状态"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default VideoModelSettings;
