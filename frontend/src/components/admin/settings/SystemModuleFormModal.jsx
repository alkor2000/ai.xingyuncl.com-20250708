/**
 * 系统模块表单弹窗组件 - 支持JWT认证配置（优化布局）
 */

import React, { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Row,
  Col,
  Space,
  Button,
  InputNumber,
  Divider,
  Alert,
  Tooltip,
  Card,
  Tag
} from 'antd'
import { 
  QuestionCircleOutlined,
  LockOutlined,
  KeyOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'
import * as Icons from '@ant-design/icons'

const { TextArea } = Input

// 常用图标列表
const commonIcons = [
  'AppstoreOutlined',
  'ApiOutlined',
  'CloudOutlined',
  'DatabaseOutlined',
  'FileTextOutlined',
  'FolderOutlined',
  'GlobalOutlined',
  'HomeOutlined',
  'LinkOutlined',
  'PictureOutlined',
  'ProjectOutlined',
  'RocketOutlined',
  'SettingOutlined',
  'TeamOutlined',
  'ToolOutlined',
  'UserOutlined',
  'VideoCameraOutlined',
  'BarChartOutlined',
  'CodeOutlined',
  'DashboardOutlined'
]

// JWT算法选项
const jwtAlgorithms = [
  { value: 'HS256', label: 'HS256 (HMAC SHA256)' },
  { value: 'HS384', label: 'HS384 (HMAC SHA384)' },
  { value: 'HS512', label: 'HS512 (HMAC SHA512)' },
  { value: 'RS256', label: 'RS256 (RSA SHA256)' }
]

// Token传递方式选项
const tokenMethods = [
  { value: 'query', label: 'URL参数', description: '将token作为URL参数传递' },
  { value: 'header', label: 'Header', description: '在Authorization header中传递' },
  { value: 'cookie', label: 'Cookie', description: '通过Cookie传递' },
  { value: 'post', label: 'POST Body', description: '作为POST表单数据提交' }
]

const SystemModuleFormModal = ({
  visible,
  editingModule,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()
  const { userGroups, getUserGroups } = useAdminStore()
  const [authMode, setAuthMode] = useState('none')
  const [tokenMethod, setTokenMethod] = useState('query')

  // 加载用户组列表
  useEffect(() => {
    if (visible) {
      getUserGroups()
    }
  }, [visible, getUserGroups])

  // 设置编辑时的默认值
  useEffect(() => {
    if (editingModule && visible) {
      const authConfig = editingModule.config?.auth || {}
      form.setFieldsValue({
        ...editingModule,
        allowed_groups: editingModule.allowed_groups || [],
        auth_mode: editingModule.auth_mode || 'none',
        // JWT配置
        jwt_secret: authConfig.secret || '',
        jwt_algorithm: authConfig.algorithm || 'HS256',
        jwt_expires_in: authConfig.expiresIn || 3600,
        jwt_token_method: authConfig.tokenMethod || 'query',
        jwt_token_field: authConfig.tokenField || 'token',
        // Payload配置
        jwt_include_sub: authConfig.payload?.includes?.includes('sub') !== false,
        jwt_include_name: authConfig.payload?.includes?.includes('name') !== false,
        jwt_include_email: authConfig.payload?.includes?.includes('email') !== false,
        jwt_include_role: authConfig.payload?.includes?.includes('role') || false
      })
      setAuthMode(editingModule.auth_mode || 'none')
      setTokenMethod(authConfig.tokenMethod || 'query')
    }
  }, [editingModule, visible, form])

  // 处理表单提交
  const handleSubmit = (values) => {
    // 构造提交数据
    const submitData = {
      name: values.name,
      display_name: values.display_name,
      description: values.description,
      module_url: values.module_url,
      open_mode: values.open_mode,
      menu_icon: values.menu_icon,
      sort_order: values.sort_order,
      allowed_groups: values.allowed_groups,
      is_active: values.is_active,
      auth_mode: values.auth_mode
    }

    // 如果是JWT认证，构造config对象
    if (values.auth_mode === 'jwt') {
      const payloadIncludes = []
      if (values.jwt_include_sub) payloadIncludes.push('sub')
      if (values.jwt_include_name) payloadIncludes.push('name')
      if (values.jwt_include_email) payloadIncludes.push('email')
      if (values.jwt_include_role) payloadIncludes.push('role')

      submitData.config = {
        auth: {
          secret: values.jwt_secret,
          algorithm: values.jwt_algorithm,
          expiresIn: values.jwt_expires_in,
          tokenMethod: values.jwt_token_method,
          tokenField: values.jwt_token_field,
          payload: {
            includes: payloadIncludes
          }
        }
      }
    }

    onSubmit(submitData)
  }

  return (
    <Modal
      title={
        <Space>
          {editingModule ? t('admin.modules.editModule') : t('admin.modules.addModule')}
          {authMode === 'jwt' && <Tag color="blue" icon={<LockOutlined />}>JWT认证</Tag>}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={900}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          open_mode: 'new_tab',
          menu_icon: 'AppstoreOutlined',
          is_active: true,
          sort_order: 0,
          auth_mode: 'none',
          jwt_algorithm: 'HS256',
          jwt_expires_in: 3600,
          jwt_token_method: 'query',
          jwt_token_field: 'token',
          jwt_include_sub: true,
          jwt_include_name: true,
          jwt_include_email: true,
          jwt_include_role: false
        }}
      >
        <Card title="基础信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label={t('admin.modules.form.name')}
                rules={[
                  { required: true, message: '请输入模块标识' },
                  { pattern: /^[a-z][a-z0-9-]*$/, message: '只能包含小写字母、数字和横线，且以字母开头' }
                ]}
              >
                <Input 
                  placeholder="如: project-management" 
                  disabled={!!editingModule} 
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="display_name"
                label={t('admin.modules.form.displayName')}
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="如: 项目管理系统" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item 
            name="module_url" 
            label="模块URL"
            rules={[
              { required: true, message: '请输入模块URL' },
              { type: 'url', message: '请输入有效的URL' }
            ]}
          >
            <Input placeholder="https://example.com/app" />
          </Form.Item>

          <Form.Item name="description" label={t('admin.modules.form.description')}>
            <TextArea rows={2} placeholder="描述模块的功能和用途" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                name="open_mode" 
                label="打开方式"
                rules={[{ required: true }]}
              >
                <Select>
                  <Select.Option value="new_tab">新标签页</Select.Option>
                  <Select.Option value="iframe">内嵌显示</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="menu_icon"
                label="菜单图标"
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  placeholder="选择图标"
                >
                  {commonIcons.map(iconName => {
                    const IconComponent = Icons[iconName]
                    return (
                      <Select.Option key={iconName} value={iconName}>
                        <Space>
                          {IconComponent && <IconComponent />}
                          <span>{iconName}</span>
                        </Space>
                      </Select.Option>
                    )
                  })}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="sort_order"
                label="排序顺序"
                tooltip="数值越小越靠前"
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="认证配置" size="small" style={{ marginBottom: 16 }}>
          <Form.Item 
            name="auth_mode" 
            label={
              <Space>
                认证方式
                <Tooltip title="选择模块的认证方式，无认证则直接跳转">
                  <QuestionCircleOutlined />
                </Tooltip>
              </Space>
            }
          >
            <Select 
              onChange={(value) => setAuthMode(value)}
              placeholder="选择认证方式"
            >
              <Select.Option value="none">
                <Space>
                  <span>无认证</span>
                  <span style={{ color: '#999', fontSize: 12 }}>直接跳转或嵌入</span>
                </Space>
              </Select.Option>
              <Select.Option value="jwt">
                <Space>
                  <LockOutlined />
                  <span>JWT认证</span>
                  <span style={{ color: '#999', fontSize: 12 }}>自动生成并传递JWT Token</span>
                </Space>
              </Select.Option>
              <Select.Option value="oauth" disabled>
                <Space>
                  <span>OAuth 2.0</span>
                  <span style={{ color: '#999', fontSize: 12 }}>即将支持</span>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          {authMode === 'jwt' && (
            <>
              <Alert
                message="JWT认证配置"
                description="系统会在用户访问模块时自动生成JWT Token并传递给目标系统"
                type="info"
                showIcon
                icon={<KeyOutlined />}
                style={{ marginBottom: 16 }}
              />

              <Row gutter={16}>
                <Col span={16}>
                  <Form.Item
                    name="jwt_secret"
                    label="密钥 (Secret)"
                    rules={[{ required: authMode === 'jwt', message: '请输入JWT密钥' }]}
                    extra="请与目标系统保持一致，用于签名验证"
                  >
                    <Input.Password 
                      placeholder="输入与目标系统约定的密钥" 
                      autoComplete="new-password"
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="jwt_algorithm"
                    label="签名算法"
                    rules={[{ required: authMode === 'jwt' }]}
                  >
                    <Select>
                      {jwtAlgorithms.map(algo => (
                        <Select.Option key={algo.value} value={algo.value}>
                          {algo.label}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="jwt_expires_in"
                    label="Token有效期（秒）"
                    rules={[{ required: authMode === 'jwt' }]}
                  >
                    <InputNumber 
                      min={60} 
                      max={86400} 
                      style={{ width: '100%' }}
                      placeholder="3600"
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="jwt_token_method"
                    label="Token传递方式"
                    rules={[{ required: authMode === 'jwt' }]}
                  >
                    <Select onChange={(value) => setTokenMethod(value)}>
                      {tokenMethods.map(method => (
                        <Select.Option key={method.value} value={method.value}>
                          {method.label}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="jwt_token_field"
                    label={
                      tokenMethod === 'query' ? 'URL参数名' :
                      tokenMethod === 'cookie' ? 'Cookie名称' :
                      tokenMethod === 'post' ? '表单字段名' :
                      'Header名称'
                    }
                    rules={[{ required: authMode === 'jwt' }]}
                  >
                    <Input 
                      placeholder={
                        tokenMethod === 'header' ? 'Authorization' : 'token'
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left" style={{ fontSize: 14 }}>Payload配置</Divider>
              
              <Alert
                message="选择要包含在JWT Payload中的用户信息"
                type="info"
                style={{ marginBottom: 16 }}
              />

              <Space direction="vertical" style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Form.Item name="jwt_include_sub" valuePropName="checked">
                      <Space>
                        <Switch />
                        <span>用户ID (sub)</span>
                      </Space>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="jwt_include_name" valuePropName="checked">
                      <Space>
                        <Switch />
                        <span>用户名 (name)</span>
                      </Space>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="jwt_include_email" valuePropName="checked">
                      <Space>
                        <Switch />
                        <span>邮箱 (email)</span>
                      </Space>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="jwt_include_role" valuePropName="checked">
                      <Space>
                        <Switch />
                        <span>角色 (role)</span>
                      </Space>
                    </Form.Item>
                  </Col>
                </Row>
              </Space>
            </>
          )}
        </Card>

        <Card title="访问控制" size="small">
          <Row gutter={16}>
            <Col span={18}>
              <Form.Item 
                name="allowed_groups" 
                label="允许访问的用户组"
                tooltip="不选择则所有用户都可访问"
              >
                <Select
                  mode="multiple"
                  placeholder="选择允许访问的用户组"
                  allowClear
                >
                  {userGroups.map(group => (
                    <Select.Option key={group.id} value={group.id}>
                      {group.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item 
                name="is_active" 
                label={t('admin.modules.form.isActive')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0, marginTop: 16 }}>
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
