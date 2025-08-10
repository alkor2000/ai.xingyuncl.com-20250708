/**
 * 图像模型表单弹窗组件
 */

import React from 'react'
import {
  Modal,
  Form,
  Input,
  Switch,
  InputNumber,
  Row,
  Col,
  Space,
  Button,
  Card,
  Tag,
  Alert,
  Select
} from 'antd'
import {
  PictureOutlined,
  WalletOutlined,
  InfoCircleOutlined,
  ApiOutlined,
  AppstoreOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Option } = Select

// 预设尺寸选项
const presetSizes = [
  '1024x1024',
  '864x1152', 
  '1152x864',
  '1280x720',
  '720x1280',
  '832x1248',
  '1248x832',
  '1512x648'
]

const ImageModelFormModal = ({
  visible,
  editingModel,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()

  // 处理表单提交
  const handleFormSubmit = (values) => {
    // 确保所有可选字段都有值（null而不是undefined）
    const submitData = {
      name: values.name,
      display_name: values.display_name,
      description: values.description || null,
      provider: values.provider || 'volcano',
      endpoint: values.endpoint,
      api_key: values.api_key || null,
      model_id: values.model_id,
      price_per_image: values.price_per_image || 1,
      sizes_supported: values.sizes_supported || ['1024x1024'],
      max_prompt_length: values.max_prompt_length || 1000,
      default_size: values.default_size || '1024x1024',
      default_guidance_scale: values.default_guidance_scale || 2.5,
      example_prompt: values.example_prompt || null,
      example_image: values.example_image || null,
      icon: values.icon || 'PictureOutlined',
      is_active: values.is_active !== false ? 1 : 0,
      sort_order: values.sort_order || 0
    }
    
    onSubmit(submitData)
  }

  return (
    <Modal
      title={editingModel ? '编辑图像模型' : '创建图像模型'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={800}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFormSubmit}
        initialValues={{
          provider: 'volcano',
          price_per_image: 40,
          max_prompt_length: 1000,
          default_size: '1024x1024',
          default_guidance_scale: 2.5,
          sizes_supported: ['1024x1024'],
          icon: 'PictureOutlined',
          is_active: true,
          sort_order: 0
        }}
      >
        {/* 编辑模式的提示信息 */}
        {editingModel && (
          <Alert
            message="编辑提示"
            description="API密钥字段留空表示不修改原有配置"
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 基本信息 */}
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="模型标识"
                rules={[{ required: true, message: '请输入模型标识' }]}
                extra="唯一标识，如: doubao-seeddream-3.0"
              >
                <Input 
                  placeholder="doubao-seeddream-3.0" 
                  disabled={!!editingModel} 
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="display_name"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
                extra="用户界面显示的名称"
              >
                <Input placeholder="豆包-SeedDream-3.0" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="provider"
                label="提供商"
                rules={[{ required: true, message: '请选择提供商' }]}
              >
                <Select placeholder="选择提供商">
                  <Option value="volcano">火山引擎</Option>
                  <Option value="openai">OpenAI</Option>
                  <Option value="stable-diffusion">Stable Diffusion</Option>
                  <Option value="midjourney">Midjourney</Option>
                  <Option value="other">其他</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="model_id"
                label="模型ID"
                rules={[{ required: true, message: '请输入模型ID' }]}
                extra="API调用时使用的模型ID"
              >
                <Input placeholder="doubao-seeddream-3-0-t2i-250415" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="模型描述"
          >
            <TextArea 
              rows={2} 
              placeholder="火山方舟豆包文生图大模型，支持多种尺寸和风格" 
            />
          </Form.Item>
        </Card>

        {/* API配置 */}
        <Card 
          title={
            <Space>
              <ApiOutlined style={{ color: '#1677ff' }} />
              <span>API配置</span>
            </Space>
          } 
          size="small" 
          style={{ marginBottom: 16 }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="endpoint"
                label="API端点"
                rules={[{ required: true, message: '请输入API端点' }]}
                extra="API请求地址"
              >
                <Input 
                  placeholder="https://ark.cn-beijing.volcanicengineapi.com/api/v3/images/generations" 
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="api_key"
                label={
                  <Space>
                    API密钥
                    {editingModel && (
                      <Tag color="blue" style={{ fontSize: '12px' }}>
                        留空保持不变
                      </Tag>
                    )}
                  </Space>
                }
                rules={[{ required: !editingModel, message: '请输入API密钥' }]}
                extra={editingModel ? "如需更新密钥，请输入新的API密钥" : "将被加密存储"}
              >
                <Input.Password 
                  placeholder={editingModel ? "留空表示不修改" : "sk-..."} 
                  autoComplete="new-password"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 生成配置 */}
        <Card 
          title={
            <Space>
              <AppstoreOutlined style={{ color: '#52c41a' }} />
              <span>生成配置</span>
            </Space>
          } 
          size="small" 
          style={{ marginBottom: 16 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="price_per_image"
                label="每张图片积分"
                rules={[{ required: true, message: '请输入积分数' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={10000}
                  placeholder="40"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="max_prompt_length"
                label="最大提示词长度"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={100}
                  max={10000}
                  placeholder="1000"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="default_guidance_scale"
                label="默认引导系数"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={10}
                  step={0.5}
                  placeholder="2.5"
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="default_size"
                label="默认尺寸"
              >
                <Select placeholder="选择默认尺寸">
                  {presetSizes.map(size => (
                    <Option key={size} value={size}>{size}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="sizes_supported"
                label="支持的尺寸"
              >
                <Select 
                  mode="multiple" 
                  placeholder="选择支持的尺寸"
                >
                  {presetSizes.map(size => (
                    <Option key={size} value={size}>{size}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 示例配置（可选） */}
        <Card 
          title={
            <Space>
              <PictureOutlined style={{ color: '#faad14' }} />
              <span>示例配置（可选）</span>
            </Space>
          } 
          size="small" 
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="example_prompt"
            label="示例提示词"
          >
            <TextArea 
              rows={2} 
              placeholder="一只可爱的卡通猫咪，坐在窗台上看夕阳，温暖的色调，柔和的光线" 
            />
          </Form.Item>
          <Form.Item
            name="example_image"
            label="示例图片URL"
          >
            <Input placeholder="https://example.com/sample.jpg" />
          </Form.Item>
        </Card>

        {/* 其他设置 */}
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name="icon"
              label="图标"
            >
              <Input placeholder="PictureOutlined" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item 
              name="is_active" 
              label="状态" 
              valuePropName="checked"
            >
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item 
              name="sort_order" 
              label="排序"
            >
              <InputNumber 
                min={0} 
                style={{ width: '100%' }} 
                placeholder="0"
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            <Button onClick={onCancel}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingModel ? '更新' : '创建'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ImageModelFormModal
