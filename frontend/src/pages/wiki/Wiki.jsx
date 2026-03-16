/**
 * 知识库主页面
 * 
 * 支持两种知识库类型：
 * 1. 文本知识库(text) - 手动编辑文本内容+备注+链接
 * 2. RAG文档知识库(file) - 上传文档+向量索引+chunk预览+语义检索
 * 
 * 创建时通过Segmented选择类型，编辑抽屉根据类型显示不同UI
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Button, Input, Empty, Spin, Modal, Form,
  Select, Segmented, Tag, Tooltip, Dropdown, Typography,
  Space, Drawer, Popconfirm, message, Row, Col, Divider,
  Upload, Progress, Alert, Collapse, Descriptions
} from 'antd'
import {
  PlusOutlined, SearchOutlined, BookOutlined,
  DeleteOutlined, PushpinOutlined, PushpinFilled,
  UserOutlined, TeamOutlined, GlobalOutlined,
  HistoryOutlined, EllipsisOutlined, EyeOutlined,
  SaveOutlined, LinkOutlined, ExclamationCircleOutlined,
  CopyOutlined, ClearOutlined, FileTextOutlined,
  ClockCircleOutlined, CloseOutlined, DownOutlined,
  BranchesOutlined, WarningOutlined,
  UploadOutlined, ThunderboltOutlined, DatabaseOutlined,
  CheckCircleOutlined, LoadingOutlined, CloudUploadOutlined,
  FileSearchOutlined, NumberOutlined, ApiOutlined
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
const MAX_CONTENT_LENGTH = 100000

/** 范围配置 */
const SCOPE_CONFIG = {
  personal: { icon: <UserOutlined />, color: '#3b82f6', label: '个人', desc: '仅自己可见' },
  team: { icon: <TeamOutlined />, color: '#8b5cf6', label: '团队', desc: '同组成员可见' },
  global: { icon: <GlobalOutlined />, color: '#f59e0b', label: '全局', desc: '所有人可见' }
}

/** 知识库类型配置 */
const TYPE_CONFIG = {
  text: { label: '📝 文本知识库', desc: '手动编辑文本内容' },
  file: { label: '🔍 RAG文档知识库', desc: '上传文档，AI语义检索' }
}

