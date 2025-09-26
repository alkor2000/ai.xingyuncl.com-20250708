/**
 * 知识模块表单弹窗组件
 * 支持国际化(i18n)
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
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          creator_name: module.creator_name || t('knowledge.form.unknown')
        })
        setModuleScope(module.module_scope)
        setTagAccessMode(module.allowed_tag_ids && module.allowed_tag_ids.length > 0 ? 'selected' : 'all')
        
        // 如果是团队模块，加载组内标签
        if (module.module_scope === 'team' && module.group_id) {
          loadGroupTags()
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
  }, [visible, module, form, getCategories, canCreateSystem, fetchUserGroups, user, t])

  // 加载组内标签 - 使用新的普通用户可访问的接口
  const loadGroupTags = async () => {
    setLoadingTags(true)
    try {
      // 使用新的接口路径，不需要传递groupId，后端会根据用户的group_id返回
      const response = await apiClient.get('/knowledge/modules/group-tags')
      setGroupTags(response.data.data || [])
    } catch (error) {
      console.error('加载组内标签失败:', error)
      setGroupTags([])
      // 如果是权限问题，给出友好提示
      if (error.response?.status === 403) {
        message.warning(t('knowledge.form.noGroupPermission'))
      }
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
      loadGroupTags()
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
        message.success(t('knowledge.updateSuccess'))
      } else {
        // 创建
        await createModule(submitData)
        message.success(t('knowledge.saveSuccess'))
      }
      
      onSuccess()
    } catch (error) {
      message.error(error.message || t('knowledge.form.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 获取可选的模块范围
  const getAvailableScopes = () => {
    const scopes = [
      { value: 'personal', label: t('knowledge.form.scopePersonal'), icon: <UserOutlined /> }
    ]
    
    if (canCreateTeam) {
      scopes.push({ value: 'team', label: t('knowledge.form.scopeTeam'), icon: <TeamOutlined /> })
    }
    
    if (canCreateSystem) {
      scopes.push({ value: 'system', label: t('knowledge.form.scopeSystem'), icon: <GlobalOutlined /> })
    }
    
    return scopes
  }

  return (
    <Modal
      title={module ? t('knowledge.form.editModule') : t('knowledge.form.createModule')}
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
                {t('knowledge.form.creator')}
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
          label={t('knowledge.form.moduleName')}
          rules={[{ required: true, message: t('knowledge.form.moduleNameRequired') }]}
        >
          <Input placeholder={t('knowledge.form.moduleNamePlaceholder')} maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label={t('knowledge.form.moduleDescription')}
        >
          <TextArea 
            placeholder={t('knowledge.form.moduleDescriptionPlaceholder')} 
            rows={2} 
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="content"
          label={t('knowledge.form.moduleContent')}
          rules={[{ required: true, message: t('knowledge.form.moduleContentRequired') }]}
          extra={t('knowledge.form.moduleContentHelp')}
        >
          <TextArea 
            placeholder={t('knowledge.form.moduleContentPlaceholder')} 
            rows={10}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="module_scope"
          label={t('knowledge.form.moduleScope')}
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
              {t('knowledge.form.promptType')}
              <Tooltip title={t('knowledge.form.promptTypeTooltip')}>
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
                {t('knowledge.form.promptNormal')}
              </Space>
            </Radio.Button>
            <Radio.Button value="system">
              <Space>
                <LockOutlined />
                {t('knowledge.form.promptSystem')}
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
                  {t('knowledge.form.accessPermission')}
                  <Tooltip title={t('knowledge.form.accessPermissionTooltip')}>
                    <QuestionCircleOutlined style={{ color: '#999' }} />
                  </Tooltip>
                </Space>
              }
            >
              <Radio.Group onChange={(e) => setTagAccessMode(e.target.value)}>
                <Radio value="all">{t('knowledge.form.accessAll')}</Radio>
                <Radio value="selected">{t('knowledge.form.accessSelected')}</Radio>
              </Radio.Group>
            </Form.Item>

            {tagAccessMode === 'selected' && (
              <Form.Item
                name="allowed_tag_ids"
                label={t('knowledge.form.selectAllowedTags')}
                extra={t('knowledge.form.selectAllowedTagsHelp')}
              >
                <Checkbox.Group style={{ width: '100%' }}>
                  <Space wrap>
                    {loadingTags ? (
                      <span>{t('knowledge.form.loadingTags')}</span>
                    ) : groupTags.length > 0 ? (
                      groupTags.map(tag => (
                        <Checkbox key={tag.id} value={tag.id}>
                          <Tag color={tag.color || '#1677ff'}>
                            {tag.name}
                          </Tag>
                        </Checkbox>
                      ))
                    ) : (
                      <span style={{ color: '#999' }}>{t('knowledge.form.noAvailableTags')}</span>
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
                {t('knowledge.form.visibleGroups')}
                <Tooltip title={t('knowledge.form.visibleGroupsTooltip')}>
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
          >
            <Select
              mode="multiple"
              placeholder={t('knowledge.form.visibleGroupsPlaceholder')}
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
            label={t('knowledge.form.contentVisibility')}
            valuePropName="checked"
            extra={t('knowledge.form.contentVisibilityHelp')}
          >
            <Switch 
              checkedChildren={t('knowledge.form.contentVisibleOn')} 
              unCheckedChildren={t('knowledge.form.contentVisibleOff')} 
            />
          </Form.Item>
        )}

        <Form.Item
          name="category"
          label={t('knowledge.form.category')}
        >
          <Select placeholder={t('knowledge.form.categoryPlaceholder')} allowClear>
            {categories.map(cat => (
              <Option key={cat.value} value={cat.value}>
                {cat.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="tags"
          label={t('knowledge.form.tags')}
        >
          <Select
            mode="tags"
            placeholder={t('knowledge.form.tagsPlaceholder')}
            maxTagCount={5}
            maxTagTextLength={20}
          />
        </Form.Item>

        <Form.Item
          name="sort_order"
          label={t('knowledge.form.sortOrder')}
          extra={t('knowledge.form.sortOrderHelp')}
        >
          <InputNumber min={0} max={999} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="is_active"
          label={t('knowledge.form.status')}
          valuePropName="checked"
        >
          <Switch 
            checkedChildren={t('knowledge.form.statusEnabled')} 
            unCheckedChildren={t('knowledge.form.statusDisabled')} 
          />
        </Form.Item>

        {module && (
          <Alert
            message={t('knowledge.form.tip')}
            description={
              <>
                <div>{t('knowledge.form.tipContent')}</div>
                {moduleScope === 'team' && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{t('knowledge.form.teamPermissionTitle')}</strong>
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>{t('knowledge.form.teamPermission1')}</li>
                      <li>{t('knowledge.form.teamPermission2')}</li>
                      <li>{t('knowledge.form.teamPermission3')}</li>
                    </ul>
                  </div>
                )}
                {moduleScope === 'system' && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{t('knowledge.form.systemPermissionTitle')}</strong>
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>{t('knowledge.form.systemPermission1')}</li>
                      <li>{t('knowledge.form.systemPermission2')}</li>
                    </ul>
                  </div>
                )}
                {module.creator_name && module.creator_name !== user.username && (
                  <div style={{ marginTop: 8, color: '#1890ff' }}>
                    <InfoCircleOutlined /> {t('knowledge.form.createdBy', { creator: module.creator_name })}
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
