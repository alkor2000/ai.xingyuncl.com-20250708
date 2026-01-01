/**
 * 知识库主页面 v3.1
 * 
 * 功能：
 * - 知识库列表展示（卡片式布局）
 * - 三级范围筛选（个人/团队/全局）
 * - 知识库CRUD操作
 * - 版本管理简化版：
 *   - 下拉选择版本，点击直接加载内容
 *   - 三个按钮：新建版本、保存、删除版本
 * 
 * 设计风格：iOS毛玻璃科技风
 * 
 * 更新：2026-01-02 v3.1 修复Form.Item包裹div导致content无法收集的问题
 */

import React, { useState, useEffect, useCallback } from 'react'
import { 
  Card, Button, Input, Empty, Spin, Modal, Form, 
  Select, Segmented, Tag, Tooltip, Dropdown, Typography,
  Space, Drawer, Popconfirm, message, Row, Col
} from 'antd'
import { 
  PlusOutlined, SearchOutlined, BookOutlined,
  DeleteOutlined, PushpinOutlined, PushpinFilled,
  UserOutlined, TeamOutlined, GlobalOutlined,
  HistoryOutlined, EllipsisOutlined, EyeOutlined,
  SaveOutlined, LinkOutlined,
  CopyOutlined, ClearOutlined, FileTextOutlined,
  ClockCircleOutlined, CloseOutlined, DownOutlined,
  BranchesOutlined
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
    selectedVersionNumber,
    getItems, getItem, createItem, updateItem, deleteItem, togglePin,
    createVersion, getVersions, switchToVersion, deleteVersion,
    clearCurrentItem
  } = useWikiStore()

  // ==================== 本地状态 ====================
  const [searchText, setSearchText] = useState('')
  const [currentScope, setCurrentScope] = useState('all')
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [editDrawerVisible, setEditDrawerVisible] = useState(false)
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

  // ==================== 范围配置 ====================
  const scopeIcons = {
    personal: <UserOutlined />,
    team: <TeamOutlined />,
    global: <GlobalOutlined />
  }

  const scopeColors = {
    personal: '#007AFF',
    team: '#34C759',
    global: '#FF9500'
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
      // 加载版本历史
      getVersions(item.id)
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

  // ==================== 保存（覆盖当前） ====================
  const handleSave = async () => {
    try {
      const values = await editForm.validateFields()
      console.log('保存的数据:', values) // 调试用
      await updateItem(currentItem.id, values)
    } catch (error) {
      console.error('保存失败:', error)
    }
  }

  // ==================== 新建版本 ====================
  const handleCreateVersion = async () => {
    if (!currentItem) return
    try {
      // 先保存当前内容
      const values = await editForm.validateFields()
      await updateItem(currentItem.id, values)
      // 再创建新版本
      await createVersion(currentItem.id)
      // 刷新详情
      await getItem(currentItem.id)
    } catch (error) {
      console.error('创建版本失败:', error)
    }
  }

  // ==================== 删除版本 ====================
  const handleDeleteVersion = async () => {
    if (!currentItem || !selectedVersionNumber) return
    
    // 找到当前选中的版本ID
    const selectedVersion = versions.find(v => v.version_number === selectedVersionNumber)
    if (!selectedVersion) {
      message.error('未找到选中的版本')
      return
    }
    
    try {
      await deleteVersion(currentItem.id, selectedVersion.id)
      // 刷新详情
      await getItem(currentItem.id)
    } catch (error) {
      console.error('删除版本失败:', error)
    }
  }

  // ==================== 切换版本 ====================
  const handleSwitchVersion = async (versionId) => {
    try {
      const versionData = await switchToVersion(versionId)
      // 用版本内容填充表单
      editForm.setFieldsValue({
        title: versionData.title,
        description: versionData.description,
        content: versionData.content,
        notes: versionData.notes_snapshot || [],
        links: versionData.links_snapshot || []
      })
      setContentLength(versionData.content?.length || 0)
    } catch (error) {
      console.error('切换版本失败:', error)
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

  // ==================== 版本下拉菜单 ====================
  const versionMenuItems = versions.map(v => ({
    key: v.id,
    label: (
      <div 
        className="wiki-version-menu-item"
        onClick={() => handleSwitchVersion(v.id)}
      >
        <span className="wiki-version-num">v{v.version_number}</span>
        <span className="wiki-version-user">{v.created_by_name}</span>
        <span className="wiki-version-time">{dayjs(v.created_at).format('MM-DD HH:mm')}</span>
        {v.version_number === currentItem?.current_version && (
          <Tag color="blue" size="small">当前</Tag>
        )}
      </div>
    )
  }))

  // ==================== 渲染卡片菜单 ====================
  const getCardMenuItems = (item) => {
    const menuItems = [
      {
        key: 'view',
        icon: <EyeOutlined />,
        label: '查看详情',
        onClick: () => handleOpenEdit(item)
      }
    ]

    if (item.can_edit) {
      menuItems.push(
        {
          key: 'pin',
          icon: item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />,
          label: item.is_pinned ? '取消置顶' : '置顶',
          onClick: () => togglePin(item.id)
        },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确认删除',
              content: '删除后无法恢复，确定要删除吗？',
              okText: '确定',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: () => handleDelete(item.id)
            })
          }
        }
      )
    }

    return menuItems
  }

  // ==================== 渲染内容编辑器标签 ====================
  const renderContentLabel = () => (
    <div className="wiki-content-label-row">
      <div className="wiki-content-label">
        <span>内容</span>
        <span className="wiki-content-hint">支持Markdown格式</span>
      </div>
      {currentItem?.can_edit && (
        <div className="wiki-content-toolbar">
          <Tooltip title="清空内容">
            <Button type="text" icon={<ClearOutlined />} onClick={handleClearContent} size="small" />
          </Tooltip>
          <Tooltip title="复制内容">
            <Button type="text" icon={<CopyOutlined />} onClick={handleCopyContent} size="small" />
          </Tooltip>
          <span className="wiki-content-count">
            {contentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )

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
            { label: '全部', value: 'all' },
            { label: <span><UserOutlined /> 个人</span>, value: 'personal' },
            { label: <span><TeamOutlined /> 团队</span>, value: 'team' },
            { label: <span><GlobalOutlined /> 全局</span>, value: 'global' }
          ]}
        />
        <div className="wiki-count">
          共 {filteredItems.length} 条
        </div>
      </div>

      {/* 知识库列表 */}
      <div className="wiki-content-section">
        {loading ? (
          <div className="wiki-loading">
            <Spin size="large" />
            <p>加载中...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="wiki-empty">
            <Empty description="暂无知识库" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
                创建第一个知识库
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
                  {item.is_pinned && (
                    <div className="wiki-card-pin-badge"><PushpinFilled /></div>
                  )}
                  
                  <div className="wiki-card-scope-badge" style={{ backgroundColor: scopeColors[item.scope] }}>
                    {scopeIcons[item.scope]}
                    <span>{scopeLabels[item.scope]}</span>
                  </div>

                  <div className="wiki-card-body">
                    <div className="wiki-card-header">
                      <Text strong ellipsis className="wiki-card-title">{item.title}</Text>
                      <Dropdown menu={{ items: getCardMenuItems(item) }} trigger={['click']} placement="bottomRight">
                        <Button type="text" icon={<EllipsisOutlined />} className="wiki-card-menu-btn" onClick={(e) => e.stopPropagation()} />
                      </Dropdown>
                    </div>
                    
                    <Paragraph ellipsis={{ rows: 2 }} className="wiki-card-description">
                      {item.description || '暂无描述'}
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
        title={<div className="wiki-modal-title"><PlusOutlined /><span>新建知识库</span></div>}
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields() }}
        okText="创建"
        cancelText="取消"
        width={520}
        className="wiki-modal"
      >
        <Form form={createForm} layout="vertical" className="wiki-form">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入知识库标题" maxLength={500} showCount />
          </Form.Item>
          
          <Form.Item name="scope" label="范围" initialValue="personal">
            <Select>
              <Select.Option value="personal">
                <Space><UserOutlined style={{ color: scopeColors.personal }} /><span>个人</span><Text type="secondary">- 仅自己可见</Text></Space>
              </Select.Option>
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <Select.Option value="team">
                  <Space><TeamOutlined style={{ color: scopeColors.team }} /><span>团队</span><Text type="secondary">- 同组成员可见</Text></Space>
                </Select.Option>
              )}
              {user?.role === 'super_admin' && (
                <Select.Option value="global">
                  <Space><GlobalOutlined style={{ color: scopeColors.global }} /><span>全局</span><Text type="secondary">- 所有人可见</Text></Space>
                </Select.Option>
              )}
            </Select>
          </Form.Item>
          
          <Form.Item name="description" label="描述">
            <TextArea placeholder="请输入描述（可选）" rows={3} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑抽屉 */}
      <Drawer
        placement="right"
        width={720}
        open={editDrawerVisible}
        onClose={handleCloseEdit}
        className="wiki-edit-drawer"
        closable={false}
        maskClassName="wiki-drawer-mask"
      >
        {detailLoading ? (
          <div className="wiki-drawer-loading"><Spin size="large" /></div>
        ) : currentItem ? (
          <div className="wiki-edit-container">
            {/* 头部 */}
            <div className="wiki-edit-header">
              <div className="wiki-edit-header-top">
                <Button type="text" icon={<CloseOutlined />} onClick={handleCloseEdit} className="wiki-close-btn" />
                <div className="wiki-edit-actions">
                  {currentItem.can_edit && (
                    <>
                      <Button icon={<BranchesOutlined />} onClick={handleCreateVersion}>新建版本</Button>
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>保存</Button>
                      <Popconfirm
                        title="确认删除此版本？"
                        description={versions.length <= 1 ? "这是唯一的版本，不能删除" : `将删除 v${selectedVersionNumber}`}
                        onConfirm={handleDeleteVersion}
                        okText="确定"
                        cancelText="取消"
                        disabled={versions.length <= 1}
                      >
                        <Button danger icon={<DeleteOutlined />} disabled={versions.length <= 1}>删除版本</Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
              </div>

              {/* 标题和范围 */}
              <div className="wiki-edit-title-row">
                <h2 className="wiki-edit-main-title">{currentItem.title}</h2>
                <Tag 
                  className="wiki-scope-tag"
                  style={{ backgroundColor: `${scopeColors[currentItem.scope]}15`, color: scopeColors[currentItem.scope], borderColor: scopeColors[currentItem.scope] }}
                >
                  {scopeIcons[currentItem.scope]}
                  <span>{scopeLabels[currentItem.scope]}</span>
                </Tag>
              </div>

              {/* 元信息和版本选择器 */}
              <div className="wiki-edit-meta-row">
                <div className="wiki-meta-info">
                  <span><UserOutlined /> {currentItem.creator_name}</span>
                  <span className="wiki-meta-dot">•</span>
                  <span><ClockCircleOutlined /> {dayjs(currentItem.updated_at).format('YYYY-MM-DD HH:mm')}</span>
                </div>
                
                <Dropdown
                  menu={{ items: versionMenuItems }}
                  trigger={['click']}
                  placement="bottomRight"
                  overlayClassName="wiki-version-dropdown"
                >
                  <Button className="wiki-version-btn">
                    <HistoryOutlined />
                    <span>v{selectedVersionNumber || currentItem.current_version}</span>
                    <span className="wiki-version-total">({versions.length}个版本)</span>
                    <DownOutlined />
                  </Button>
                </Dropdown>
              </div>
            </div>

            {/* 编辑表单 */}
            <div className="wiki-edit-body">
              <Form form={editForm} layout="vertical" className="wiki-form">
                <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                  <Input placeholder="请输入标题" maxLength={500} disabled={!currentItem.can_edit} />
                </Form.Item>
                
                <Form.Item name="description" label="描述">
                  <TextArea placeholder="请输入描述" rows={2} maxLength={2000} disabled={!currentItem.can_edit} />
                </Form.Item>
                
                {/* 
                  v3.1修复：content的Form.Item子元素必须是TextArea而不是div
                  把工具栏移到label里面，确保TextArea是Form.Item的直接子元素
                */}
                <Form.Item name="content" label={renderContentLabel()}>
                  <TextArea 
                    placeholder="请输入内容..." 
                    rows={12} 
                    maxLength={MAX_CONTENT_LENGTH} 
                    disabled={!currentItem.can_edit} 
                    className="wiki-content-textarea" 
                    onChange={handleContentChange} 
                  />
                </Form.Item>

                {/* 备注 */}
                <Form.Item label={<span>备注 <Text type="secondary" style={{ fontWeight: 400 }}>（最多10条）</Text></span>}>
                  <Form.List name="notes">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-list-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item {...field} noStyle>
                              <Input placeholder="输入备注内容" maxLength={500} disabled={!currentItem.can_edit} />
                            </Form.Item>
                            {currentItem.can_edit && (
                              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />
                            )}
                          </div>
                        ))}
                        {currentItem.can_edit && fields.length < 10 && (
                          <Button type="dashed" onClick={() => add('')} icon={<PlusOutlined />} className="wiki-list-add">添加备注</Button>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>

                {/* 链接 */}
                <Form.Item label={<span>相关链接 <Text type="secondary" style={{ fontWeight: 400 }}>（最多10条）</Text></span>}>
                  <Form.List name="links">
                    {(fields, { add, remove }) => (
                      <div className="wiki-list-container">
                        {fields.map((field, index) => (
                          <div key={field.key} className="wiki-link-item">
                            <span className="wiki-list-index">{index + 1}</span>
                            <Form.Item name={[field.name, 'title']} noStyle>
                              <Input placeholder="链接标题" style={{ width: 140 }} maxLength={200} disabled={!currentItem.can_edit} />
                            </Form.Item>
                            <Form.Item name={[field.name, 'url']} noStyle>
                              <Input placeholder="https://..." prefix={<LinkOutlined style={{ color: '#bbb' }} />} style={{ flex: 1 }} maxLength={1000} disabled={!currentItem.can_edit} />
                            </Form.Item>
                            {currentItem.can_edit && (
                              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />
                            )}
                          </div>
                        ))}
                        {currentItem.can_edit && fields.length < 10 && (
                          <Button type="dashed" onClick={() => add({ title: '', url: '' })} icon={<PlusOutlined />} className="wiki-list-add">添加链接</Button>
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
    </div>
  )
}

export default Wiki