const Wiki = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    items, currentItem, currentVersion, versions, loading, detailLoading,
    getItems, getItem, createItem, deleteItem, togglePin,
    getVersions, switchToVersion, saveVersion, createVersion, deleteVersion,
    clearCurrentItem, uploadDocument, buildIndex, getIndexStatus, indexStatus,
    indexing, uploading, getChunks, chunks, chunksLoading
  } = useWikiStore()

  /* 本地状态 */
  const [searchText, setSearchText] = useState('')
  const [currentScope, setCurrentScope] = useState('all')
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [editDrawerVisible, setEditDrawerVisible] = useState(false)
  const [contentLength, setContentLength] = useState(0)
  const [createType, setCreateType] = useState('text')
  const [showContentPreview, setShowContentPreview] = useState(false)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()

  /* 加载列表 */
  useEffect(() => {
    const scope = currentScope === 'all' ? null : currentScope
    getItems(scope)
  }, [currentScope, getItems])

  /* 过滤 */
  const filteredItems = items.filter(item => {
    if (!searchText) return true
    const s = searchText.toLowerCase()
    return item.title?.toLowerCase().includes(s) || item.description?.toLowerCase().includes(s)
  })

  /* 判断是否为RAG知识库 */
  const isRAGMode = useCallback(() => {
    return currentItem?.source_type === 'file'
  }, [currentItem])

  /* ========== 创建 ========== */
  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      values.source_type = createType
      await createItem(values)
      setCreateModalVisible(false)
      createForm.resetFields()
      setCreateType('text')
    } catch (error) { console.error('创建失败:', error) }
  }

  /* ========== 打开编辑 ========== */
  const handleOpenEdit = async (item) => {
    try {
      const detail = await getItem(item.id)
      const versionList = await getVersions(item.id)
      setEditDrawerVisible(true)
      setShowContentPreview(false)
      getIndexStatus(item.id)
      /* RAG知识库自动加载chunks */
      if (detail.source_type === 'file') {
        getChunks(item.id)
      }
      if (versionList && versionList.length > 0) {
        const currentVer = versionList.find(v => v.version_number === detail.current_version)
        await switchToVersion(currentVer ? currentVer.id : versionList[0].id)
      }
    } catch (error) { console.error('获取详情失败:', error) }
  }

  /* 版本数据同步表单 */
  useEffect(() => {
    if (currentVersion && editDrawerVisible) {
      editForm.setFieldsValue({
        title: currentVersion.title, description: currentVersion.description,
        content: currentVersion.content, notes: currentVersion.notes_snapshot || [],
        links: currentVersion.links_snapshot || []
      })
      setContentLength(currentVersion.content?.length || 0)
    }
  }, [currentVersion, editDrawerVisible, editForm])

  /* ========== 文本知识库操作 ========== */
  const handleSave = async () => {
    if (!currentVersion) return
    try {
      const values = await editForm.validateFields()
      await saveVersion(currentVersion.id, {
        title: values.title, description: values.description,
        content: values.content, notes: values.notes, links: values.links
      })
    } catch (error) { console.error('保存失败:', error) }
  }

  const handleCreateVersion = async () => {
    if (!currentItem || !currentVersion) return
    try { await createVersion(currentItem.id, currentVersion.id) }
    catch (error) { console.error('创建版本失败:', error) }
  }

  const handleDeleteVersion = async () => {
    if (!currentItem || !currentVersion) return
    try { await deleteVersion(currentItem.id, currentVersion.id) }
    catch (error) { console.error('删除版本失败:', error) }
  }

  const handleSwitchVersion = async (versionId) => {
    try { await switchToVersion(versionId) }
    catch (error) { console.error('切换版本失败:', error) }
  }

  const handleCloseEdit = () => {
    setEditDrawerVisible(false)
    clearCurrentItem()
    editForm.resetFields()
    setContentLength(0)
    setShowContentPreview(false)
  }

  const handleDeleteWiki = (id, title) => {
    Modal.confirm({
      title: '确认删除知识库',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (<div><p>即将删除 <Text strong>「{title}」</Text></p>
        <p style={{ color: '#ff4d4f', fontSize: 13 }}>删除后所有版本、内容和向量索引将永久丢失！</p></div>),
      okText: '确认删除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: async () => {
        await deleteItem(id)
        if (editDrawerVisible && currentItem?.id === id) handleCloseEdit()
      }
    })
  }

  const handleClearContent = () => { editForm.setFieldsValue({ content: '' }); setContentLength(0); message.success('内容已清空') }
  const handleCopyContent = async () => {
    const content = editForm.getFieldValue('content')
    if (!content) { message.warning('内容为空'); return }
    try { await navigator.clipboard.writeText(content); message.success('已复制') }
    catch { const ta = document.createElement('textarea'); ta.value = content; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); message.success('已复制') }
  }
  const handleContentChange = (e) => setContentLength(e.target.value?.length || 0)

  /* ========== RAG操作 ========== */
  /* 多文件上传：收集所有文件后一次性提交 */
  const pendingFiles = React.useRef([])
  const uploadTimer = React.useRef(null)

  const handleFileUpload = (file) => {
    if (!currentItem) return false
    pendingFiles.current.push(file)
    /* 用定时器延迟100ms，等所有文件都被收集后再统一上传 */
    if (uploadTimer.current) clearTimeout(uploadTimer.current)
    uploadTimer.current = setTimeout(async () => {
      const files = [...pendingFiles.current]
      pendingFiles.current = []
      try {
        await uploadDocument(currentItem.id, files)
        await getItem(currentItem.id)
        await getVersions(currentItem.id)
        const vList = useWikiStore.getState().versions
        if (vList.length > 0) await switchToVersion(vList[0].id)
        await getIndexStatus(currentItem.id)
        if (currentItem.source_type === 'file') getChunks(currentItem.id)
      } catch (error) { /* store已处理 */ }
    }, 100)
    return false
  }

  const handleBuildIndex = async () => {
    if (!currentItem) return
    try { await buildIndex(currentItem.id) }
    catch (error) { /* store已处理 */ }
  }

  /* ========== 版本下拉菜单 ========== */
  const versionMenuItems = versions.map(v => ({
    key: v.id,
    label: (
      <div className="wiki-version-menu-item" onClick={() => handleSwitchVersion(v.id)}>
        <span className="wiki-version-num">v{v.version_number}</span>
        <span className="wiki-version-user">{v.created_by_name}</span>
        <span className="wiki-version-time">{dayjs(v.created_at).format('MM-DD HH:mm')}</span>
        {currentVersion?.version_number === v.version_number && <Tag color="blue" size="small">当前</Tag>}
      </div>
    )
  }))

  /* ========== 卡片菜单 ========== */
  const getCardMenuItems = (item) => {
    const mi = [{ key: 'view', icon: <EyeOutlined />, label: '查看编辑' }]
    if (item.can_edit) mi.push({ key: 'pin', icon: item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />, label: item.is_pinned ? '取消置顶' : '置顶' })
    if (item.creator_id === user?.id || user?.role === 'super_admin') mi.push({ type: 'divider' }, { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true })
    return mi
  }
  const handleCardMenuClick = (key, item) => {
    if (key === 'view') handleOpenEdit(item)
    else if (key === 'pin') togglePin(item.id)
    else if (key === 'delete') handleDeleteWiki(item.id, item.title)
  }

  /* ========== 渲染：文本知识库编辑区域 ========== */
  const renderTextEditor = () => (
    <>
      <Form.Item name="content" label={
        <div className="wiki-content-label-row">
          <div className="wiki-content-label"><span>内容</span><span className="wiki-content-hint">支持Markdown格式，最多{MAX_CONTENT_LENGTH.toLocaleString()}字符</span></div>
          {currentVersion?.can_edit && (
            <div className="wiki-content-toolbar">
              <Tooltip title="清空"><Button type="text" icon={<ClearOutlined />} onClick={handleClearContent} size="small" /></Tooltip>
              <Tooltip title="复制"><Button type="text" icon={<CopyOutlined />} onClick={handleCopyContent} size="small" /></Tooltip>
              <span className="wiki-content-count">{contentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()}</span>
            </div>
          )}
        </div>
      }>
        <TextArea placeholder="请输入内容..." rows={12} maxLength={MAX_CONTENT_LENGTH}
          disabled={!currentVersion.can_edit} className="wiki-content-textarea" onChange={handleContentChange} />
      </Form.Item>

      {/* 备注 */}
      <Form.Item label={<span>备注 <Text type="secondary" style={{ fontWeight: 400 }}>（最多10条）</Text></span>}>
        <Form.List name="notes">
          {(fields, { add, remove }) => (
            <div className="wiki-list-container">
              {fields.map((field, index) => (
                <div key={field.key} className="wiki-list-item">
                  <span className="wiki-list-index">{index + 1}</span>
                  <Form.Item {...field} noStyle><Input placeholder="输入备注内容" maxLength={500} disabled={!currentVersion.can_edit} /></Form.Item>
                  {currentVersion.can_edit && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />}
                </div>
              ))}
              {currentVersion.can_edit && fields.length < 10 && (
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
                  <Form.Item name={[field.name, 'title']} noStyle><Input placeholder="链接标题" style={{ width: 140 }} maxLength={200} disabled={!currentVersion.can_edit} /></Form.Item>
                  <Form.Item name={[field.name, 'url']} noStyle><Input placeholder="https://..." prefix={<LinkOutlined style={{ color: '#bbb' }} />} style={{ flex: 1 }} maxLength={1000} disabled={!currentVersion.can_edit} /></Form.Item>
                  {currentVersion.can_edit && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} className="wiki-list-delete" />}
                </div>
              ))}
              {currentVersion.can_edit && fields.length < 10 && (
                <Button type="dashed" onClick={() => add({ title: '', url: '' })} icon={<PlusOutlined />} className="wiki-list-add">添加链接</Button>
              )}
            </div>
          )}
        </Form.List>
      </Form.Item>
    </>
  )

  /* ========== 渲染：RAG知识库编辑区域 ========== */
  const renderRAGEditor = () => {
    const is = indexStatus || currentItem || {}
    const statusMap = {
      none: { color: '#d9d9d9', text: '未索引', icon: <DatabaseOutlined /> },
      processing: { color: '#1890ff', text: '索引中...', icon: <LoadingOutlined spin /> },
      completed: { color: '#52c41a', text: `已索引`, icon: <CheckCircleOutlined /> },
      failed: { color: '#ff4d4f', text: '索引失败', icon: <ExclamationCircleOutlined /> }
    }
    const s = statusMap[is.index_status] || statusMap.none
    const chunkData = chunks || {}

    return (
      <>
        {/* 文件上传区 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <CloudUploadOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <Text strong style={{ fontSize: 15 }}>文档管理</Text>
          </div>
          {is.file_name && (
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="当前文件">
                <Space>
                  <FileTextOutlined style={{ color: '#722ed1' }} />
                  <Text strong>{is.file_name}</Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="文件大小">
                {is.file_size ? `${(is.file_size / 1024).toFixed(1)} KB` : '-'}
              </Descriptions.Item>
            </Descriptions>
          )}
          {currentVersion?.can_edit && (
            <Upload.Dragger
              accept=".pdf,.docx,.txt,.md,.markdown"
              beforeUpload={handleFileUpload}
              showUploadList={false}
              disabled={uploading}
              multiple={true}
              style={{ borderRadius: 10, borderColor: '#d9d9d9' }}
            >
              {uploading ? (
                <div style={{ padding: '16px 0' }}><LoadingOutlined style={{ fontSize: 28, color: '#722ed1' }} />
                  <p style={{ marginTop: 8, color: '#8c8c8c' }}>正在解析文档...</p></div>
              ) : (
                <div style={{ padding: '16px 0' }}><UploadOutlined style={{ fontSize: 28, color: '#8c8c8c' }} />
                  <p style={{ marginTop: 8, color: '#8c8c8c', fontSize: 13 }}>
                    {is.file_name ? '点击或拖拽文件追加上传（最多20个，支持PDF/Word/TXT/MD）' : '点击或拖拽上传文档（最多20个，支持PDF/Word/TXT/MD）'}
                  </p></div>
              )}
            </Upload.Dragger>
          )}
        </div>

        {/* 索引状态面板 */}
        <div style={{
          background: '#fafafa', borderRadius: 12, padding: '16px 20px',
          border: '1px solid #f0f0f0', marginBottom: 20
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Space size="middle">
              <ThunderboltOutlined style={{ color: '#722ed1', fontSize: 16 }} />
              <Text strong style={{ fontSize: 15 }}>向量索引</Text>
              <Tag color={s.color} icon={s.icon} style={{ borderRadius: 6 }}>{s.text}</Tag>
            </Space>
            {currentVersion?.can_edit && (
              <Button type="primary" icon={<ThunderboltOutlined />}
                loading={indexing} onClick={handleBuildIndex}
                style={{ borderRadius: 8, background: '#722ed1', borderColor: '#722ed1' }}
                disabled={!is.file_name && !currentItem?.content}>
                {is.index_status === 'completed' ? '重建索引' : '构建索引'}
              </Button>
            )}
          </div>

          {indexing && <Progress percent={99} status="active" size="small" showInfo={false} style={{ marginBottom: 12 }} />}

          {is.index_status === 'completed' && (
            <Descriptions size="small" column={3} style={{ marginTop: 8 }}>
              <Descriptions.Item label={<><NumberOutlined /> 分块数</>}>
                <Text strong style={{ color: '#722ed1' }}>{chunkData.total_chunks || is.chunk_count || 0}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={<><DatabaseOutlined /> 总Tokens</>}>
                <Text strong style={{ color: '#1890ff' }}>
                  {chunkData.total_tokens ? (chunkData.total_tokens > 1000 ? `${(chunkData.total_tokens / 1000).toFixed(1)}K` : chunkData.total_tokens) : '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label={<><ClockCircleOutlined /> 索引时间</>}>
                {is.indexed_at ? dayjs(is.indexed_at).format('MM-DD HH:mm') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={<><ApiOutlined /> Embedding模型</>} span={3}>
                <Tag color="purple" style={{ borderRadius: 4 }}>
                  {chunkData.chunks?.[0]?.embedding_model || '-'}
                </Tag>
                {chunkData.chunks?.[0]?.has_embedding && (
                  <Tag color="success" style={{ borderRadius: 4 }}>
                    <CheckCircleOutlined /> 向量已就绪
                  </Tag>
                )}
              </Descriptions.Item>
            </Descriptions>
          )}
        </div>

        {/* Chunks列表预览 */}
        {is.index_status === 'completed' && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <FileSearchOutlined style={{ color: '#1890ff', fontSize: 16 }} />
              <Text strong style={{ fontSize: 15 }}>文档分块预览</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {chunkData.total_chunks || 0} 个分块
              </Text>
            </div>
            {chunksLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            ) : chunkData.chunks && chunkData.chunks.length > 0 ? (
              <Collapse size="small" ghost
                items={chunkData.chunks.map((chunk, idx) => ({
                  key: idx,
                  label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Space>
                        <Tag color="blue" style={{ borderRadius: 4, minWidth: 50, textAlign: 'center' }}>
                          #{chunk.chunk_index}
                        </Tag>
                        <Text ellipsis style={{ maxWidth: 350, fontSize: 13 }}>
                          {chunk.content_preview}
                        </Text>
                      </Space>
                      <Space size={4}>
                        <Tag style={{ fontSize: 11 }}>{chunk.token_count} tokens</Tag>
                        {chunk.has_embedding && <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />}
                      </Space>
                    </div>
                  ),
                  children: (
                    <pre style={{
                      background: '#f5f5f5', padding: 12, borderRadius: 8,
                      fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all', maxHeight: 200, overflow: 'auto'
                    }}>
                      {chunk.content_full || chunk.content_preview}
                    </pre>
                  )
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分块数据" />
            )}
          </div>
        )}

        {/* 解析文本只读预览（折叠） */}
        {currentVersion?.content && (
          <div style={{ marginBottom: 20 }}>
            <Button type="link" size="small" onClick={() => setShowContentPreview(!showContentPreview)}
              icon={showContentPreview ? <DownOutlined /> : <EyeOutlined />}
              style={{ padding: 0, marginBottom: 8 }}>
              {showContentPreview ? '收起解析文本' : '查看解析后的原始文本'}
            </Button>
            {showContentPreview && (
              <div style={{
                background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8,
                padding: 16, maxHeight: 300, overflow: 'auto'
              }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopyContent}>复制文本</Button>
                </div>
                <pre style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                  {currentVersion.content}
                </pre>
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  /* ========== 页面渲染 ========== */
  return (
    <div className="wiki-page">
      {/* 头部 */}
      <div className="wiki-header-section">
        <div className="wiki-header-content">
          <div className="wiki-header-left">
            <div className="wiki-header-icon-wrapper"><BookOutlined className="wiki-header-icon" /></div>
            <div className="wiki-header-text">
              <h1 className="wiki-header-title">{t('wiki.title', '知识库')}</h1>
              <p className="wiki-header-subtitle">{t('wiki.subtitle', '管理您的知识文档')}</p>
            </div>
          </div>
          <div className="wiki-header-right">
            <Input placeholder={t('wiki.searchPlaceholder', '搜索知识库...')} prefix={<SearchOutlined />}
              value={searchText} onChange={(e) => setSearchText(e.target.value)} className="wiki-search-input" allowClear />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)} className="wiki-create-btn">
              {t('wiki.actions.create', '新建')}
            </Button>
          </div>
        </div>
      </div>

      {/* 筛选 */}
      <div className="wiki-filter-section">
        <Segmented value={currentScope} onChange={setCurrentScope} className="wiki-scope-filter"
          options={[
            { label: '全部', value: 'all' },
            { label: <span><UserOutlined /> 个人</span>, value: 'personal' },
            { label: <span><TeamOutlined /> 团队</span>, value: 'team' },
            { label: <span><GlobalOutlined /> 全局</span>, value: 'global' }
          ]} />
        <div className="wiki-count">共 {filteredItems.length} 条</div>
      </div>

      {/* 卡片列表 */}
      <div className="wiki-content-section">
        {loading ? (
          <div className="wiki-loading"><Spin size="large" /><p>加载中...</p></div>
        ) : filteredItems.length === 0 ? (
          <div className="wiki-empty">
            <Empty description="暂无知识库" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>创建第一个知识库</Button>
            </Empty>
          </div>
        ) : (
          <Row gutter={[16, 16]} className="wiki-grid">
            {filteredItems.map(item => {
              const sc = SCOPE_CONFIG[item.scope] || SCOPE_CONFIG.personal
              const isRAG = item.source_type === 'file'
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.id}>
                  <Card className={`wiki-card ${item.is_pinned ? 'wiki-card-pinned' : ''}`} hoverable onClick={() => handleOpenEdit(item)}>
                    {item.is_pinned && <div className="wiki-card-pin-badge"><PushpinFilled /></div>}
                    <div className="wiki-card-scope-badge" style={{ backgroundColor: isRAG ? '#722ed1' : sc.color }}>
                      {isRAG ? <><ThunderboltOutlined /><span>RAG</span></> : <>{sc.icon}<span>{sc.label}</span></>}
                    </div>
                    <div className="wiki-card-body">
                      <div className="wiki-card-header">
                        <Text strong ellipsis className="wiki-card-title">{item.title}</Text>
                        <Dropdown menu={{ items: getCardMenuItems(item), onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); handleCardMenuClick(key, item) } }}
                          trigger={['click']} placement="bottomRight">
                          <Button type="text" icon={<EllipsisOutlined />} className="wiki-card-menu-btn" onClick={(e) => e.stopPropagation()} />
                        </Dropdown>
                      </div>
                      <Paragraph ellipsis={{ rows: 2 }} className="wiki-card-description">{item.description || '暂无描述'}</Paragraph>
                      <div className="wiki-card-footer">
                        <div className="wiki-card-meta">
                          <UserOutlined /><span>{item.creator_name || '未知'}</span>
                          <span className="wiki-card-meta-dot">·</span>
                          <FileTextOutlined /><span>v{item.current_version}</span>
                          {isRAG && item.index_status === 'completed' && (
                            <><span className="wiki-card-meta-dot">·</span>
                              <Tag color="purple" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                                <ThunderboltOutlined /> {item.chunk_count || 0}块
                              </Tag></>
                          )}
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
      <Modal title={<div className="wiki-modal-title"><PlusOutlined /><span>新建知识库</span></div>}
        open={createModalVisible} onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields(); setCreateType('text') }}
        okText="创建" cancelText="取消" width={520} className="wiki-modal">
        <Form form={createForm} layout="vertical" className="wiki-form">
          {/* 类型选择 */}
          <Form.Item label="类型">
            <Segmented block value={createType} onChange={setCreateType}
              options={[
                { label: TYPE_CONFIG.text.label, value: 'text' },
                { label: TYPE_CONFIG.file.label, value: 'file' }
              ]}
              style={{ marginBottom: 4 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {TYPE_CONFIG[createType].desc}
            </Text>
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入知识库标题" maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="scope" label="范围" initialValue="personal">
            <Select>
              {Object.entries(SCOPE_CONFIG).map(([key, cfg]) => {
                if (key === 'team' && user?.role !== 'admin' && user?.role !== 'super_admin') return null
                if (key === 'global' && user?.role !== 'super_admin') return null
                return <Select.Option value={key} key={key}><Space>{React.cloneElement(cfg.icon, { style: { color: cfg.color } })}<span>{cfg.label}</span><Text type="secondary">- {cfg.desc}</Text></Space></Select.Option>
              })}
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述"><TextArea placeholder="请输入描述（可选）" rows={3} maxLength={2000} showCount /></Form.Item>
        </Form>
      </Modal>

      {/* ===== 编辑抽屉 ===== */}
      <Drawer placement="right" width={720} open={editDrawerVisible} onClose={handleCloseEdit} className="wiki-edit-drawer" closable={false}>
        {detailLoading ? (
          <div className="wiki-drawer-loading"><Spin size="large" /></div>
        ) : currentItem && currentVersion ? (
          <div className="wiki-edit-container">
            {/* 头部 */}
            <div className="wiki-edit-header">
              <div className="wiki-edit-header-top">
                <Button type="text" icon={<CloseOutlined />} onClick={handleCloseEdit} className="wiki-close-btn" />
                <div className="wiki-edit-actions">
                  {currentVersion.can_edit && !isRAGMode() && (
                    <>
                      <Button icon={<BranchesOutlined />} onClick={handleCreateVersion}>新建版本</Button>
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>保存</Button>
                      <Popconfirm title="确认删除此版本？" description={versions.length <= 1 ? '唯一版本不能删除' : `将删除 v${currentVersion.version_number}`}
                        onConfirm={handleDeleteVersion} okText="确定" cancelText="取消" disabled={versions.length <= 1}>
                        <Button danger icon={<DeleteOutlined />} disabled={versions.length <= 1}>删除版本</Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
              </div>
              <div className="wiki-edit-title-row">
                <h2 className="wiki-edit-main-title">{currentVersion.title}</h2>
                <Space>
                  {isRAGMode() && (
                    <Tag color="purple" style={{ borderRadius: 6, fontWeight: 600 }}>
                      <ThunderboltOutlined /> RAG文档
                    </Tag>
                  )}
                  <Tag className="wiki-scope-tag" style={{ backgroundColor: `${SCOPE_CONFIG[currentItem.scope]?.color}15`, color: SCOPE_CONFIG[currentItem.scope]?.color, borderColor: SCOPE_CONFIG[currentItem.scope]?.color }}>
                    {SCOPE_CONFIG[currentItem.scope]?.icon}<span>{SCOPE_CONFIG[currentItem.scope]?.label}</span>
                  </Tag>
                </Space>
              </div>
              <div className="wiki-edit-meta-row">
                <div className="wiki-meta-info">
                  <span><UserOutlined /> {currentVersion.created_by_name}</span>
                  <span className="wiki-meta-dot">•</span>
                  <span><ClockCircleOutlined /> {dayjs(currentVersion.created_at).format('YYYY-MM-DD HH:mm')}</span>
                </div>
                {!isRAGMode() && (
                  <Dropdown menu={{ items: versionMenuItems }} trigger={['click']} placement="bottomRight" overlayClassName="wiki-version-dropdown">
                    <Button className="wiki-version-btn"><HistoryOutlined /><span>v{currentVersion.version_number}</span><span className="wiki-version-total">({versions.length}个版本)</span><DownOutlined /></Button>
                  </Dropdown>
                )}
              </div>
            </div>

            {/* 编辑主体 - 根据类型切换 */}
            <div className="wiki-edit-body">
              <Form form={editForm} layout="vertical" className="wiki-form">
                {/* RAG知识库只显示标题和描述（可编辑） */}
                {isRAGMode() ? (
                  <>
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                      <Input placeholder="请输入标题" maxLength={500} disabled={!currentVersion.can_edit} />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                      <TextArea placeholder="请输入描述" rows={2} maxLength={2000} disabled={!currentVersion.can_edit} />
                    </Form.Item>
                    {/* RAG编辑区：文件+索引+chunks */}
                    {renderRAGEditor()}
                    {/* RAG也有保存（标题/描述） */}
                    {currentVersion.can_edit && (
                      <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading} style={{ marginBottom: 20 }}>
                        保存标题和描述
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                      <Input placeholder="请输入标题" maxLength={500} disabled={!currentVersion.can_edit} />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                      <TextArea placeholder="请输入描述" rows={2} maxLength={2000} disabled={!currentVersion.can_edit} />
                    </Form.Item>
                    {renderTextEditor()}
                  </>
                )}
              </Form>

              {/* 危险区域 */}
              {(currentItem.creator_id === user?.id || user?.role === 'super_admin') && (
                <div className="wiki-danger-zone">
                  <Divider className="wiki-danger-divider" />
                  <div className="wiki-danger-zone-content">
                    <div className="wiki-danger-zone-info">
                      <div className="wiki-danger-zone-title"><WarningOutlined /> 删除此知识库</div>
                      <div className="wiki-danger-zone-desc">删除后所有版本、内容和向量索引将永久丢失</div>
                    </div>
                    <Button danger type="primary" icon={<DeleteOutlined />} onClick={() => handleDeleteWiki(currentItem.id, currentItem.title)}>删除知识库</Button>
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
