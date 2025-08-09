/**
 * 系统模块表单弹窗组件 - 支持系统内置模块和外部模块管理
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
  KeyOutlined,
  WarningOutlined,
  AppstoreOutlined,
  GlobalOutlined
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
  'DashboardOutlined',
  'MessageOutlined',
  'AppstoreAddOutlined'
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
  
  // 判断模块类型和权限
  const isSystemModule = editingModule?.module_category === 'system'
  const isCoreModule = isSystemModule && !editingModule?.can_disable
  const isExternalModule = editingModule?.module_category === 'external'

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
    const submitData = {}

    // 系统模块只能修改部分字段
    if (isSystemModule) {
      submitData.display_name = values.display_name
      submitData.description = values.description
      submitData.menu_icon = values.menu_icon
      
      // 非核心系统模块可以修改权限和状态
      if (!isCoreModule) {
        submitData.allowed_groups = values.allowed_groups
        submitData.is_active = values.is_active
      }
    } else {
      // 外部模块可以修改所有字段
      submitData.name = values.name
      submitData.display_name = values.display_name
      submitData.description = values.description
      submitData.module_url = values.module_url
      submitData.open_mode = values.open_mode
      submitData.menu_icon = values.menu_icon
      submitData.sort_order = values.sort_order
      submitData.allowed_groups = values.allowed_groups
      submitData.is_active = values.is_active
      submitData.auth_mode = values.auth_mode

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
    }

    onSubmit(submitData)
  }

  // 渲染模块类型标签
  const renderModuleTypeTag = () => {
    if (isCoreModule) {
      return (
        <Tag icon={<LockOutlined />} color="red">
          核心系统模块
        </Tag>
      )
    }
    if (isSystemModule) {
      return (
        <Tag icon={<AppstoreOutlined />} color="blue">
          系统模块
        </Tag>
      )
    }
    if (isExternalModule) {
      return (
        <Tag icon={<GlobalOutlined />} color="green">
          扩展模块
        </Tag>
      )
    }
    return null
  }

  return (
    <Modal
      title={
        <Space>
          {editingModule ? t('admin.modules.editModule') : t('admin.modules.addModule')}
          {renderModuleTypeTag()}
          {authMode === 'jwt' && !isSystemModule && <Tag color="blue" icon={<LockOutlined />}>JWT认证</Tag>}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={900}
    >
      {/* 系统模块编辑提示 */}
      {isSystemModule && (
        <Alert
          message={
            isCoreModule 
              ? "核心系统模块编辑限制" 
              : "系统模块编辑限制"
          }
          description={
            isCoreModule
              ? "核心管理模块只能修改：显示名称、描述、图标。不能修改访问权限、禁用或删除。"
              : "系统内置模块只能修改：显示名称、描述、图标、访问权限和启用状态。不能修改URL或删除。"
          }
          type={isCoreModule ? "error" : "warning"}
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

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
                  { required: !editingModule, message: '请输入模块标识' },
                  { pattern: /^[a-z][a-z0-9_-]*$/, message: '只能包含小写字母、数字、下划线和横线，且以字母开头' }
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

          {/* 系统模块显示路由路径，外部模块显示URL */}
          {isSystemModule ? (
            <Form.Item 
              label="路由路径"
              extra="系统内置模块的前端路由路径（不可修改）"
            >
              <Input value={editingModule?.route_path} disabled />
            </Form.Item>
          ) : (
            <Form.Item 
              name="module_url" 
              label="模块URL"
              rules={[
                { required: !isSystemModule, message: '请输入模块URL' },
                { type: 'url', message: '请输入有效的URL' }
              ]}
            >
              <Input 
                placeholder="https://example.com/app" 
                disabled={isSystemModule}
              />
            </Form.Item>
          )}

          <Form.Item name="description" label={t('admin.modules.form.description')}>
            <TextArea rows={2} placeholder="描述模块的功能和用途" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                name="open_mode" 
                label="打开方式"
                rules={[{ required: !isSystemModule }]}
              >
                <Select disabled={isSystemModule}>
                  <Select.Option value="iframe">内嵌显示</Select.Option>
                  <Select.Option value="new_tab">新标签页</Select.Option>
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
                <InputNumber 
                  min={0} 
                  style={{ width: '100%' }} 
                  disabled={isSystemModule}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 认证配置 - 只对外部模块显示 */}
        {!isSystemModule && (
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
        )}

        <Card title="访问控制" size="small">
          <Row gutter={16}>
            <Col span={18}>
              <Form.Item 
                name="allowed_groups" 
                label="允许访问的用户组"
                tooltip={isCoreModule ? "核心管理模块不能限制访问权限" : "不选择则所有用户都可访问"}
              >
                <Select
                  mode="multiple"
                  placeholder="选择允许访问的用户组"
                  allowClear
                  disabled={isCoreModule}
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
                tooltip={isCoreModule ? "核心管理模块不能禁用" : ""}
              >
                <Switch disabled={isCoreModule} />
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
