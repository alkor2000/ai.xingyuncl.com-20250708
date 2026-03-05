/**
 * 知识库主页面 v5.0
 * 
 * v5.0 更新内容：
 * 1. 全新UI设计 - 精致卡片、优雅编辑抽屉
 * 2. 新增删除知识库功能 - 编辑抽屉底部红色危险区 + 卡片菜单
 * 3. 卡片增加创建者、版本数等信息展示
 * 4. 编辑抽屉分区更清晰，操作更直观
 * 5. 版本管理逻辑不变（v4.0平等化）
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Button, Input, Empty, Spin, Modal, Form,
  Select, Segmented, Tag, Tooltip, Dropdown, Typography,
  Space, Drawer, Popconfirm, message, Row, Col, Divider
} from 'antd'
import {
  PlusOutlined, SearchOutlined, BookOutlined,
  DeleteOutlined, PushpinOutlined, PushpinFilled,
  UserOutlined, TeamOutlined, GlobalOutlined,
  HistoryOutlined, EllipsisOutlined, EyeOutlined,
  SaveOutlined, LinkOutlined, ExclamationCircleOutlined,
  CopyOutlined, ClearOutlined, FileTextOutlined,
  ClockCircleOutlined, CloseOutlined, DownOutlined,
  BranchesOutlined, WarningOutlined
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

/** 内容最大长度 */
const MAX_CONTENT_LENGTH = 100000

/** 范围配置映射 */
const SCOPE_CONFIG = {
  personal: { icon: <UserOutlined />, color: '#3b82f6', label: '个人', desc: '仅自己可见' },
  team: { icon: <TeamOutlined />, color: '#8b5cf6', label: '团队', desc: '同组成员可见' },
  global: { icon: <GlobalOutlined />, color: '#f59e0b', label: '全局', desc: '所有人可见' }
}

