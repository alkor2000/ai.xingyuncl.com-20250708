/**
 * 系统模块表单弹窗组件
 */

import React from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Row,
  Col,
  Space,
  Button
} from 'antd'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

const SystemModuleFormModal = ({
  visible,
  editingModule,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={editingModule ? '编辑系统模块' : '创建系统模块'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={800}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="模块标识"
              rules={[{ required: true, message: '请输入模块标识' }]}
            >
              <Input 
                placeholder="如: ai-image-generator" 
                disabled={!!editingModule} 
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="display_name"
              label="显示名称"
              rules={[{ required: true, message: '请输入显示名称' }]}
            >
              <Input placeholder="如: AI图像生成" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="description" label="模块描述">
          <TextArea rows={2} placeholder="描述模块的功能和用途" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item 
              name="module_type" 
              label="模块类型" 
              rules={[{ required: true }]}
            >
              <Select>
                <Select.Option value="frontend">前端模块</Select.Option>
                <Select.Option value="backend">后端模块</Select.Option>
                <Select.Option value="fullstack">全栈模块</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item 
              name="auth_mode" 
              label="认证模式" 
              rules={[{ required: true }]}
            >
              <Select>
                <Select.Option value="jwt">JWT认证</Select.Option>
                <Select.Option value="oauth">OAuth认证</Select.Option>
                <Select.Option value="none">无认证</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="proxy_path"
              label="代理路径"
              rules={[{ required: true, message: '请输入代理路径' }]}
            >
              <Input placeholder="/image-generation" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="api_endpoint" label="后端API地址">
              <Input placeholder="http://localhost:5000/api" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="frontend_url" label="前端地址">
              <Input placeholder="http://localhost:5001" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="health_check_url" label="健康检查地址">
          <Input placeholder="http://localhost:5000/health" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="permissions" label="所需权限">
              <Select mode="tags" placeholder="添加权限标识">
                <Select.Option value="image.generate">image.generate</Select.Option>
                <Select.Option value="image.view">image.view</Select.Option>
                <Select.Option value="code.generate">code.generate</Select.Option>
                <Select.Option value="document.process">document.process</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item 
              name="is_active" 
              label="启用状态" 
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingModule ? t('button.update') : t('button.create')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SystemModuleFormModal
