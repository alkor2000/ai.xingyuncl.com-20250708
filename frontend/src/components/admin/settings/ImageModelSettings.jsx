/**
 * 图像模型管理组件
 * 
 * 更新记录：
 * - 添加图生图功能开关和配置
 * - 2025-12-24: 添加阿里云通义万相(dashscope/aliyun)提供商支持
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
  Tooltip,
  Alert,
  Divider,
  Row,
  Col
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PoweroffOutlined,
  KeyOutlined,
  FireOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PictureOutlined,
  UploadOutlined,
  CloudOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;

// 提供商配置信息
const PROVIDER_CONFIG = {
  volcano: {
    label: '火山方舟',
    color: 'red',
    defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    defaultSizes: '["1024x1024", "864x1152", "1152x864", "1280x720", "720x1280"]',
    description: '火山引擎Seedream系列模型'
  },
  dashscope: {
    label: '阿里云百炼(万相)',
    color: 'orange',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    defaultSizes: '["1280*1280", "1024*1024", "1280*960", "960*1280", "1280*720", "720*1280"]',
    description: '阿里云通义万相2.6图像生成模型'
  },
  aliyun: {
    label: '阿里云(万相)',
    color: 'orange',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    defaultSizes: '["1280*1280", "1024*1024", "1280*960", "960*1280", "1280*720", "720*1280"]',
    description: '阿里云通义万相图像生成模型'
  },
  midjourney: {
    label: 'Midjourney',
    color: 'purple',
    defaultEndpoint: '',
    defaultSizes: '["1:1", "4:3", "3:4", "16:9", "9:16"]',
    description: 'Midjourney图像生成服务'
  },
  openai: {
    label: 'OpenAI',
    color: 'green',
    defaultEndpoint: 'https://api.openai.com/v1/images/generations',
    defaultSizes: '["1024x1024", "1792x1024", "1024x1792"]',
    description: 'OpenAI DALL-E图像生成模型'
  },
  'stable-diffusion': {
    label: 'Stable Diffusion',
    color: 'blue',
    defaultEndpoint: '',
    defaultSizes: '["1024x1024", "512x512"]',
    description: 'Stability AI图像生成模型'
  }
};

const ImageModelSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [toggleLoading, setToggleLoading] = useState({}); // 记录每个开关的加载状态
  const [supportsImage2Image, setSupportsImage2Image] = useState(false); // 图生图功能开关状态
  const [currentProvider, setCurrentProvider] = useState('volcano'); // 当前选择的提供商

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

      // 处理api_config字段 - 合并图生图配置
      let apiConfig = {};
      
      // 如果是编辑模式，先获取原有的api_config
      if (editingModel && editingModel.api_config) {
        apiConfig = { ...editingModel.api_config };
      }
      
      // 尝试解析用户输入的api_config（如果有）
      if (values.api_config_json) {
        try {
          const userConfig = JSON.parse(values.api_config_json);
          apiConfig = { ...apiConfig, ...userConfig };
        } catch (error) {
          message.error('API配置JSON格式错误');
          return;
        }
      }
      
      // 合并图生图相关配置
      apiConfig.supports_image2image = values.supports_image2image || false;
      if (values.supports_image2image) {
        apiConfig.max_reference_images = values.max_reference_images || 2;
      }
      
      // 将处理后的api_config添加到提交数据中
      processedValues.api_config = apiConfig;
      delete processedValues.api_config_json; // 删除临时字段
      delete processedValues.supports_image2image; // 删除临时字段
      delete processedValues.max_reference_images; // 删除临时字段

      // 修复：编辑时如果API密钥为空，从提交数据中删除该字段
      if (editingModel && (!processedValues.api_key || processedValues.api_key === '')) {
        delete processedValues.api_key;
      }

      if (editingModel) {
        // 更新模型
        const response = await api.put(`/image/admin/models/${editingModel.id}`, processedValues);
        if (response.data.success) {
          message.success('模型更新成功');
          setModalVisible(false);
          form.resetFields();
          setEditingModel(null);
          setSupportsImage2Image(false);
          setCurrentProvider('volcano');
          loadModels();
        }
      } else {
        // 创建模型
        const response = await api.post('/image/admin/models', processedValues);
        if (response.data.success) {
          message.success('模型创建成功');
          setModalVisible(false);
          form.resetFields();
          setSupportsImage2Image(false);
          setCurrentProvider('volcano');
          loadModels();
        }
      }
    } catch (error) {
      console.error('保存模型失败:', error);
      message.error(error.response?.data?.message || '保存失败');
    }
  };

  // 切换模型状态 - 改进版，支持直接Switch操作
  const handleToggleStatus = async (id, currentStatus) => {
    // 设置当前模型的loading状态
    setToggleLoading({ ...toggleLoading, [id]: true });
    
    try {
      const response = await api.patch(`/image/admin/models/${id}/toggle`);
      if (response.data.success) {
        // 直接更新本地状态，避免重新加载整个列表
        setModels(prevModels => 
          prevModels.map(model => 
            model.id === id 
              ? { ...model, is_active: currentStatus ? 0 : 1 }
              : model
          )
        );
        message.success(`模型已${currentStatus ? '禁用' : '启用'}`);
      }
    } catch (error) {
      console.error('切换状态失败:', error);
      message.error('操作失败');
    } finally {
      // 清除loading状态
      setToggleLoading({ ...toggleLoading, [id]: false });
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
    setCurrentProvider(model.provider || 'volcano');
    
    // 设置表单初始值
    const formValues = {
      ...model,
      sizes_supported: model.sizes_supported ? JSON.stringify(model.sizes_supported, null, 2) : '',
      api_key: '', // 编辑时不显示原密钥
      supports_image2image: model.api_config?.supports_image2image || false,
      max_reference_images: model.api_config?.max_reference_images || 2
    };
    
    // 将其他api_config内容转为JSON字符串（排除图生图相关字段）
    if (model.api_config) {
      const { supports_image2image, max_reference_images, ...otherConfig } = model.api_config;
      if (Object.keys(otherConfig).length > 0) {
        formValues.api_config_json = JSON.stringify(otherConfig, null, 2);
      }
    }
    
    form.setFieldsValue(formValues);
    setSupportsImage2Image(model.api_config?.supports_image2image || false);
    setModalVisible(true);
  };

  // 打开新增窗口
  const openAddModal = () => {
    setEditingModel(null);
    setSupportsImage2Image(false);
    setCurrentProvider('volcano');
    form.resetFields();
    setModalVisible(true);
  };

  // 处理提供商变更 - 自动填充默认值
  const handleProviderChange = (provider) => {
    setCurrentProvider(provider);
    const config = PROVIDER_CONFIG[provider];
    if (config && !editingModel) {
      // 只在新建时自动填充
      form.setFieldsValue({
        endpoint: config.defaultEndpoint,
        sizes_supported: config.defaultSizes
      });
    }
  };

  // 获取提供商颜色
  const getProviderColor = (provider) => {
    return PROVIDER_CONFIG[provider]?.color || 'default';
  };

  // 获取提供商标签
  const getProviderLabel = (provider) => {
    return PROVIDER_CONFIG[provider]?.label || provider;
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
        <Tag color={getProviderColor(provider)}>
          {getProviderLabel(provider)}
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
          {record.api_config?.supports_image2image && (
            <Tag icon={<PictureOutlined />} color="processing">图生图</Tag>
          )}
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      align: 'center',
      render: (isActive, record) => (
        <Tooltip title={`点击${isActive ? '禁用' : '启用'}模型`}>
          <Switch
            checked={!!isActive}
            onChange={() => handleToggleStatus(record.id, isActive)}
            loading={toggleLoading[record.id] || false}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            style={{ minWidth: '65px' }}
          />
        </Tooltip>
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

  // 获取当前提供商配置
  const currentProviderConfig = PROVIDER_CONFIG[currentProvider] || PROVIDER_CONFIG.volcano;

  return (
    <Card
      title={
        <Space>
          <FireOutlined style={{ color: '#ff6b6b', fontSize: '20px' }} />
          <span style={{ fontSize: '16px', fontWeight: 'bold' }}>图像生成模型管理</span>
        </Space>
      }
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
      {/* 提示信息 */}
      <Alert
        message="模型管理说明"
        description="您可以通过状态列的开关直接启用或禁用模型。支持图生图的模型会显示相应标记。"
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />
      
      <Table
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={loading}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个模型`
        }}
      />

      <Modal
        title={editingModel ? '编辑模型' : '添加模型'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingModel(null);
          setSupportsImage2Image(false);
          setCurrentProvider('volcano');
        }}
        onOk={() => form.submit()}
        width={800}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          {/* 编辑模式的提示信息 */}
          {editingModel && editingModel.has_api_key && (
            <Alert
              message="API密钥已配置"
              description="当前模型已配置API密钥。如需更新密钥，请在下方输入新密钥；如不需要更新，请保持密钥字段为空。"
              type="info"
              showIcon
              icon={<LockOutlined />}
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="模型标识"
                rules={[{ required: true, message: '请输入模型标识' }]}
                extra="唯一标识，如：volcano_seedream"
              >
                <Input placeholder="模型标识" disabled={!!editingModel} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="display_name"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="如：火山方舟 SeedDream" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="模型描述"
          >
            <TextArea rows={2} placeholder="描述模型的功能特点" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="provider"
                label="提供商"
                rules={[{ required: true }]}
                initialValue="volcano"
              >
                <Select onChange={handleProviderChange}>
                  <Select.Option value="volcano">
                    <Space>
                      <FireOutlined style={{ color: '#ff4d4f' }} />
                      火山方舟
                    </Space>
                  </Select.Option>
                  <Select.Option value="dashscope">
                    <Space>
                      <CloudOutlined style={{ color: '#fa8c16' }} />
                      阿里云百炼(通义万相)
                    </Space>
                  </Select.Option>
                  <Select.Option value="aliyun">
                    <Space>
                      <CloudOutlined style={{ color: '#fa8c16' }} />
                      阿里云(万相)
                    </Space>
                  </Select.Option>
                  <Select.Option value="midjourney">
                    <Space>
                      <PictureOutlined style={{ color: '#722ed1' }} />
                      Midjourney
                    </Space>
                  </Select.Option>
                  <Select.Option value="openai">
                    <Space>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      OpenAI
                    </Space>
                  </Select.Option>
                  <Select.Option value="stable-diffusion">
                    <Space>
                      <PictureOutlined style={{ color: '#1890ff' }} />
                      Stable Diffusion
                    </Space>
                  </Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="generation_type"
                label="生成类型"
                rules={[{ required: true }]}
                initialValue="sync"
                extra="同步模型立即返回结果，异步模型需要轮询状态"
              >
                <Select>
                  <Select.Option value="sync">同步生成</Select.Option>
                  <Select.Option value="async">异步生成</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* 阿里云万相提示 */}
          {(currentProvider === 'dashscope' || currentProvider === 'aliyun') && (
            <Alert
              message="阿里云通义万相配置提示"
              description={
                <div>
                  <p style={{ margin: '4px 0' }}>• 模型ID推荐: <Tag color="blue">wan2.6-image</Tag></p>
                  <p style={{ margin: '4px 0' }}>• API密钥格式: <Tag color="green">sk-xxxxxxxx</Tag> (从百炼平台获取)</p>
                  <p style={{ margin: '4px 0' }}>• 尺寸使用 * 分隔，如: <Tag>1280*1280</Tag></p>
                  <p style={{ margin: '4px 0' }}>• 支持图生图(垫图)功能</p>
                </div>
              }
              type="info"
              showIcon
              icon={<CloudOutlined />}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item
            name="endpoint"
            label="API端点"
            rules={[{ required: true, message: '请输入API端点' }]}
          >
            <Input placeholder={currentProviderConfig.defaultEndpoint || "API端点地址"} />
          </Form.Item>

          <Form.Item
            name="api_key"
            label={
              <Space>
                <span>API密钥</span>
                {editingModel && editingModel.has_api_key && (
                  <Tag color="green" icon={<CheckCircleOutlined />}>
                    已配置
                  </Tag>
                )}
              </Space>
            }
            extra={
              editingModel 
                ? (editingModel.has_api_key 
                    ? "当前已配置密钥，留空则保持不变，输入新值则更新" 
                    : "请输入API密钥")
                : "请输入API密钥"
            }
            rules={
              editingModel 
                ? (editingModel.has_api_key ? [] : [{ required: true, message: '请输入API密钥' }])
                : [{ required: true, message: '请输入API密钥' }]
            }
          >
            <Input.Password 
              placeholder={
                editingModel && editingModel.has_api_key 
                  ? "已配置，留空保持不变" 
                  : "输入API密钥"
              }
              prefix={<KeyOutlined />}
            />
          </Form.Item>

          <Form.Item
            name="model_id"
            label="模型ID"
            rules={[{ required: true, message: '请输入模型ID' }]}
            extra={currentProvider === 'dashscope' || currentProvider === 'aliyun' 
              ? "阿里万相推荐: wan2.6-image" 
              : "如：doubao-seedream-3-0-t2i-250415"}
          >
            <Input placeholder={
              currentProvider === 'dashscope' || currentProvider === 'aliyun'
                ? "wan2.6-image"
                : "doubao-seedream-3-0-t2i-250415"
            } />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="price_per_image"
                label="单价（积分/张）"
                rules={[{ required: true }]}
                initialValue={40}
              >
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="sort_order"
                label="排序"
                initialValue={0}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">
            <Space>
              <PictureOutlined />
              图生图功能配置
            </Space>
          </Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="supports_image2image"
                label="启用图生图（垫图）功能"
                valuePropName="checked"
                extra="开启后用户可以上传参考图片生成新图片"
              >
                <Switch 
                  checkedChildren={<UploadOutlined />}
                  unCheckedChildren={<CloseCircleOutlined />}
                  onChange={(checked) => setSupportsImage2Image(checked)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              {supportsImage2Image && (
                <Form.Item
                  name="max_reference_images"
                  label="最大参考图片数量"
                  initialValue={2}
                  extra="用户一次最多可以上传的参考图片数量"
                >
                  <InputNumber 
                    min={1} 
                    max={5} 
                    style={{ width: '100%' }} 
                    placeholder="建议1-2张"
                  />
                </Form.Item>
              )}
            </Col>
          </Row>

          {supportsImage2Image && (
            <Alert
              message="图生图功能说明"
              description="启用后，用户可以上传参考图片来引导AI生成相似风格或内容的新图片。不同的模型对图生图的支持程度可能不同，建议先测试效果。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider orientation="left">其他配置</Divider>

          <Form.Item
            name="sizes_supported"
            label="支持的尺寸（JSON数组）"
            extra={currentProvider === 'dashscope' || currentProvider === 'aliyun'
              ? '阿里万相格式: ["1280*1280", "1024*1024", "1280*960"]'
              : '如：["1024x1024", "864x1152", "1280x720"]'}
            initialValue='["1024x1024"]'
          >
            <TextArea 
              rows={3} 
              placeholder={currentProviderConfig.defaultSizes || '["1024x1024"]'}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="default_size"
                label="默认尺寸"
                initialValue="1024x1024"
              >
                <Input placeholder={
                  currentProvider === 'dashscope' || currentProvider === 'aliyun'
                    ? "1280*1280"
                    : "1024x1024"
                } />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="default_guidance_scale"
                label="默认引导系数"
                initialValue={2.5}
              >
                <InputNumber min={1} max={10} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="api_config_json"
            label="其他API配置（JSON格式）"
            extra="可选，用于配置其他高级参数"
          >
            <TextArea 
              rows={4} 
              placeholder='{"timeout": 60000, "retry": 3}'
            />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="启用"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default ImageModelSettings;
