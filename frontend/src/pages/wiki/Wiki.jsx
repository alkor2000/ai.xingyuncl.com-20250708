/**
 * 知识库主页面 v2.0
 * 
 * 功能：
 * - 知识库列表展示（卡片式布局）
 * - 三级范围筛选（个人/团队/全局）
 * - 知识库CRUD操作
 * - 版本管理（保存、历史、回滚）
 * - 内容编辑增强（字符计数、清空、复制）
 * 
 * 设计风格：iOS简洁科技风
 * 
 * 更新：2026-01-02 v2.0 修复版本历史+美化UI
 */

import React, { useState, useEffect, useCallback } from 'react'
import { 
  Card, Button, Input, Empty, Spin, Modal, Form, 
  Select, Segmented, Tag, Tooltip, Dropdown, Typography,
  Space, Drawer, Timeline, Popconfirm, message, Row, Col
} from 'antd'
import { 
  PlusOutlined, SearchOutlined, BookOutlined,
  EditOutlined, DeleteOutlined, PushpinOutlined, PushpinFilled,
  UserOutlined, TeamOutlined, GlobalOutlined,
  HistoryOutlined, EllipsisOutlined, EyeOutlined,
  RollbackOutlined, SaveOutlined, LinkOutlined,
  CopyOutlined, ClearOutlined, FileTextOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useWikiStore from '../../stores/wikiStore'
import useAuthStore from '../../stores/authStore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import './Wiki.less'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { TextArea } = Input
const { Text, Paragraph } = Typography

// 内容最大字符数
const MAX_CONTENT_LENGTH = 100000

/**
 * 知识库主页面组件
 */
const Wiki = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    items, currentItem, versions, loading, detailLoading, versionsLoading,
    getItems, getItem, createItem, updateItem, deleteItem, togglePin,
    saveVersion, getVersions, getVersionDetail, rollbackToVersion,
    clearCurrentItem
  } = useWikiStore()

  // ==================== 本地状态 ====================
  const [searchText, setSearchText] = useState('')
  const [currentScope, setCurrentScope] = useState('all')
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [editDrawerVisible, setEditDrawerVisible] = useState(false)
  const [versionDrawerVisible, setVersionDrawerVisible] = useState(false)
  const [versionDetailVisible, setVersionDetailVisible] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [saveVersionModalVisible, setSaveVersionModalVisible] = useState(false)
  const [versionSummary, setVersionSummary] = useState('')
  const [contentLength, setContentLength] = useState(0)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()

  // ==================== 数据加载 ====================
  useEffect(() => {
    loadItems()
  }, [currentScope])

  const loadItems = useCallback(() => {
    const scope = currentScope === 'all' ? null : currentScope
    getItems(scope)
  }, [currentScope, getItems])

  // ==================== 范围图标映射 ====================
  const scopeIcons = {
    personal: <UserOutlined />,
    team: <TeamOutlined />,
    global: <GlobalOutlined />
  }

  const scopeColors = {
    personal: '#1890ff',
    team: '#52c41a',
    global: '#fa8c16'
  }

  const scopeLabels = {
    personal: t('wiki.scope.personal', '个人'),
    team: t('wiki.scope.team', '团队'),
    global: t('wiki.scope.global', '全局')
  }

  // ==================== 筛选数据 ====================
  const filteredItems = items.filter(item => {
    if (!searchText) return true
    const search = searchText.toLowerCase()
    return item.title?.toLowerCase().includes(search) ||
           item.description?.toLowerCase().includes(search)
  })

  // ==================== 创建知识库 ====================
  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await createItem(values)
      setCreateModalVisible(false)
      createForm.resetFields()
    } catch (error) {
      console.error('创建失败:', error)
    }
  }

  // ==================== 打开编辑 ====================
  const handleOpenEdit = async (item) => {
    try {
      const detail = await getItem(item.id)
      setContentLength(detail?.content?.length || 0)
      setEditDrawerVisible(true)
    } catch (error) {
      console.error('获取详情失败:', error)
    }
  }

  // 当currentItem变化时，更新表单
  useEffect(() => {
    if (currentItem && editDrawerVisible) {
      editForm.setFieldsValue({
        title: currentItem.title,
        description: currentItem.description,
        content: currentItem.content,
        notes: currentItem.notes || [],
        links: currentItem.links || []
      })
      setContentLength(currentItem.content?.length || 0)
    }
  }, [currentItem, editDrawerVisible, editForm])

  // ==================== 保存编辑 ====================
  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      await updateItem(currentItem.id, values)
    } catch (error) {
      console.error('保存失败:', error)
    }
  }

  // ==================== 关闭编辑抽屉 ====================
  const handleCloseEdit = () => {
    setEditDrawerVisible(false)
    clearCurrentItem()
    editForm.resetFields()
    setContentLength(0)
  }

  // ==================== 删除知识库 ====================
  const handleDelete = async (id) => {
    try {
      await deleteItem(id)
      if (editDrawerVisible && currentItem?.id === id) {
        handleCloseEdit()
      }
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  // ==================== 内容操作 ====================
  const handleClearContent = () => {
    editForm.setFieldsValue({ content: '' })
    setContentLength(0)
    message.success('内容已清空')
  }

  const handleCopyContent = async () => {
    const content = editForm.getFieldValue('content')
    if (!content) {
      message.warning('内容为空')
      return
    }
    try {
      await navigator.clipboard.writeText(content)
      message.success('已复制到剪贴板')
    } catch (err) {
      // 降级方案
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      message.success('已复制到剪贴板')
    }
  }

  const handleContentChange = (e) => {
    setContentLength(e.target.value?.length || 0)
  }

  // ==================== 版本管理 ====================
  const handleOpenVersions = async () => {
    if (!currentItem) return
    try {
      await getVersions(currentItem.id)
      setVersionDrawerVisible(true)
    } catch (error) {
      console.error('获取版本历史失败:', error)
    }
  }

  const handleViewVersion = async (version) => {
    try {
      const detail = await getVersionDetail(version.id)
      setSelectedVersion(detail)
      setVersionDetailVisible(true)
    } catch (error) {
      console.error('获取版本详情失败:', error)
    }
  }

  const handleRollback = async (versionId) => {
    if (!currentItem) return
    try {
      await rollbackToVersion(currentItem.id, versionId)
      setVersionDrawerVisible(false)
      await getItem(currentItem.id)
    } catch (error) {
      console.error('回滚失败:', error)
    }
  }

  const handleSaveVersion = async () => {
    if (!currentItem) return
    try {
      await saveVersion(currentItem.id, versionSummary || null)
      setSaveVersionModalVisible(false)
      setVersionSummary('')
      message.success('版本已保存')
    } catch (error) {
      console.error('保存版本失败:', error)
    }
  }

  // ==================== 渲染卡片菜单 ====================
  const getCardMenuItems = (item) => {
    const menuItems = [
      {
        key: 'view',
        icon: <EyeOutlined />,
        label: t('wiki.actions.view', '查看详情'),
        onClick: () => handleOpenEdit(item)
      }
    ]

    if (item.can_edit) {
      menuItems.push(
        {
          key: 'pin',
          icon: item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />,
          label: item.is_pinned ? t('wiki.actions.unpin', '取消置顶') : t('wiki.actions.pin', '置顶'),
          onClick: () => togglePin(item.id)
        },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: t('wiki.actions.delete', '删除'),
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: t('wiki.deleteConfirm.title', '确认删除'),
              content: t('wiki.deleteConfirm.content', '删除后无法恢复，确定要删除吗？'),
              okText: t('common.confirm', '确定'),
              cancelText: t('common.cancel', '取消'),
              okButtonProps: { danger: true },
              onOk: () => handleDelete(item.id)
            })
          }
        }
      )
    }

    return menuItems
  }

  // ==================== 渲染 ====================
  return (
    <div className="wiki-page">
      {/* 头部区域 */}
      <div className="wiki-header-section">
        <div className="wiki-header-content">
          <div className="wiki-header-left">
            <div className="wiki-header-icon-wrapper">
              <BookOutlined className="wiki-header-icon" />
            </div>
            <div className="wiki-header-text">
              <h1 className="wiki-header-title">{t('wiki.title', '知识库')}</h1>
              <p className="wiki-header-subtitle">{t('wiki.subtitle', '管理您的知识文档')}</p>
            </div>
          </div>
          <div className="wiki-header-right">
            <Input
              placeholder={t('wiki.searchPlaceholder', '搜索知识库...')}
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="wiki-search-input"
              allowClear
            />
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
              className="wiki-create-btn"
            >
              {t('wiki.actions.create', '新建')}
            </Button>
          </div>
        </div>
      </div>

      {/* 范围筛选 */}
      <div className="wiki-filter-section">
        <Segmented
          value={currentScope}
          onChange={setCurrentScope}
          className="wiki-scope-filter"
          options={[
            { label: t('wiki.scope.all', '全部'), value: 'all' },
            { label: <span><UserOutlined /> {t('wiki.scope.personal', '个人')}</span>, value: 'personal' },
            { label: <span><TeamOutlined /> {t('wiki.scope.team', '团队')}</span>, value: 'team' },
            { label: <span><GlobalOutlined /> {t('wiki.scope.global', '全局')}</span>, value: 'global' }
          ]}
        />
        <div className="wiki-count">
          {t('wiki.count', '共 {{count}} 条', { count: filteredItems.length })}
        </div>
      </div>

      {/* 知识库列表 */}
      <div className="wiki-content-section">
        {loading ? (
          <div className="wiki-loading">
            <Spin size="large" />
            <p>{t('wiki.loading', '加载中...')}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="wiki-empty">
            <Empty 
              description={t('wiki.empty', '暂无知识库')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setCreateModalVisible(true)}
              >
                {t('wiki.actions.createFirst', '创建第一个知识库')}
              </Button>
            </Empty>
          </div>
        ) : (
          <Row gutter={[16, 16]} className="wiki-grid">
            {filteredItems.map(item => (
              <Col xs={24} sm={12} lg={8} xl={6} key={item.id}>
                <Card 
                  className={`wiki-card ${item.is_pinned ? 'wiki-card-pinned' : ''}`}
                  hoverable
                  onClick={() => handleOpenEdit(item)}
                >
                  {/* 置顶标识 */}
                  {item.is_pinned && (
                    <div className="wiki-card-pin-badge">
                      <PushpinFilled />
                    </div>
                  )}
                  
                  {/* 范围标签 */}
                  <div 
                    className="wiki-card-scope-badge"
                    style={{ backgroundColor: scopeColors[item.scope] }}
                  >
                    {scopeIcons[item.scope]}
                    <span>{scopeLabels[item.scope]}</span>
                  </div>

                  {/* 卡片内容 */}
                  <div className="wiki-card-body">
                    <div className="wiki-card-header">
                      <Text strong ellipsis className="wiki-card-title">
                        {item.title}
                      </Text>
                      <Dropdown
                        menu={{ items: getCardMenuItems(item) }}
                        trigger={['click']}
                        placement="bottomRight"
                      >
                        <Button 
                          type="text" 
                          icon={<EllipsisOutlined />}
                          className="wiki-card-menu-btn"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Dropdown>
                    </div>
                    
                    <Paragraph 
                      ellipsis={{ rows: 2 }} 
                      className="wiki-card-description"
                    >
                      {item.description || t('wiki.noDescription', '暂无描述')}
                    </Paragraph>
                    
                    <div className="wiki-card-footer">
                      <div className="wiki-card-meta">
                        <FileTextOutlined />
                        <span>v{item.current_version}</span>
                      </div>
                      <Text type="secondary" className="wiki-card-time">
                        {dayjs(item.updated_at).fromNow()}
                      </Text>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* 创建弹窗 */}
      <Modal
        title={
          <div className="wiki-modal-title">
            <PlusOutlined />
            <span>{t('wiki.createModal.title', '新建知识库')}</span>
          </div>
        }
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false)
          createForm.resetFields()
        }}
        okText={t('common.create', '创建')}
        cancelText={t('common.cancel', '取消')}
        width={560}
        className="wiki-modal"
      >
        <Form form={createForm} layout="vertical" className="wiki-form">
          <Form.Item
            name="title"
            label={t('wiki.form.title', '标题')}
            rules={[{ required: true, message: t('wiki.form.titleRequired', '请输入标题') }]}
          >
            <Input 
              placeholder={t('wiki.form.titlePlaceholder', '请输入知识库标题')} 
              maxLength={500}
              showCount
            />
          </Form.Item>
          
          <Form.Item
            name="scope"
            label={t('wiki.form.scope', '范围')}
            initialValue="personal"
          >
            <Select>
              <Select.Option value="personal">
                <Space>
                  <UserOutlined style={{ color: scopeColors.personal }} />
                  <span>{t('wiki.scope.personal', '个人')}</span>
                  <Text type="secondary">- {t('wiki.scope.personalDesc', '仅自己可见')}</Text>
                </Space>
              </Select.Option>
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <Select.Option value="team">
                  <Space>
                    <TeamOutlined style={{ color: scopeColors.team }} />
                    <span>{t('wiki.scope.team', '团队')}</span>
                    <Text type="secondary">- {t('wiki.scope.teamDesc', '同组成员可见')}</Text>
                  </Space>
                </Select.Option>
              )}
              {user?.role === 'super_admin' && (
                <Select.Option value="global">
                  <Space>
                    <GlobalOutlined style={{ color: scopeColors.global }} />
                    <span>{t('wiki.scope.global', '全局')}</span>
                    <Text type="secondary">- {t('wiki.scope.globalDesc', '所有人可见')}</Text>
                  </Space>
                </Select.Option>
              )}
            </Select>
          </Form.Item>
          
          <Form.Item
            name="description"
            label={t('wiki.form.description', '描述')}
          >
            <TextArea 
              placeholder={t('wiki.form.descriptionPlaceholder', '请输入描述（可选）')} 
              rows={3}
              maxLength={2000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑抽屉 */}
      <Drawer
        title={null}
        placement="right"
        width={800}
        open={editDrawerVisible}
        onClose={handleCloseEdit}
        className="wiki-edit-drawer"
        headerStyle={{ display: 'none' }}
      >
        {detailLoading ? (
          <div className="wiki-drawer-loading">
            <Spin size="large" />
          </div>
        ) : currentItem ? (
          <div className="wiki-edit-container">
            {/* 自定义头部 */}
            <div className="wiki-edit-header">
              <div className="wiki-edit-header-left">
                <Button 
                  type="text" 
                  icon={<span style={{ fontSize: 20 }}>×</span>}
                  onClick={handleCloseEdit}
                  className="wiki-close-btn"
                />
                <div className="wiki-edit-title-wrapper">
                  <Text strong className="wiki-edit-title" ellipsis>
                    {currentItem.title}
                  </Text>
                  <Tag 
                    style={{ 
                      backgroundColor: scopeColors[currentItem.scope],
                      color: '#fff',
                      border: 'none'
                    }}
                  >
                    {scopeIcons[currentItem.scope]}
                    <span style={{ marginLeft: 4 }}>{scopeLabels[currentItem.scope]}</span>
                  </Tag>
                </div>
              </div>
              <div className="wiki-edit-header-right">
                {currentItem.can_edit && (
                  <>
                    <Button 
                      icon={<HistoryOutlined />}
                      onClick={() => setSaveVersionModalVisible(true)}
                    >
                      {t('wiki.actions.saveVersion', '保存版本')}
                    </Button>
                    <Button 
                      type="primary" 
                      icon={<SaveOutlined />}
                      onClick={handleSaveEdit}
                      loading={loading}
                    >
                      {t('common.save', '保存')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* 元信息栏 */}
            <div className="wiki-edit-meta">
              <div className="wiki-edit-meta-left">
                <span>{t('wiki.meta.creator', '创建者')}: <strong>{currentItem.creator_name}</strong></span>
                <span className="wiki-meta-divider">|</span>
                <span>{t('wiki.meta.version', '版本')}: <strong>v{currentItem.current_version}</strong></span>
                <span className="wiki-meta-divider">|</span>
                <span>{t('wiki.meta.updated', '更新')}: {dayjs(currentItem.updated_at).format('YYYY-MM-DD HH:mm')}</span>
              </div>
              <Button 
                type="link" 
                icon={<HistoryOutlined />}
                onClick={handleOpenVersions}
                className="wiki-version-link"
              >
                {t('wiki.actions.viewHistory', '版本历史')} ({currentItem.version_count})
              </Button>
            </div>

            {/* 编辑表单 */}
            <div className="wiki-edit-body">
              <Form form={editForm} layout="vertical" className="wiki-form">
                <Form.Item
                  name="title"
                  label={t('wiki.form.title', '标题')}
                  rules={[{ required: true, message: t('wiki.form.titleRequired', '请输入标题') }]}
                >
                  <Input 
                    placeholder={t('wiki.form.titlePlaceholder', '请输入标题')} 
                    maxLength={500}
                    showCount
                    disabled={!currentItem.can_edit}
                  />
                </Form.Item>
                
                <Form.Item
                  name="description"
                  label={t('wiki.form.description', '描述')}
                >
                  <TextArea 
                    placeholder={t('wiki.form.descriptionPlaceholder', '请输入描述')} 
                    rows={2}
                    maxLength={2000}
                    showCount
                    disabled={!currentItem.can_edit}
                  />
                </Form.Item>
                
                {/* 内容编辑区 - 增强版 */}
                <Form.Item
                  name="content"
                  label={
                    <div className="wiki-content-label">
                      <span>{t('wiki.form.content', '内容')}</span>
                      <span className="wiki-content-hint">
                        {t('wiki.form.contentHint', '支持Markdown格式，最多{{max}}字符', { max: MAX_CONTENT_LENGTH.toLocaleString() })}
                      </span>
                    </div>
                  }
                >
                  <div className="wiki-content-editor-wrapper">
                    {currentItem.can_edit && (
                      <div className="wiki-content-toolbar">
                        <Space>
                          <Tooltip title={t('wiki.actions.clearContent', '清空内容')}>
                            <Button 
                              type="text" 
                              icon={<ClearOutlined />}
                              onClick={handleClearContent}
                              size="small"
                            />
                          </Tooltip>
                          <Tooltip title={t('wiki.actions.copyContent', '复制内容')}>
                            <Button 
                              type="text" 
                              icon={<CopyOutlined />}
                              onClick={handleCopyContent}
                              size="small"
                            />
                          </Tooltip>
                        </Space>
                        <span className="wiki-content-count">
                          {contentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <TextArea 
                      placeholder={t('wiki.form.contentPlaceholder', '请输入内容...')} 
                      rows={14}
                      maxLength={MAX_CONTENT_LENGTH}
                      disabled={!currentItem.can_edit}
                      className="wiki-content-textarea"
                      onChange={handleContentChange}
                    />
                  </div>
                </Form.Item>

                {/* 备注 */}
                <Form.Item
                  name="notes"
                  label={
                    <span className="wiki-section-label">
                      {t('wiki.form.notes', '备注')}
                      <Text type="secondary">{t('wiki.form.notesHint', '（最多10条）')}</Text>
                    </span>
                  }
                >
                  <Form.List name="notes">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-list-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item {...field} noStyle>
                              <Input 
                                placeholder={t('wiki.form.notePlaceholder', '输入备注内容')} 
                                maxLength={500}
                                disabled={!currentItem.can_edit}
                              />
                            </Form.Item>
                            {currentItem.can_edit && (
                              <Button 
                                type="text" 
                                danger 
                                icon={<DeleteOutlined />}
                                onClick={() => remove(field.name)}
                                className="wiki-list-delete"
                              />
                            )}
                          </div>
                        ))}
                        {currentItem.can_edit && fields.length < 10 && (
                          <Button 
                            type="dashed" 
                            onClick={() => add('')}
                            icon={<PlusOutlined />}
                            className="wiki-list-add"
                          >
                            {t('wiki.form.addNote', '添加备注')}
                          </Button>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>

                {/* 链接 */}
                <Form.Item
                  name="links"
                  label={
                    <span className="wiki-section-label">
                      {t('wiki.form.links', '相关链接')}
                      <Text type="secondary">{t('wiki.form.linksHint', '（最多10条）')}</Text>
                    </span>
                  }
                >
                  <Form.List name="links">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-link-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item name={[field.name, 'title']} noStyle>
                              <Input 
                                placeholder={t('wiki.form.linkTitle', '链接标题')} 
                                style={{ width: '30%' }}
                                maxLength={200}
                                disabled={!currentItem.can_edit}
                              />
                            </Form.Item>
                            <Form.Item name={[field.name, 'url']} noStyle>
                              <Input 
                                placeholder={t('wiki.form.linkUrl', 'https://...')} 
                                prefix={<LinkOutlined style={{ color: '#999' }} />}
                                style={{ flex: 1 }}
                                maxLength={1000}
                                disabled={!currentItem.can_edit}
                              />
                            </Form.Item>
                            {currentItem.can_edit && (
                              <Button 
                                type="text" 
                                danger 
                                icon={<DeleteOutlined />}
                                onClick={() => remove(field.name)}
                                className="wiki-list-delete"
                              />
                            )}
                          </div>
                        ))}
                        {currentItem.can_edit && fields.length < 10 && (
                          <Button 
                            type="dashed" 
                            onClick={() => add({ title: '', url: '' })}
                            icon={<PlusOutlined />}
                            className="wiki-list-add"
                          >
                            {t('wiki.form.addLink', '添加链接')}
                          </Button>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>
              </Form>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* 版本历史抽屉 */}
      <Drawer
        title={
          <div className="wiki-version-drawer-title">
            <HistoryOutlined />
            <span>{t('wiki.versionDrawer.title', '版本历史')}</span>
            <Tag>{currentItem?.version_count || 0} {t('wiki.versionDrawer.count', '个版本')}</Tag>
          </div>
        }
        placement="right"
        width={480}
        open={versionDrawerVisible}
        onClose={() => setVersionDrawerVisible(false)}
        className="wiki-version-drawer"
      >
        {versionsLoading ? (
          <div className="wiki-drawer-loading">
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty description={t('wiki.versionDrawer.empty', '暂无版本历史')} />
        ) : (
          <div className="wiki-version-list">
            {versions.map((v, index) => (
              <div 
                key={v.id} 
                className={`wiki-version-card ${v.version_number === currentItem?.current_version ? 'wiki-version-current' : ''}`}
              >
                <div className="wiki-version-card-header">
                  <div className="wiki-version-number">
                    <span className="wiki-version-badge">v{v.version_number}</span>
                    {v.version_number === currentItem?.current_version && (
                      <Tag color="success" size="small">{t('wiki.version.current', '当前')}</Tag>
                    )}
                  </div>
                  <Text type="secondary" className="wiki-version-time">
                    {dayjs(v.created_at).format('MM-DD HH:mm')}
                  </Text>
                </div>
                <div className="wiki-version-card-body">
                  <Text className="wiki-version-title" ellipsis>
                    {v.title}
                  </Text>
                  {v.change_summary && (
                    <Text type="secondary" className="wiki-version-summary">
                      {v.change_summary}
                    </Text>
                  )}
                  <Text type="secondary" className="wiki-version-author">
                    {v.created_by_name}
                  </Text>
                </div>
                <div className="wiki-version-card-actions">
                  <Button 
                    type="link" 
                    size="small"
                    onClick={() => handleViewVersion(v)}
                  >
                    {t('wiki.actions.viewVersion', '查看')}
                  </Button>
                  {currentItem?.can_edit && v.version_number !== currentItem?.current_version && (
                    <Popconfirm
                      title={t('wiki.rollbackConfirm.title', '确认回滚？')}
                      description={t('wiki.rollbackConfirm.content', '回滚后当前内容将被覆盖')}
                      onConfirm={() => handleRollback(v.id)}
                      okText={t('common.confirm', '确定')}
                      cancelText={t('common.cancel', '取消')}
                    >
                      <Button type="link" size="small" danger icon={<RollbackOutlined />}>
                        {t('wiki.actions.rollback', '回滚')}
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* 版本详情弹窗 */}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>{t('wiki.versionDetail.title', '版本详情')}</span>
            <Tag color="blue">v{selectedVersion?.version_number}</Tag>
          </Space>
        }
        open={versionDetailVisible}
        onCancel={() => {
          setVersionDetailVisible(false)
          setSelectedVersion(null)
        }}
        footer={null}
        width={700}
        className="wiki-modal"
      >
        {selectedVersion && (
          <div className="wiki-version-detail">
            <div className="wiki-version-detail-section">
              <label>{t('wiki.form.title', '标题')}</label>
              <div className="wiki-version-detail-value">{selectedVersion.title}</div>
            </div>
            <div className="wiki-version-detail-section">
              <label>{t('wiki.form.description', '描述')}</label>
              <div className="wiki-version-detail-value">{selectedVersion.description || '-'}</div>
            </div>
            <div className="wiki-version-detail-section">
              <label>{t('wiki.form.content', '内容')}</label>
              <pre className="wiki-version-detail-content">{selectedVersion.content || '-'}</pre>
            </div>
            {selectedVersion.notes_snapshot?.length > 0 && (
              <div className="wiki-version-detail-section">
                <label>{t('wiki.form.notes', '备注')}</label>
                <ul className="wiki-version-detail-list">
                  {selectedVersion.notes_snapshot.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            {selectedVersion.links_snapshot?.length > 0 && (
              <div className="wiki-version-detail-section">
                <label>{t('wiki.form.links', '链接')}</label>
                <ul className="wiki-version-detail-list">
                  {selectedVersion.links_snapshot.map((link, i) => (
                    <li key={i}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.title || link.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 保存版本弹窗 */}
      <Modal
        title={
          <Space>
            <SaveOutlined />
            <span>{t('wiki.saveVersionModal.title', '保存新版本')}</span>
          </Space>
        }
        open={saveVersionModalVisible}
        onOk={handleSaveVersion}
        onCancel={() => {
          setSaveVersionModalVisible(false)
          setVersionSummary('')
        }}
        okText={t('common.save', '保存')}
        cancelText={t('common.cancel', '取消')}
        className="wiki-modal"
      >
        <div className="wiki-save-version-form">
          <p className="wiki-save-version-tip">
            {t('wiki.saveVersionModal.tip', '保存当前内容为新版本，方便后续查看或回滚')}
          </p>
          <Input 
            value={versionSummary}
            onChange={(e) => setVersionSummary(e.target.value)}
            placeholder={t('wiki.form.changeSummaryPlaceholder', '简要描述此版本的修改内容（可选）')}
            maxLength={500}
          />
        </div>
      </Modal>
    </div>
  )
}

export default Wiki