const Wiki = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    items, currentItem, currentVersion, versions, loading, detailLoading,
    getItems, getItem, createItem, deleteItem, togglePin,
    getVersions, switchToVersion, saveVersion, createVersion, deleteVersion,
    clearCurrentItem
  } = useWikiStore()

  // 本地状态
  const [searchText, setSearchText] = useState('')
  const [currentScope, setCurrentScope] = useState('all')
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [editDrawerVisible, setEditDrawerVisible] = useState(false)
  const [contentLength, setContentLength] = useState(0)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()

  // 加载列表
  useEffect(() => {
    const scope = currentScope === 'all' ? null : currentScope
    getItems(scope)
  }, [currentScope, getItems])

  // 过滤列表
  const filteredItems = items.filter(item => {
    if (!searchText) return true
    const s = searchText.toLowerCase()
    return item.title?.toLowerCase().includes(s) || item.description?.toLowerCase().includes(s)
  })

  /** 创建知识库 */
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

  /** 打开编辑抽屉 */
  const handleOpenEdit = async (item) => {
    try {
      const detail = await getItem(item.id)
      const versionList = await getVersions(item.id)
      setEditDrawerVisible(true)
      if (versionList && versionList.length > 0) {
        const currentVer = versionList.find(v => v.version_number === detail.current_version)
        await switchToVersion(currentVer ? currentVer.id : versionList[0].id)
      }
    } catch (error) {
      console.error('获取详情失败:', error)
    }
  }

  // 同步版本数据到表单
  useEffect(() => {
    if (currentVersion && editDrawerVisible) {
      editForm.setFieldsValue({
        title: currentVersion.title,
        description: currentVersion.description,
        content: currentVersion.content,
        notes: currentVersion.notes_snapshot || [],
        links: currentVersion.links_snapshot || []
      })
      setContentLength(currentVersion.content?.length || 0)
    }
  }, [currentVersion, editDrawerVisible, editForm])

  /** 保存到当前版本 */
  const handleSave = async () => {
    if (!currentVersion) return
    try {
      const values = await editForm.validateFields()
      await saveVersion(currentVersion.id, {
        title: values.title, description: values.description,
        content: values.content, notes: values.notes, links: values.links
      })
    } catch (error) {
      console.error('保存失败:', error)
    }
  }

  /** 新建版本 */
  const handleCreateVersion = async () => {
    if (!currentItem || !currentVersion) return
    try { await createVersion(currentItem.id, currentVersion.id) }
    catch (error) { console.error('创建版本失败:', error) }
  }

  /** 删除版本 */
  const handleDeleteVersion = async () => {
    if (!currentItem || !currentVersion) return
    try { await deleteVersion(currentItem.id, currentVersion.id) }
    catch (error) { console.error('删除版本失败:', error) }
  }

  /** 切换版本 */
  const handleSwitchVersion = async (versionId) => {
    try { await switchToVersion(versionId) }
    catch (error) { console.error('切换版本失败:', error) }
  }

  /** 关闭编辑抽屉 */
  const handleCloseEdit = () => {
    setEditDrawerVisible(false)
    clearCurrentItem()
    editForm.resetFields()
    setContentLength(0)
  }

  /** 删除知识库（核心新增功能） */
  const handleDeleteWiki = (id, title) => {
    Modal.confirm({
      title: '确认删除知识库',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>即将删除知识库 <Text strong>「{title}」</Text></p>
          <p style={{ color: '#ff4d4f', fontSize: 13 }}>
            删除后所有版本和内容将永久丢失，此操作不可撤销！
          </p>
        </div>
      ),
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteItem(id)
          // 如果正在编辑该项，关闭抽屉
          if (editDrawerVisible && currentItem?.id === id) {
            handleCloseEdit()
          }
        } catch (error) {
          console.error('删除失败:', error)
        }
      }
    })
  }

  /** 清空内容 */
  const handleClearContent = () => {
    editForm.setFieldsValue({ content: '' })
    setContentLength(0)
    message.success('内容已清空')
  }

  /** 复制内容 */
  const handleCopyContent = async () => {
    const content = editForm.getFieldValue('content')
    if (!content) { message.warning('内容为空'); return }
    try {
      await navigator.clipboard.writeText(content)
      message.success('已复制到剪贴板')
    } catch (err) {
      const ta = document.createElement('textarea')
      ta.value = content
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      message.success('已复制到剪贴板')
    }
  }

  /** 内容变化监听 */
  const handleContentChange = (e) => setContentLength(e.target.value?.length || 0)

  /** 版本下拉菜单项 */
  const versionMenuItems = versions.map(v => ({
    key: v.id,
    label: (
      <div className="wiki-version-menu-item" onClick={() => handleSwitchVersion(v.id)}>
        <span className="wiki-version-num">v{v.version_number}</span>
        <span className="wiki-version-user">{v.created_by_name}</span>
        <span className="wiki-version-time">{dayjs(v.created_at).format('MM-DD HH:mm')}</span>
        {currentVersion?.version_number === v.version_number && (
          <Tag color="blue" size="small">当前</Tag>
        )}
      </div>
    )
  }))

  /** 卡片右键菜单 */
  const getCardMenuItems = (item) => {
    const menuItems = [
      { key: 'view', icon: <EyeOutlined />, label: '查看编辑' }
    ]
    if (item.can_edit) {
      menuItems.push(
        { key: 'pin', icon: item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />,
          label: item.is_pinned ? '取消置顶' : '置顶' }
      )
    }
    // 创建者或超级管理员可删除
    const canDelete = item.creator_id === user?.id || user?.role === 'super_admin'
    if (canDelete) {
      menuItems.push(
        { type: 'divider' },
        { key: 'delete', icon: <DeleteOutlined />, label: '删除知识库', danger: true }
      )
    }
    return menuItems
  }

  /** 卡片菜单点击 */
  const handleCardMenuClick = (key, item) => {
    if (key === 'view') handleOpenEdit(item)
    else if (key === 'pin') togglePin(item.id)
    else if (key === 'delete') handleDeleteWiki(item.id, item.title)
  }

  /** 内容标签行（含工具按钮） */
  const renderContentLabel = () => (
    <div className="wiki-content-label-row">
      <div className="wiki-content-label">
        <span>{t('wiki.form.content', '内容')}</span>
        <span className="wiki-content-hint">{t('wiki.form.contentHint', '支持Markdown格式')}</span>
      </div>
      {currentVersion?.can_edit && (
        <div className="wiki-content-toolbar">
          <Tooltip title="清空"><Button type="text" icon={<ClearOutlined />} onClick={handleClearContent} size="small" /></Tooltip>
          <Tooltip title="复制"><Button type="text" icon={<CopyOutlined />} onClick={handleCopyContent} size="small" /></Tooltip>
          <span className="wiki-content-count">{contentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()}</span>
        </div>
      )}
    </div>
  )

  // ==================== 渲染 ====================
  return (
    <div className="wiki-page">
      {/* ===== 头部区域 ===== */}
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
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)} className="wiki-create-btn">
              {t('wiki.actions.create', '新建')}
            </Button>
          </div>
        </div>
      </div>

      {/* ===== 筛选区域 ===== */}
      <div className="wiki-filter-section">
        <Segmented
          value={currentScope} onChange={setCurrentScope}
          className="wiki-scope-filter"
          options={[
            { label: t('wiki.scope.all', '全部'), value: 'all' },
            { label: <span><UserOutlined /> {t('wiki.scope.personal', '个人')}</span>, value: 'personal' },
            { label: <span><TeamOutlined /> {t('wiki.scope.team', '团队')}</span>, value: 'team' },
            { label: <span><GlobalOutlined /> {t('wiki.scope.global', '全局')}</span>, value: 'global' }
          ]}
        />
        <div className="wiki-count">{t('wiki.count', '共 {{count}} 条', { count: filteredItems.length })}</div>
      </div>

      {/* ===== 卡片列表 ===== */}
      <div className="wiki-content-section">
        {loading ? (
          <div className="wiki-loading"><Spin size="large" /><p>{t('wiki.loading', '加载中...')}</p></div>
        ) : filteredItems.length === 0 ? (
          <div className="wiki-empty">
            <Empty description={t('wiki.empty', '暂无知识库')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
                {t('wiki.actions.createFirst', '创建第一个知识库')}
              </Button>
            </Empty>
          </div>
        ) : (
          <Row gutter={[16, 16]} className="wiki-grid">
            {filteredItems.map(item => {
              const sc = SCOPE_CONFIG[item.scope] || SCOPE_CONFIG.personal
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.id}>
                  <Card className={`wiki-card ${item.is_pinned ? 'wiki-card-pinned' : ''}`}
                    hoverable onClick={() => handleOpenEdit(item)}>
                    {/* 置顶标记 */}
                    {item.is_pinned && <div className="wiki-card-pin-badge"><PushpinFilled /></div>}
                    {/* 范围标签 */}
                    <div className="wiki-card-scope-badge" style={{ backgroundColor: sc.color }}>
                      {sc.icon}<span>{sc.label}</span>
                    </div>
                    {/* 卡片主体 */}
                    <div className="wiki-card-body">
                      <div className="wiki-card-header">
                        <Text strong ellipsis className="wiki-card-title">{item.title}</Text>
                        <Dropdown
                          menu={{
                            items: getCardMenuItems(item),
                            onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); handleCardMenuClick(key, item) }
                          }}
                          trigger={['click']} placement="bottomRight">
                          <Button type="text" icon={<EllipsisOutlined />}
                            className="wiki-card-menu-btn" onClick={(e) => e.stopPropagation()} />
                        </Dropdown>
                      </div>
                      <Paragraph ellipsis={{ rows: 2 }} className="wiki-card-description">
                        {item.description || t('wiki.noDescription', '暂无描述')}
                      </Paragraph>
                      <div className="wiki-card-footer">
                        <div className="wiki-card-meta">
                          <UserOutlined />
                          <span>{item.creator_name || '未知'}</span>
                          <span className="wiki-card-meta-dot">·</span>
                          <FileTextOutlined />
                          <span>v{item.current_version}</span>
                        </div>
                        <Text type="secondary" className="wiki-card-time">{dayjs(item.updated_at).fromNow()}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              )
            })}
          </Row>
        )}
      </div>

      {/* ===== 创建弹窗 ===== */}
      <Modal
        title={<div className="wiki-modal-title"><PlusOutlined /><span>{t('wiki.createModal.title', '新建知识库')}</span></div>}
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields() }}
        okText="创建" cancelText="取消" width={520} className="wiki-modal"
      >
        <Form form={createForm} layout="vertical" className="wiki-form">
          <Form.Item name="title" label={t('wiki.form.title', '标题')}
            rules={[{ required: true, message: t('wiki.form.titleRequired', '请输入标题') }]}>
            <Input placeholder={t('wiki.form.titlePlaceholder', '请输入知识库标题')} maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="scope" label={t('wiki.form.scope', '范围')} initialValue="personal">
            <Select>
              {Object.entries(SCOPE_CONFIG).map(([key, cfg]) => {
                // 权限控制：team需admin+，global需super_admin
                if (key === 'team' && user?.role !== 'admin' && user?.role !== 'super_admin') return null
                if (key === 'global' && user?.role !== 'super_admin') return null
                return (
                  <Select.Option value={key} key={key}>
                    <Space>{React.cloneElement(cfg.icon, { style: { color: cfg.color } })}<span>{cfg.label}</span><Text type="secondary">- {cfg.desc}</Text></Space>
                  </Select.Option>
                )
              })}
            </Select>
          </Form.Item>
          <Form.Item name="description" label={t('wiki.form.description', '描述')}>
            <TextArea placeholder={t('wiki.form.descriptionPlaceholder', '请输入描述（可选）')} rows={3} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== 编辑抽屉 ===== */}
      <Drawer
        placement="right" width={720} open={editDrawerVisible}
        onClose={handleCloseEdit} className="wiki-edit-drawer"
        closable={false} maskClassName="wiki-drawer-mask"
      >
        {detailLoading ? (
          <div className="wiki-drawer-loading"><Spin size="large" /></div>
        ) : currentItem && currentVersion ? (
          <div className="wiki-edit-container">
            {/* 抽屉头部 */}
            <div className="wiki-edit-header">
              <div className="wiki-edit-header-top">
                <Button type="text" icon={<CloseOutlined />} onClick={handleCloseEdit} className="wiki-close-btn" />
                <div className="wiki-edit-actions">
                  {currentVersion.can_edit && (
                    <>
                      <Button icon={<BranchesOutlined />} onClick={handleCreateVersion}>新建版本</Button>
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>保存</Button>
                      <Popconfirm
                        title="确认删除此版本？"
                        description={versions.length <= 1 ? '这是唯一的版本，不能删除' : `将删除 v${currentVersion.version_number}`}
                        onConfirm={handleDeleteVersion} okText="确定" cancelText="取消"
                        disabled={versions.length <= 1}>
                        <Button danger icon={<DeleteOutlined />} disabled={versions.length <= 1}>删除版本</Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
              </div>
              {/* 标题和范围 */}
              <div className="wiki-edit-title-row">
                <h2 className="wiki-edit-main-title">{currentVersion.title}</h2>
                <Tag className="wiki-scope-tag"
                  style={{
                    backgroundColor: `${SCOPE_CONFIG[currentItem.scope]?.color}15`,
                    color: SCOPE_CONFIG[currentItem.scope]?.color,
                    borderColor: SCOPE_CONFIG[currentItem.scope]?.color
                  }}>
                  {SCOPE_CONFIG[currentItem.scope]?.icon}
                  <span>{SCOPE_CONFIG[currentItem.scope]?.label}</span>
                </Tag>
              </div>
              {/* 元信息和版本选择 */}
              <div className="wiki-edit-meta-row">
                <div className="wiki-meta-info">
                  <span><UserOutlined /> {currentVersion.created_by_name}</span>
                  <span className="wiki-meta-dot">•</span>
                  <span><ClockCircleOutlined /> {dayjs(currentVersion.created_at).format('YYYY-MM-DD HH:mm')}</span>
                </div>
                <Dropdown menu={{ items: versionMenuItems }} trigger={['click']}
                  placement="bottomRight" overlayClassName="wiki-version-dropdown">
                  <Button className="wiki-version-btn">
                    <HistoryOutlined />
                    <span>v{currentVersion.version_number}</span>
                    <span className="wiki-version-total">({versions.length}个版本)</span>
                    <DownOutlined />
                  </Button>
                </Dropdown>
              </div>
            </div>

            {/* 抽屉主体 - 编辑表单 */}
            <div className="wiki-edit-body">
              <Form form={editForm} layout="vertical" className="wiki-form">
                <Form.Item name="title" label={t('wiki.form.title', '标题')}
                  rules={[{ required: true, message: t('wiki.form.titleRequired', '请输入标题') }]}>
                  <Input placeholder="请输入标题" maxLength={500} disabled={!currentVersion.can_edit} />
                </Form.Item>
                <Form.Item name="description" label={t('wiki.form.description', '描述')}>
                  <TextArea placeholder="请输入描述" rows={2} maxLength={2000} disabled={!currentVersion.can_edit} />
                </Form.Item>
                <Form.Item name="content" label={renderContentLabel()}>
                  <TextArea placeholder={t('wiki.form.contentPlaceholder', '请输入内容...')}
                    rows={12} maxLength={MAX_CONTENT_LENGTH} disabled={!currentVersion.can_edit}
                    className="wiki-content-textarea" onChange={handleContentChange} />
                </Form.Item>

                {/* 备注列表 */}
                <Form.Item label={<span>{t('wiki.form.notes', '备注')} <Text type="secondary" style={{ fontWeight: 400 }}>{t('wiki.form.notesHint', '（最多10条）')}</Text></span>}>
                  <Form.List name="notes">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-list-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item {...field} noStyle>
                              <Input placeholder={t('wiki.form.notePlaceholder', '输入备注内容')} maxLength={500} disabled={!currentVersion.can_edit} />
                            </Form.Item>
                            {currentVersion.can_edit && (
                              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />
                            )}
                          </div>
                        ))}
                        {currentVersion.can_edit && fields.length < 10 && (
                          <Button type="dashed" onClick={() => add('')} icon={<PlusOutlined />} className="wiki-list-add">
                            {t('wiki.form.addNote', '添加备注')}
                          </Button>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>

                {/* 链接列表 */}
                <Form.Item label={<span>{t('wiki.form.links', '相关链接')} <Text type="secondary" style={{ fontWeight: 400 }}>{t('wiki.form.linksHint', '（最多10条）')}</Text></span>}>
                  <Form.List name="links">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-link-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item name={[field.name, 'title']} noStyle>
                              <Input placeholder={t('wiki.form.linkTitle', '链接标题')} style={{ width: 140 }} maxLength={200} disabled={!currentVersion.can_edit} />
                            </Form.Item>
                            <Form.Item name={[field.name, 'url']} noStyle>
                              <Input placeholder={t('wiki.form.linkUrl', 'https://...')} prefix={<LinkOutlined style={{ color: '#bbb' }} />} style={{ flex: 1 }} maxLength={1000} disabled={!currentVersion.can_edit} />
                            </Form.Item>
                            {currentVersion.can_edit && (
                              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />
                            )}
                          </div>
                        ))}
                        {currentVersion.can_edit && fields.length < 10 && (
                          <Button type="dashed" onClick={() => add({ title: '', url: '' })} icon={<PlusOutlined />} className="wiki-list-add">
                            {t('wiki.form.addLink', '添加链接')}
                          </Button>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>
              </Form>

              {/* ===== 危险区域 - 删除知识库（v5.0新增） ===== */}
              {(currentItem.creator_id === user?.id || user?.role === 'super_admin') && (
                <div className="wiki-danger-zone">
                  <Divider className="wiki-danger-divider" />
                  <div className="wiki-danger-zone-content">
                    <div className="wiki-danger-zone-info">
                      <div className="wiki-danger-zone-title">
                        <WarningOutlined /> 删除此知识库
                      </div>
                      <div className="wiki-danger-zone-desc">
                        删除后所有版本和内容将永久丢失，此操作不可撤销
                      </div>
                    </div>
                    <Button danger type="primary" icon={<DeleteOutlined />}
                      onClick={() => handleDeleteWiki(currentItem.id, currentItem.title)}>
                      删除知识库
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

export default Wiki
