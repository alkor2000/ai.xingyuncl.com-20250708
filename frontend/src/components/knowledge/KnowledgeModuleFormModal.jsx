/**
 * 知识模块表单弹窗组件
 * 支持国际化(i18n)
 *
 * ── 本次国际化修复要点（说明为何这样改）──
 * 1) 初始化 useEffect 的依赖数组移除 t【重要，修复真实 Bug】
 *    原依赖含 t，而 t 在语言切换时是新引用，会使该 effect 重跑；
 *    此时若弹窗正处于打开状态（visible=true 且 module 存在），
 *    form.setFieldsValue(...) 会把用户已经输入但未提交的内容重置回原始值，
 *    造成编辑内容丢失。
 *    effect 内唯一用到 t 的地方是 creator_name 的兜底文案（一个 disabled
 *    只读输入框），语言切换后该兜底文案不刷新的影响远小于表单被重置，
 *    故按"渲染副作用型 effect 不依赖 t"的原则移除。
 *
 * 2) console.error 改英文
 *    开发者日志与界面文案职责分离，日志不进语言包。
 *
 * 3) module.tags 的 JSON.parse 增加容错
 *    tags 为数据库 JSON 文本字段，若存入了非法 JSON，原代码会在 effect 内
 *    抛错并中断后续所有 setFieldsValue，导致整个表单空白且无任何提示。
 *    改为 try/catch 降级为空数组，让表单其余字段仍能正常填充。
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

/** 表单字段长度上限，与后端 knowledge_modules 表字段约束保持一致 */
const MODULE_NAME_MAX_LENGTH = 100
const MODULE_DESC_MAX_LENGTH = 500

/** 标签选择器限制 */
const TAGS_MAX_COUNT = 5
const TAGS_MAX_TEXT_LENGTH = 20

/** 排序权重范围 */
const SORT_ORDER_MIN = 0
const SORT_ORDER_MAX = 999

/**
 * 安全解析 tags 字段
 * tags 在数据库中为 JSON 文本，历史数据可能非法；解析失败时降级为空数组，
 * 避免异常向上冒泡中断整个表单初始化流程。
 * @param {string|Array|null} raw 原始 tags 值
 * @returns {Array} 标签数组
 */
const parseTagsSafely = (raw) => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    console.warn('Invalid tags JSON, fallback to empty array:', raw)
    return []
  }
}

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
          // 非法 JSON 降级为空数组，避免中断后续字段填充
          tags: parseTagsSafely(module.tags),
          group_ids: module.group_ids || [],
          // 设置标签访问模式
          tag_access_mode: module.allowed_tag_ids && module.allowed_tag_ids.length > 0 ? 'selected' : 'all',
          allowed_tag_ids: module.allowed_tag_ids || [],
          // 添加创建人显示（只读）。创建人名为业务数据不翻译，仅缺失时用兜底文案
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
          sort_order: SORT_ORDER_MIN,
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
    // 依赖数组刻意不含 t：t 在语言切换时是新引用，会导致本 effect 重跑，
    // 从而用 setFieldsValue 覆盖用户正在编辑但尚未提交的表单内容。
    // effect 内仅在 creator_name 缺失时用到 t，属只读展示字段，
    // 其文案不随语言即时刷新是可接受的取舍。
  }, [visible, module, form, getCategories, canCreateSystem, fetchUserGroups, user])

  // 加载组内标签 - 使用新的普通用户可访问的接口
  const loadGroupTags = async () => {
    setLoadingTags(true)
    try {
      // 使用新的接口路径，不需要传递groupId，后端会根据用户的group_id返回
      const response = await apiClient.get('/knowledge/modules/group-tags')
      setGroupTags(response.data.data || [])
    } catch (error) {
      console.error('Failed to load group tags:', error)
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
      // error.message 可能来自后端（中文）或前端异常（英文），优先展示后端提示
      message.error(error.message || t('knowledge.form.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  /**
   * 获取可选的模块范围
   * 在渲染期构建而非 useMemo：内部含 t()，用 useMemo 缓存则必须把 t 加入依赖，
   * 否则语herbal切换后按钮文案不刷新。此处仅 3 项，重建成本可忽略。
   */
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
          <Input placeholder={t('knowledge.form.moduleNamePlaceholder')} maxLength={MODULE_NAME_MAX_LENGTH} />
        </Form.Item>

        <Form.Item
          name="description"
          label={t('knowledge.form.moduleDescription')}
        >
          <TextArea
            placeholder={t('knowledge.form.moduleDescriptionPlaceholder')}
            rows={2}
            maxLength={MODULE_DESC_MAX_LENGTH}
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
                          {/* 标签名与配色均为后台录入的业务数据，不翻译 */}
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
              {/* 组名为后台录入的业务数据，不翻译 */}
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
            {/* 分类label来自后端返回的业务数据，不翻译 */}
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
            maxTagCount={TAGS_MAX_COUNT}
            maxTagTextLength={TAGS_MAX_TEXT_LENGTH}
          />
        </Form.Item>

        <Form.Item
          name="sort_order"
          label={t('knowledge.form.sortOrder')}
          extra={t('knowledge.form.sortOrderHelp')}
        >
          <InputNumber min={SORT_ORDER_MIN} max={SORT_ORDER_MAX} style={{ width: '100%' }} />
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
                    {/* 整句插值：创建人名嵌入句中，中英语序不同不可分段拼接 */}
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
