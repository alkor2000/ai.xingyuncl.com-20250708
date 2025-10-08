/**
 * 系统模块表单弹窗组件 - 支持系统内置模块和外部模块管理
 * 增强SSO单点登录配置功能
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
  Tag,
  Checkbox
} from 'antd'
import { 
  QuestionCircleOutlined,
  LockOutlined,
  KeyOutlined,
  WarningOutlined,
  AppstoreOutlined,
  GlobalOutlined,
  UserOutlined,
  ApiOutlined,
  LinkOutlined
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
  { value: 'query', label: 'URL参数', description: '将token作为URL参数传递（推荐）' },
  { value: 'header', label: 'Header', description: '在Authorization header中传递' },
  { value: 'cookie', label: 'Cookie', description: '通过Cookie传递' },
  { value: 'post', label: 'POST Body', description: '作为POST表单数据提交' }
]

// 可用的用户字段（用于Payload配置）
const availableUserFields = [
  { field: 'sub', label: '用户ID (sub)', checked: true, description: '标准JWT字段，用户唯一标识' },
  { field: 'uuid', label: 'UUID', checked: true, description: '用户唯一标识符，用于SSO' },
  { field: 'name', label: '用户名 (name)', checked: true, description: '用户登录名' },
  { field: 'username', label: '用户名 (username)', checked: false, description: '备用用户名字段' },
  { field: 'email', label: '邮箱 (email)', checked: true, description: '用户邮箱地址' },
  { field: 'display_name', label: '显示名称', checked: false, description: '用户显示名称' },
  { field: 'role', label: '角色 (role)', checked: false, description: '用户角色' },
  { field: 'avatar', label: '头像', checked: false, description: '用户头像URL' },
  { field: 'phone', label: '电话', checked: false, description: '用户电话号码' },
  { field: 'group_id', label: '组ID', checked: false, description: '用户所属组ID' },
  { field: 'group_name', label: '组名称', checked: false, description: '用户所属组名称' }
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
  const [selectedFields, setSelectedFields] = useState(['sub', 'uuid', 'name', 'email'])
  
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
      const includes = authConfig.payload?.includes || []
      
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
        // SSO配置
        sso_endpoint: authConfig.ssoEndpoint || '',
        callback_url: authConfig.callbackUrl || ''
      })
      
      setAuthMode(editingModule.auth_mode || 'none')
      setTokenMethod(authConfig.tokenMethod || 'query')
      setSelectedFields(includes.length > 0 ? includes : ['sub', 'uuid', 'name', 'email'])
    } else {
      // 新建时的默认值
      setSelectedFields(['sub', 'uuid', 'name', 'email'])
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
      
      // 非核心系统模块可以修改权限、状态和排序
      if (!isCoreModule) {
        submitData.allowed_groups = values.allowed_groups
        submitData.is_active = values.is_active
        submitData.sort_order = values.sort_order  // ✅ 修复：允许修改排序
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
        submitData.config = {
          auth: {
            secret: values.jwt_secret,
            algorithm: values.jwt_algorithm,
            expiresIn: values.jwt_expires_in,
            tokenMethod: values.jwt_token_method,
            tokenField: values.jwt_token_field,
            ssoEndpoint: values.sso_endpoint || '',
            callbackUrl: values.callback_url || '',
            payload: {
              includes: selectedFields
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

  // 处理字段选择变化
  const handleFieldChange = (field, checked) => {
    if (checked) {
      setSelectedFields([...selectedFields, field])
    } else {
      setSelectedFields(selectedFields.filter(f => f !== field))
    }
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
              ? "核心管理模块只能修改：显示名称、描述、图标。不能修改访问权限、排序、禁用或删除。"
              : "系统内置模块只能修改：显示名称、描述、图标、访问权限、排序和启用状态。不能修改URL或删除。"
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
          jwt_token_field: 'token'
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
                label={
                  <Space>
                    <span>排序顺序</span>
                    {isCoreModule && (
                      <Tooltip title="核心管理模块的排序由系统固定，不可修改">
                        <LockOutlined style={{ color: '#ff4d4f' }} />
                      </Tooltip>
                    )}
                  </Space>
                }
                tooltip={isCoreModule ? "核心管理模块排序固定" : "数值越小越靠前，同类别模块间排序"}
                extra={
                  !isCoreModule && isSystemModule
                    ? "建议：基础功能1-50，辅助功能51-99，管理功能100+"
                    : !isCoreModule ? "建议：与系统模块错开，使用独立序号段" : null
                }
              >
                <InputNumber 
                  min={0} 
                  style={{ width: '100%' }} 
                  disabled={isCoreModule}  // ✅ 修复：只有核心模块不能改，普通系统模块可以改
                  placeholder={isCoreModule ? "系统固定" : "输入排序数字"}
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
                    <span style={{ color: '#999', fontSize: 12 }}>自动生成并传递JWT Token（SSO）</span>
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
                  message="JWT单点登录(SSO)配置"
                  description={
                    <div>
                      <p>系统会在用户访问模块时自动生成JWT Token并传递给目标系统。</p>
                      <p>目标系统可以通过验证Token获取用户信息，实现自动登录。</p>
                      <p><strong>重要：</strong>Token中包含用户UUID，对方系统可用此创建或登录用户。</p>
                    </div>
                  }
                  type="info"
                  showIcon
                  icon={<ApiOutlined />}
                  style={{ marginBottom: 16 }}
                />

                {/* 基础JWT配置 */}
                <Divider orientation="left" style={{ fontSize: 14 }}>
                  <Space>
                    <KeyOutlined />
                    JWT基础配置
                  </Space>
                </Divider>

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
                      tooltip="建议设置较短的有效期（如300秒）以提高安全性"
                    >
                      <InputNumber 
                        min={60} 
                        max={86400} 
                        style={{ width: '100%' }}
                        placeholder="300"
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

                {/* SSO端点配置 */}
                <Divider orientation="left" style={{ fontSize: 14 }}>
                  <Space>
                    <LinkOutlined />
                    SSO端点配置
                  </Space>
                </Divider>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      name="sso_endpoint"
                      label="SSO登录端点"
                      tooltip="目标系统的SSO登录地址，留空则使用模块URL"
                      extra="如: /api/sso/login 或 https://academy.nebulink.com.cn/sso"
                    >
                      <Input 
                        placeholder="/api/sso/login" 
                        prefix={<ApiOutlined />}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="callback_url"
                      label="回调URL"
                      tooltip="登录成功后的跳转地址"
                      extra="可选，登录成功后跳转到的页面"
                    >
                      <Input 
                        placeholder="/dashboard" 
                        prefix={<LinkOutlined />}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                {/* Payload字段配置 */}
                <Divider orientation="left" style={{ fontSize: 14 }}>
                  <Space>
                    <UserOutlined />
                    Payload字段配置
                  </Space>
                </Divider>
                
                <Alert
                  message="选择要包含在JWT Token中的用户信息"
                  description="UUID是SSO的关键字段，建议始终包含"
                  type="info"
                  style={{ marginBottom: 16 }}
                />

                <div style={{ 
                  border: '1px solid #f0f0f0', 
                  borderRadius: 4, 
                  padding: 16,
                  maxHeight: 300,
                  overflowY: 'auto'
                }}>
                  <Row gutter={[16, 16]}>
                    {availableUserFields.map(item => (
                      <Col span={12} key={item.field}>
                        <Checkbox
                          checked={selectedFields.includes(item.field)}
                          onChange={(e) => handleFieldChange(item.field, e.target.checked)}
                        >
                          <Space direction="vertical" size={0}>
                            <span style={{ fontWeight: item.field === 'uuid' ? 'bold' : 'normal' }}>
                              {item.label}
                              {item.field === 'uuid' && (
                                <Tag color="blue" style={{ marginLeft: 8 }}>SSO关键字段</Tag>
                              )}
                            </span>
                            <span style={{ fontSize: 12, color: '#999' }}>
                              {item.description}
                            </span>
                          </Space>
                        </Checkbox>
                      </Col>
                    ))}
                  </Row>
                </div>

                {/* 配置示例 */}
                <Alert
                  message="配置示例"
                  description={
                    <div style={{ fontSize: 12 }}>
                      <p>假设配置如下：</p>
                      <ul>
                        <li>SSO端点: /api/sso/login</li>
                        <li>Token传递方式: URL参数 (token)</li>
                        <li>包含字段: uuid, username, email</li>
                      </ul>
                      <p>用户点击模块时会跳转到:</p>
                      <code style={{ display: 'block', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        https://academy.nebulink.com.cn/api/sso/login?token=eyJhbGciOiJIUzI1NiIs...
                      </code>
                      <p style={{ marginTop: 8 }}>Token解码后包含:</p>
                      <code style={{ display: 'block', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {JSON.stringify({ uuid: "xxx-xxx-xxx", username: "user1", email: "user@example.com" }, null, 2)}
                      </code>
                    </div>
                  }
                  type="success"
                  style={{ marginTop: 16 }}
                />
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
