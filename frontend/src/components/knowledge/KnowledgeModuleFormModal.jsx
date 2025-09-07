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
  Alert,
  Checkbox,
  Divider,
  Tooltip
} from 'antd'
import {
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  LockOutlined,
  UnlockOutlined,
  InfoCircleOutlined,
  TagsOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'
import apiClient from '../../utils/api'

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
  const [groupTags, setGroupTags] = useState([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [tagAccessMode, setTagAccessMode] = useState('all') // 'all' 或 'selected'

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
          // 设置标签访问模式
          tag_access_mode: module.allowed_tag_ids && module.allowed_tag_ids.length > 0 ? 'selected' : 'all',
          allowed_tag_ids: module.allowed_tag_ids || [],
          // 添加创建人显示（只读）
          creator_name: module.creator_name || '未知'
        })
        setModuleScope(module.module_scope)
        setTagAccessMode(module.allowed_tag_ids && module.allowed_tag_ids.length > 0 ? 'selected' : 'all')
        
        // 如果是团队模块，加载组内标签
        if (module.module_scope === 'team' && module.group_id) {
          loadGroupTags(module.group_id)
        }
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
          tag_access_mode: 'all',
          allowed_tag_ids: [],
          // 新建时显示当前用户为创建人
          creator_name: user.username || user.email
        })
        setModuleScope('personal')
        setTagAccessMode('all')
      }
    }
  }, [visible, module, form, getCategories, canCreateSystem, fetchUserGroups, user])

  // 加载组内标签
  const loadGroupTags = async (groupId) => {
    setLoadingTags(true)
    try {
      const response = await apiClient.get(`/admin/user-tags/group/${groupId}`)
      setGroupTags(response.data.data || [])
    } catch (error) {
      console.error('加载组内标签失败:', error)
      setGroupTags([])
    } finally {
      setLoadingTags(false)
    }
  }

  // 当模块范围改变时
  const handleScopeChange = (e) => {
    const newScope = e.target.value
    setModuleScope(newScope)
    
    // 如果切换到团队模块，加载当前组的标签
    if (newScope === 'team' && user.group_id) {
      loadGroupTags(user.group_id)
    } else {
      setGroupTags([])
    }
    
    // 重置标签访问设置
    if (newScope !== 'team') {
      form.setFieldsValue({
        tag_access_mode: 'all',
        allowed_tag_ids: []
      })
      setTagAccessMode('all')
    }
  }

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      // 移除创建人字段（不需要提交）
      const submitData = { ...values }
      delete submitData.creator_name
      delete submitData.tag_access_mode // 这只是UI控制字段
      
      // 处理标签
      if (submitData.tags && submitData.tags.length > 0) {
        submitData.tags = JSON.stringify(submitData.tags)
      } else {
        submitData.tags = null
      }

      // 个人模块不需要设置内容可见性、group_ids和标签权限
      if (submitData.module_scope === 'personal') {
        submitData.content_visible = true
        delete submitData.group_ids
        delete submitData.allowed_tag_ids
      }
      
      // 团队模块处理标签权限
      if (submitData.module_scope === 'team') {
        delete submitData.group_ids // 团队模块不需要group_ids
        
        // 如果选择了"所有组内用户"，清空allowed_tag_ids
        if (values.tag_access_mode === 'all') {
          submitData.allowed_tag_ids = []
        }
      }
      
      // 系统模块不需要标签权限
      if (submitData.module_scope === 'system') {
        delete submitData.allowed_tag_ids
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
      width={800}
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
            onChange={handleScopeChange}
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
              <Tooltip title="系统级提示词会作为system角色发送给AI，优先级最高">
                <InfoCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
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

        {/* 团队模块的标签访问权限设置 */}
        {moduleScope === 'team' && (
          <>
            <Divider />
            <Form.Item
              name="tag_access_mode"
              label={
                <Space>
                  <TagsOutlined />
                  访问权限设置
                  <Tooltip title="控制哪些用户可以使用此模块">
                    <QuestionCircleOutlined style={{ color: '#999' }} />
                  </Tooltip>
                </Space>
              }
            >
              <Radio.Group onChange={(e) => setTagAccessMode(e.target.value)}>
                <Radio value="all">所有组内用户</Radio>
                <Radio value="selected">指定标签用户</Radio>
              </Radio.Group>
            </Form.Item>

            {tagAccessMode === 'selected' && (
              <Form.Item
                name="allowed_tag_ids"
                label="选择允许访问的用户标签"
                extra="只有拥有选中标签的用户才能使用此模块（创建者始终可以访问）"
              >
                <Checkbox.Group style={{ width: '100%' }}>
                  <Space wrap>
                    {loadingTags ? (
                      <span>加载标签中...</span>
                    ) : groupTags.length > 0 ? (
                      groupTags.map(tag => (
                        <Checkbox key={tag.id} value={tag.id}>
                          <Tag color={tag.color || '#1677ff'}>
                            {tag.name}
                          </Tag>
                        </Checkbox>
                      ))
                    ) : (
                      <span style={{ color: '#999' }}>暂无可用标签</span>
                    )}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            )}
            <Divider />
          </>
        )}

        {moduleScope === 'system' && canCreateSystem && (
          <Form.Item
            name="group_ids"
            label={
              <Space>
                可见用户组
                <Tooltip title="选择哪些用户组可以使用该模块，留空表示所有用户可用">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
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
                {moduleScope === 'team' && (
                  <div style={{ marginTop: 8 }}>
                    <strong>团队模块权限说明：</strong>
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>不设置标签限制：组内所有用户都可以使用</li>
                      <li>设置标签限制：只有拥有指定标签的用户可以使用</li>
                      <li>模块创建者始终拥有访问权限</li>
                    </ul>
                  </div>
                )}
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
