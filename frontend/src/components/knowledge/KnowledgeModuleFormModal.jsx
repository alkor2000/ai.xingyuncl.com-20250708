/**
 * 知识模块表单弹窗组件
 */

import React, { useEffect, useState } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Radio,
  Switch,
  InputNumber,
  Tag,
  Space,
  message,
  Alert
} from 'antd'
import {
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  LockOutlined,
  UnlockOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'

const { TextArea } = Input
const { Option } = Select

const KnowledgeModuleFormModal = ({
  visible,
  module,
  onCancel,
  onSuccess,
  canCreateTeam,
  canCreateSystem
}) => {
  const [form] = Form.useForm()
  const { user } = useAuthStore()
  const { createModule, updateModule, getCategories, categories } = useKnowledgeStore()
  const { userGroups, fetchUserGroups } = useAdminStore()
  const [loading, setLoading] = useState(false)
  const [moduleScope, setModuleScope] = useState('personal')

  useEffect(() => {
    if (visible) {
      // 加载分类
      getCategories()
      
      // 如果是超级管理员编辑全局模块，加载用户组列表
      if (canCreateSystem) {
        fetchUserGroups()
      }
      
      if (module) {
        // 编辑模式
        form.setFieldsValue({
          ...module,
          tags: module.tags ? JSON.parse(module.tags) : [],
          group_ids: module.group_ids || [],
          // 添加创建人显示（只读）
          creator_name: module.creator_name || '未知'
        })
        setModuleScope(module.module_scope)
      } else {
        // 创建模式
        form.resetFields()
        form.setFieldsValue({
          module_scope: 'personal',
          prompt_type: 'normal',
          content_visible: true,
          sort_order: 0,
          is_active: true,
          group_ids: [],
          // 新建时显示当前用户为创建人
          creator_name: user.username || user.email
        })
        setModuleScope('personal')
      }
    }
  }, [visible, module, form, getCategories, canCreateSystem, fetchUserGroups, user])

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      // 移除创建人字段（不需要提交）
      const submitData = { ...values }
      delete submitData.creator_name
      
      // 处理标签
      if (submitData.tags && submitData.tags.length > 0) {
        submitData.tags = JSON.stringify(submitData.tags)
      } else {
        submitData.tags = null
      }

      // 个人模块不需要设置内容可见性和group_ids
      if (submitData.module_scope === 'personal') {
        submitData.content_visible = true
        delete submitData.group_ids
      }
      
      // 团队模块不需要group_ids
      if (submitData.module_scope === 'team') {
        delete submitData.group_ids
      }

      if (module) {
        // 更新
        await updateModule(module.id, submitData)
        message.success('更新成功')
      } else {
        // 创建
        await createModule(submitData)
        message.success('创建成功')
      }
      
      onSuccess()
    } catch (error) {
      message.error(error.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取可选的模块范围
  const getAvailableScopes = () => {
    const scopes = [
      { value: 'personal', label: '个人模块', icon: <UserOutlined /> }
    ]
    
    if (canCreateTeam) {
      scopes.push({ value: 'team', label: '团队模块', icon: <TeamOutlined /> })
    }
    
    if (canCreateSystem) {
      // 改为全局模块
      scopes.push({ value: 'system', label: '全局模块', icon: <GlobalOutlined /> })
    }
    
    return scopes
  }

  return (
    <Modal
      title={module ? '编辑知识模块' : '创建知识模块'}
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={700}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        {/* 编辑模式下显示创建人信息 */}
        {module && (
          <Form.Item
            name="creator_name"
            label={
              <Space>
                <UserOutlined />
                创建人
              </Space>
            }
          >
            <Input 
              disabled 
              style={{ 
                backgroundColor: '#f5f5f5',
                color: '#595959',
                cursor: 'not-allowed'
              }}
            />
          </Form.Item>
        )}

        <Form.Item
          name="name"
          label="模块名称"
          rules={[{ required: true, message: '请输入模块名称' }]}
        >
          <Input placeholder="请输入模块名称" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label="模块描述"
        >
          <TextArea 
            placeholder="请输入模块描述" 
            rows={2} 
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="content"
          label="模块内容"
          rules={[{ required: true, message: '请输入模块内容' }]}
          extra="支持Markdown格式，建议详细描述相关知识、规则或指令"
        >
          <TextArea 
            placeholder="请输入模块内容" 
            rows={10}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="module_scope"
          label="模块范围"
          rules={[{ required: true }]}
        >
          <Radio.Group 
            onChange={(e) => setModuleScope(e.target.value)}
            disabled={!!module} // 编辑时不能修改范围
          >
            {getAvailableScopes().map(scope => (
              <Radio.Button key={scope.value} value={scope.value}>
                <Space>
                  {scope.icon}
                  {scope.label}
                </Space>
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="prompt_type"
          label={
            <Space>
              提示词类型
              <InfoCircleOutlined 
                style={{ color: '#999' }}
                title="系统级提示词会作为system角色发送给AI，优先级最高"
              />
            </Space>
          }
          rules={[{ required: true }]}
        >
          <Radio.Group>
            <Radio.Button value="normal">
              <Space>
                <UnlockOutlined />
                普通提示词
              </Space>
            </Radio.Button>
            <Radio.Button value="system">
              <Space>
                <LockOutlined />
                系统级提示词
              </Space>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        {moduleScope === 'system' && canCreateSystem && (
          <Form.Item
            name="group_ids"
            label={
              <Space>
                可见用户组
                <InfoCircleOutlined 
                  style={{ color: '#999' }} 
                  title="选择哪些用户组可以使用该模块，留空表示所有用户可用"
                />
              </Space>
            }
          >
            <Select
              mode="multiple"
              placeholder="留空表示所有用户可用"
              allowClear
            >
              {userGroups.map(group => (
                <Option key={group.id} value={group.id}>
                  {group.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}

        {moduleScope !== 'personal' && (
          <Form.Item
            name="content_visible"
            label="内容可见性"
            valuePropName="checked"
            extra="关闭后，使用者只能看到模块名称和描述，无法查看具体内容"
          >
            <Switch checkedChildren="内容可见" unCheckedChildren="内容隐藏" />
          </Form.Item>
        )}

        <Form.Item
          name="category"
          label="分类"
        >
          <Select placeholder="请选择分类" allowClear>
            {categories.map(cat => (
              <Option key={cat.value} value={cat.value}>
                {cat.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="tags"
          label="标签"
        >
          <Select
            mode="tags"
            placeholder="输入后回车添加标签"
            maxTagCount={5}
            maxTagTextLength={20}
          />
        </Form.Item>

        <Form.Item
          name="sort_order"
          label="排序"
          extra="数值越小越靠前"
        >
          <InputNumber min={0} max={999} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="is_active"
          label="状态"
          valuePropName="checked"
        >
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>

        {module && (
          <Alert
            message="提示"
            description={
              <>
                <div>修改模块内容后，已使用该模块的组合需要重新保存才能生效。</div>
                {moduleScope === 'system' && (
                  <div style={{ marginTop: 8 }}>
                    <strong>全局模块权限说明：</strong>
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>不选择任何用户组：所有用户都可以使用</li>
                      <li>选择特定用户组：只有选中的组内用户可以使用</li>
                    </ul>
                  </div>
                )}
                {module.creator_name && module.creator_name !== user.username && (
                  <div style={{ marginTop: 8, color: '#1890ff' }}>
                    <InfoCircleOutlined /> 该模块由 <strong>{module.creator_name}</strong> 创建
                  </div>
                )}
              </>
            }
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Form>
    </Modal>
  )
}

export default KnowledgeModuleFormModal
