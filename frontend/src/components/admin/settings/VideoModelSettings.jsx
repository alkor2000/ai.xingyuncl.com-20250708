/**
 * 视频模型配置管理组件
 * 支持火山引擎和可灵视频模型
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
  Popconfirm,
  Alert,
  Divider
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  VideoCameraOutlined,
  KeyOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import apiClient from '../../../utils/api';

const { TextArea } = Input;
const { Option } = Select;

// 可灵模型版本选项
const klingModelVersions = [
  { value: 'kling-v1', label: 'Kling V1 基础版' },
  { value: 'kling-v1-5', label: 'Kling V1.5 增强版' },
  { value: 'kling-v1-6', label: 'Kling V1.6 文生/图生视频' },
  { value: 'kling-v2-master', label: 'Kling V2 大师版' },
  { value: 'kling-v2-1', label: 'Kling V2.1 图生视频' },
  { value: 'kling-v2-1-master', label: 'Kling V2.1 大师版' }
];

// 可灵质量模式选项
const klingModeOptions = [
  { value: 'std', label: '标准模式 (720p)' },
  { value: 'pro', label: '专业模式 (1080p)' }
];

const VideoModelSettings = () => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [form] = Form.useForm();
  const [selectedProvider, setSelectedProvider] = useState('volcano');

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

  // 监听provider变化，更新表单字段
  useEffect(() => {
    if (modalVisible) {
      // 根据provider类型设置不同的默认值
      if (selectedProvider === 'kling') {
        form.setFieldsValue({
          endpoint: 'https://api-beijing.klingai.com',
          generation_type: 'async'
        });
      } else if (selectedProvider === 'volcano') {
        form.setFieldsValue({
          endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
          generation_type: 'async'
        });
      }
    }
  }, [selectedProvider, modalVisible, form]);

  // 保存模型
  const handleSave = async (values) => {
    try {
      // 处理API配置
      let apiConfig = {};
      
      if (values.provider === 'kling') {
        // 可灵配置
        apiConfig = {
          access_key: values.kling_access_key,
          secret_key: values.kling_secret_key,
          model_version: values.kling_model_version,
          mode: values.kling_mode || 'std'
        };
        
        // 移除表单中的可灵特定字段
        delete values.kling_access_key;
        delete values.kling_secret_key;
        delete values.kling_model_version;
        delete values.kling_mode;
        
        // 可灵不使用api_key字段
        values.api_key = null;
      } else {
        // 火山引擎配置
        apiConfig = values.api_config || {};
      }
      
      // 设置api_config
      values.api_config = apiConfig;
      
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
    setSelectedProvider(model.provider || 'volcano');
    
    // 解析API配置
    let formValues = { ...model };
    
    if (model.provider === 'kling' && model.api_config) {
      // 可灵模型，从api_config中提取配置
      const config = typeof model.api_config === 'string' 
        ? JSON.parse(model.api_config) 
        : model.api_config;
      
      formValues.kling_access_key = config.access_key;
      formValues.kling_secret_key = config.secret_key;
      formValues.kling_model_version = config.model_version;
      formValues.kling_mode = config.mode;
    }
    
    form.setFieldsValue({
      ...formValues,
      resolutions_supported: formValues.resolutions_supported || ['720p'],
      durations_supported: formValues.durations_supported || [5],
      fps_supported: formValues.fps_supported || [24],
      ratios_supported: formValues.ratios_supported || ['16:9']
    });
    
    setModalVisible(true);
  };

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingModel(null);
    setSelectedProvider('volcano');
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
          {record.provider === 'kling' && (
            <Tag color="purple">可灵</Tag>
          )}
          {record.provider === 'volcano' && (
            <Tag color="blue">火山</Tag>
          )}
          {(record.has_api_key || (record.provider === 'kling' && record.api_config)) && (
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
      render: (text) => {
        const providerMap = {
          'volcano': '火山引擎',
          'kling': '可灵AI'
        };
        return <Tag color={text === 'kling' ? 'purple' : 'blue'}>{providerMap[text] || text}</Tag>;
      }
    },
    {
      title: '模型版本',
      key: 'model_version',
      render: (_, record) => {
        if (record.provider === 'kling' && record.api_config) {
          const config = typeof record.api_config === 'string' 
            ? JSON.parse(record.api_config) 
            : record.api_config;
          return config.model_version || '-';
        }
        return record.model_id || '-';
      },
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
            name="provider"
            label="提供商"
            rules={[{ required: true, message: '请选择提供商' }]}
          >
            <Select 
              placeholder="选择视频生成服务提供商"
              onChange={(value) => setSelectedProvider(value)}
              disabled={!!editingModel}
            >
              <Option value="volcano">火山引擎</Option>
              <Option value="kling">可灵AI</Option>
            </Select>
          </Form.Item>

          {selectedProvider === 'kling' && (
            <Alert
              message="可灵AI配置说明"
              description={
                <div>
                  <p>可灵AI使用JWT认证方式，需要提供Access Key和Secret Key。</p>
                  <p>支持多个模型版本，包括V1、V1.5、V1.6、V2等，不同版本支持不同功能。</p>
                  <p>您提供的密钥：</p>
                  <p><strong>Access Key:</strong> ABQK94AddP4aYKLB8f8H3tgBbkeCNYMR</p>
                  <p><strong>Secret Key:</strong> CDKN9mH9PpK9MKFN4gr9mAYNdfnCC8P4</p>
                </div>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item
            name="name"
            label="模型标识"
            rules={[{ required: true, message: '请输入模型标识' }]}
          >
            <Input 
              placeholder={selectedProvider === 'kling' ? "例如: kling_v1_6_pro" : "例如: doubao_seedance_pro"} 
              disabled={!!editingModel} 
            />
          </Form.Item>

          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder={selectedProvider === 'kling' ? "例如: 可灵V1.6专业版" : "例如: Doubao-Seedance-1.0-pro"} />
          </Form.Item>

          {selectedProvider === 'kling' ? (
            <>
              {/* 可灵特定配置 */}
              <Form.Item
                name="kling_access_key"
                label="Access Key"
                rules={[{ required: !editingModel, message: '请输入Access Key' }]}
                initialValue={editingModel ? undefined : "ABQK94AddP4aYKLB8f8H3tgBbkeCNYMR"}
              >
                <Input.Password 
                  placeholder="请输入Access Key" 
                />
              </Form.Item>

              <Form.Item
                name="kling_secret_key"
                label="Secret Key"
                rules={[{ required: !editingModel, message: '请输入Secret Key' }]}
                initialValue={editingModel ? undefined : "CDKN9mH9PpK9MKFN4gr9mAYNdfnCC8P4"}
              >
                <Input.Password 
                  placeholder="请输入Secret Key"
                />
              </Form.Item>

              <Form.Item
                name="kling_model_version"
                label="模型版本"
                rules={[{ required: true, message: '请选择模型版本' }]}
              >
                <Select placeholder="选择可灵模型版本">
                  {klingModelVersions.map(version => (
                    <Option key={version.value} value={version.value}>
                      {version.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="kling_mode"
                label="默认质量模式"
                rules={[{ required: true, message: '请选择质量模式' }]}
                initialValue="std"
              >
                <Select placeholder="选择默认质量模式">
                  {klingModeOptions.map(mode => (
                    <Option key={mode.value} value={mode.value}>
                      {mode.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              {/* 可灵不需要model_id，但需要endpoint */}
              <Form.Item
                name="endpoint"
                label="API端点"
                rules={[{ required: true, message: '请输入API端点' }]}
                initialValue="https://api-beijing.klingai.com"
              >
                <Input placeholder="https://api-beijing.klingai.com" disabled />
              </Form.Item>
            </>
          ) : (
            <>
              {/* 火山引擎配置 */}
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
                initialValue="https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
              >
                <Input placeholder="例如: https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="description"
            label="描述"
          >
            <TextArea rows={2} placeholder="模型描述" />
          </Form.Item>

          <Divider />

          <Space size="large" style={{ width: '100%' }}>
            <Form.Item
              name="supports_text_to_video"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="文生视频" unCheckedChildren="文生视频" />
            </Form.Item>

            <Form.Item
              name="supports_image_to_video"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="图生视频" unCheckedChildren="图生视频" />
            </Form.Item>

            <Form.Item
              name="supports_first_frame"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="首帧控制" unCheckedChildren="首帧控制" />
            </Form.Item>

            <Form.Item
              name="supports_last_frame"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren="尾帧控制" unCheckedChildren="尾帧控制" />
            </Form.Item>
          </Space>

          <Divider />

          <Form.Item
            name="resolutions_supported"
            label="支持的分辨率"
          >
            <Select mode="multiple" placeholder="选择支持的分辨率">
              <Option value="480p">480p</Option>
              <Option value="720p">720p (高清)</Option>
              <Option value="1080p">1080p (全高清)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="durations_supported"
            label="支持的时长（秒）"
          >
            <Select mode="multiple" placeholder="选择支持的时长">
              <Option value={5}>5秒</Option>
              <Option value={10}>10秒</Option>
            </Select>
          </Form.Item>

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
