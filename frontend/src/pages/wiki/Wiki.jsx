/**
 * 知识库主页面 v2.0
 *
 * 支持两种知识库类型：
 * 1. 文本知识库(text) - 手动编辑文本内容+备注+链接
 * 2. RAG文档知识库(file) - 上传文档+向量索引+chunk预览+语义检索
 *
 * 创建时通过Segmented选择类型，编辑抽屉根据类型显示不同UI
 *
 * v2.0 国际化改造 + 一处全局 Bug 修复：
 * 【Bug 修复】原代码在模块顶层写死 dayjs.locale('zh-cn')。
 *   dayjs.locale() 是全局设置而非实例级设置，只要本文件被加载（访问知识库页面即加载），
 *   整个应用的 dayjs 语言就被锁定为中文，导致其他页面在英文环境下的
 *   相对时间（如 "2 days ago"）也会显示为中文"2 天前"。
 *   现改为在组件内 useEffect 中根据 i18n.language 动态设置。
 * 【国际化】原文件仅 4 处调用 t() 且都带中文兜底，其余约 110 处为硬编码中文。
 *   本次全部改为 wiki.* 翻译键，并移除 t() 的中文兜底第二参数
 *   （兜底值会在键缺失时被直接返回，造成"切了英文仍显示中文"的假象）。
 * 【结构调整】SCOPE_CONFIG / TYPE_CONFIG 原为模块级常量且内含中文，
 *   模块常量在加载时即固化，语言切换后不会更新。
 *   现将文案剥离到 i18n，常量内只保留图标与颜色等与语言无关的配置。
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card, Button, Input, Empty, Spin, Modal, Form,
  Select, Segmented, Tag, Tooltip, Dropdown, Typography,
  Space, Drawer, Popconfirm, message, Row, Col, Divider,
  Upload, Progress, Collapse, Descriptions
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
import 'dayjs/locale/en'
import './Wiki.less'

/* 仅注册插件，不在模块层设置全局语言（避免污染其他页面） */
dayjs.extend(relativeTime)

const { TextArea } = Input
const { Text, Paragraph } = Typography

/** 内容最大字符数 */
const MAX_CONTENT_LENGTH = 100000
/** 备注 / 链接的最大条目数 */
const MAX_LIST_ITEMS = 10
/** 单次最多上传文件数 */
const MAX_UPLOAD_FILES = 20
/** 多文件上传收集等待时长（毫秒） */
const UPLOAD_COLLECT_DELAY_MS = 100

/**
 * 范围配置（仅保留与语言无关的图标与颜色）
 * 文案通过 i18n 的 wiki.scope.* 获取，避免模块常量固化中文
 */
const SCOPE_CONFIG = {
  personal: { icon: <UserOutlined />, color: '#3b82f6' },
  team: { icon: <TeamOutlined />, color: '#8b5cf6' },
  global: { icon: <GlobalOutlined />, color: '#f59e0b' }
}

const Wiki = () => {
  const { t, i18n } = useTranslation()
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

  /**
   * dayjs 语言跟随 i18n 设置
   * 修复原先在模块顶层写死 zh-cn 导致的全局语言污染问题
   */
  useEffect(() => {
    const lang = i18n.language || 'zh-CN'
    dayjs.locale(lang.startsWith('zh') ? 'zh-cn' : 'en')
  }, [i18n.language])

  /**
   * 知识库类型配置
   * 使用 useMemo 依赖 t，语言切换时重新生成，保证 Segmented 文案实时更新
   */
  const typeOptions = useMemo(() => ({
    text: { label: t('wiki.type.text'), desc: t('wiki.type.textDesc') },
    file: { label: t('wiki.type.file'), desc: t('wiki.type.fileDesc') }
  }), [t])

  /**
   * 获取范围的显示名称与描述（合并图标颜色配置与 i18n 文案）
   */
  const getScopeInfo = useCallback((scopeKey) => {
    const cfg = SCOPE_CONFIG[scopeKey] || SCOPE_CONFIG.personal
    return {
      ...cfg,
      label: t(`wiki.scope.${scopeKey}`, { defaultValue: t('wiki.scope.personal') }),
      desc: t(`wiki.scope.${scopeKey}Desc`, { defaultValue: t('wiki.scope.personalDesc') })
    }
  }, [t])

  /* 加载列表 */
  useEffect(() => {
    const scope = currentScope === 'all' ? null : currentScope
    getItems(scope)
  }, [currentScope, getItems])

  /* 按关键字过滤（标题与描述） */
  const filteredItems = items.filter(item => {
    if (!searchText) return true
    const s = searchText.toLowerCase()
    return item.title?.toLowerCase().includes(s) || item.description?.toLowerCase().includes(s)
  })

  /* 判断当前打开的是否为 RAG 知识库 */
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
    } catch (error) {
      console.error('[Wiki] 创建知识库失败:', error)
    }
  }

  /* ========== 打开编辑抽屉 ========== */
  const handleOpenEdit = async (item) => {
    try {
      const detail = await getItem(item.id)
      const versionList = await getVersions(item.id)
      setEditDrawerVisible(true)
      setShowContentPreview(false)
      getIndexStatus(item.id)
      /* RAG知识库自动加载 chunks 预览 */
      if (detail.source_type === 'file') {
        getChunks(item.id)
      }
      if (versionList && versionList.length > 0) {
        const currentVer = versionList.find(v => v.version_number === detail.current_version)
        await switchToVersion(currentVer ? currentVer.id : versionList[0].id)
      }
    } catch (error) {
      console.error('[Wiki] 获取知识库详情失败:', error)
    }
  }

  /* 版本数据同步到编辑表单 */
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

  /* ========== 文本知识库操作 ========== */
  const handleSave = async () => {
    if (!currentVersion) return
    try {
      const values = await editForm.validateFields()
      await saveVersion(currentVersion.id, {
        title: values.title,
        description: values.description,
        content: values.content,
        notes: values.notes,
        links: values.links
      })
    } catch (error) {
      console.error('[Wiki] 保存版本失败:', error)
    }
  }

  const handleCreateVersion = async () => {
    if (!currentItem || !currentVersion) return
    try {
      await createVersion(currentItem.id, currentVersion.id)
    } catch (error) {
      console.error('[Wiki] 创建新版本失败:', error)
    }
  }

  const handleDeleteVersion = async () => {
    if (!currentItem || !currentVersion) return
    try {
      await deleteVersion(currentItem.id, currentVersion.id)
    } catch (error) {
      console.error('[Wiki] 删除版本失败:', error)
    }
  }

  const handleSwitchVersion = async (versionId) => {
    try {
      await switchToVersion(versionId)
    } catch (error) {
      console.error('[Wiki] 切换版本失败:', error)
    }
  }

  const handleCloseEdit = () => {
    setEditDrawerVisible(false)
    clearCurrentItem()
    editForm.resetFields()
    setContentLength(0)
    setShowContentPreview(false)
  }

  /** 删除知识库（二次确认，强调不可恢复） */
  const handleDeleteWiki = (id, title) => {
    Modal.confirm({
      title: t('wiki.deleteWiki.title'),
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>{t('wiki.deleteWiki.willDelete')} <Text strong>「{title}」</Text></p>
          <p style={{ color: '#ff4d4f', fontSize: 13 }}>{t('wiki.deleteWiki.warning')}</p>
        </div>
      ),
      okText: t('wiki.deleteWiki.okText'),
      okButtonProps: { danger: true },
      cancelText: t('wiki.actions.cancel'),
      onOk: async () => {
        await deleteItem(id)
        if (editDrawerVisible && currentItem?.id === id) handleCloseEdit()
      }
    })
  }

  /** 清空内容 */
  const handleClearContent = () => {
    editForm.setFieldsValue({ content: '' })
    setContentLength(0)
    message.success(t('wiki.messages.contentCleared'))
  }

  /** 复制内容到剪贴板（含降级方案） */
  const handleCopyContent = async () => {
    const content = editForm.getFieldValue('content')
    if (!content) {
      message.warning(t('wiki.messages.contentEmpty'))
      return
    }
    try {
      await navigator.clipboard.writeText(content)
      message.success(t('wiki.messages.copied'))
    } catch {
      /* 非 HTTPS 或旧浏览器下 clipboard API 不可用，降级为 execCommand */
      const ta = document.createElement('textarea')
      ta.value = content
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      message.success(t('wiki.messages.copied'))
    }
  }

  const handleContentChange = (e) => setContentLength(e.target.value?.length || 0)

  /* ========== RAG 操作 ========== */
  /**
   * 多文件上传：Upload 组件会对每个文件分别调用 beforeUpload，
   * 这里先收集到 ref，再用定时器延迟统一提交，避免发起多次请求
   */
  const pendingFiles = React.useRef([])
  const uploadTimer = React.useRef(null)

  const handleFileUpload = (file) => {
    if (!currentItem) return false
    pendingFiles.current.push(file)
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
      } catch (error) {
        /* 错误提示由 store 层统一处理 */
      }
    }, UPLOAD_COLLECT_DELAY_MS)
    /* 返回 false 阻止 antd 自动上传，改由本方法手动提交 */
    return false
  }

  const handleBuildIndex = async () => {
    if (!currentItem) return
    try {
      await buildIndex(currentItem.id)
    } catch (error) {
      /* 错误提示由 store 层统一处理 */
    }
  }

  /* ========== 版本下拉菜单 ========== */
  const versionMenuItems = versions.map(v => ({
    key: v.id,
    label: (
      <div className="wiki-version-menu-item" onClick={() => handleSwitchVersion(v.id)}>
        <span className="wiki-version-num">v{v.version_number}</span>
        <span className="wiki-version-user">{v.created_by_name}</span>
        <span className="wiki-version-time">{dayjs(v.created_at).format('MM-DD HH:mm')}</span>
        {currentVersion?.version_number === v.version_number && (
          <Tag color="blue">{t('wiki.version.current')}</Tag>
        )}
      </div>
    )
  }))

  /* ========== 卡片操作菜单 ========== */
  const getCardMenuItems = (item) => {
    const mi = [{ key: 'view', icon: <EyeOutlined />, label: t('wiki.actions.view') }]
    if (item.can_edit) {
      mi.push({
        key: 'pin',
        icon: item.is_pinned ? <PushpinFilled /> : <PushpinOutlined />,
        label: item.is_pinned ? t('wiki.actions.unpin') : t('wiki.actions.pin')
      })
    }
    if (item.creator_id === user?.id || user?.role === 'super_admin') {
      mi.push(
        { type: 'divider' },
        { key: 'delete', icon: <DeleteOutlined />, label: t('wiki.actions.delete'), danger: true }
      )
    }
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
          <div className="wiki-content-label">
            <span>{t('wiki.form.content')}</span>
            <span className="wiki-content-hint">
              {t('wiki.form.contentHint', { max: MAX_CONTENT_LENGTH.toLocaleString() })}
            </span>
          </div>
          {currentVersion?.can_edit && (
            <div className="wiki-content-toolbar">
              <Tooltip title={t('wiki.actions.clearContent')}>
                <Button type="text" icon={<ClearOutlined />} onClick={handleClearContent} size="small" />
              </Tooltip>
              <Tooltip title={t('wiki.actions.copyContent')}>
                <Button type="text" icon={<CopyOutlined />} onClick={handleCopyContent} size="small" />
              </Tooltip>
              <span className="wiki-content-count">
                {contentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      }>
        <TextArea
          placeholder={t('wiki.form.contentPlaceholder')}
          rows={12}
          maxLength={MAX_CONTENT_LENGTH}
          disabled={!currentVersion.can_edit}
          className="wiki-content-textarea"
          onChange={handleContentChange}
        />
      </Form.Item>

      {/* 备注列表 */}
      <Form.Item label={
        <span>
          {t('wiki.form.notes')}{' '}
          <Text type="secondary" style={{ fontWeight: 400 }}>
            {t('wiki.form.notesHint', { max: MAX_LIST_ITEMS })}
          </Text>
        </span>
      }>
        <Form.List name="notes">
          {(fields, { add, remove }) => (
            <div className="wiki-list-container">
              {fields.map((field, index) => (
                <div key={field.key} className="wiki-list-item">
                  <span className="wiki-list-index">{index + 1}</span>
                  <Form.Item {...field} noStyle>
                    <Input
                      placeholder={t('wiki.form.notePlaceholder')}
                      maxLength={500}
                      disabled={!currentVersion.can_edit}
                    />
                  </Form.Item>
                  {currentVersion.can_edit && (
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
              {currentVersion.can_edit && fields.length < MAX_LIST_ITEMS && (
                <Button
                  type="dashed"
                  onClick={() => add('')}
                  icon={<PlusOutlined />}
                  className="wiki-list-add"
                >
                  {t('wiki.form.addNote')}
                </Button>
              )}
            </div>
          )}
        </Form.List>
      </Form.Item>

      {/* 相关链接列表 */}
      <Form.Item label={
        <span>
          {t('wiki.form.links')}{' '}
          <Text type="secondary" style={{ fontWeight: 400 }}>
            {t('wiki.form.linksHint', { max: MAX_LIST_ITEMS })}
          </Text>
        </span>
      }>
        <Form.List name="links">
          {(fields, { add, remove }) => (
            <div className="wiki-list-container">
              {fields.map((field, index) => (
                <div key={field.key} className="wiki-link-item">
                  <span className="wiki-list-index">{index + 1}</span>
                  <Form.Item name={[field.name, 'title']} noStyle>
                    <Input
                      placeholder={t('wiki.form.linkTitle')}
                      style={{ width: 140 }}
                      maxLength={200}
                      disabled={!currentVersion.can_edit}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'url']} noStyle>
                    <Input
                      placeholder={t('wiki.form.linkUrl')}
                      prefix={<LinkOutlined style={{ color: '#bbb' }} />}
                      style={{ flex: 1 }}
                      maxLength={1000}
                      disabled={!currentVersion.can_edit}
                    />
                  </Form.Item>
                  {currentVersion.can_edit && (
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
              {currentVersion.can_edit && fields.length < MAX_LIST_ITEMS && (
                <Button
                  type="dashed"
                  onClick={() => add({ title: '', url: '' })}
                  icon={<PlusOutlined />}
                  className="wiki-list-add"
                >
                  {t('wiki.form.addLink')}
                </Button>
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
    /* 索引状态映射：颜色与图标为固定配置，文案走 i18n */
    const statusMap = {
      none: { color: '#d9d9d9', text: t('wiki.rag.statusNone'), icon: <DatabaseOutlined /> },
      processing: { color: '#1890ff', text: t('wiki.rag.statusProcessing'), icon: <LoadingOutlined spin /> },
      completed: { color: '#52c41a', text: t('wiki.rag.statusCompleted'), icon: <CheckCircleOutlined /> },
      failed: { color: '#ff4d4f', text: t('wiki.rag.statusFailed'), icon: <ExclamationCircleOutlined /> }
    }
    const s = statusMap[is.index_status] || statusMap.none
    const chunkData = chunks || {}

    return (
      <>
        {/* 文件上传区 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <CloudUploadOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <Text strong style={{ fontSize: 15 }}>{t('wiki.rag.docSection')}</Text>
          </div>
          {is.file_name && (
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label={t('wiki.rag.currentFile')}>
                <Space>
                  <FileTextOutlined style={{ color: '#722ed1' }} />
                  <Text strong>{is.file_name}</Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('wiki.rag.fileSize')}>
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
                <div style={{ padding: '16px 0' }}>
                  <LoadingOutlined style={{ fontSize: 28, color: '#722ed1' }} />
                  <p style={{ marginTop: 8, color: '#8c8c8c' }}>{t('wiki.rag.parsing')}</p>
                </div>
              ) : (
                <div style={{ padding: '16px 0' }}>
                  <UploadOutlined style={{ fontSize: 28, color: '#8c8c8c' }} />
                  <p style={{ marginTop: 8, color: '#8c8c8c', fontSize: 13 }}>
                    {is.file_name
                      ? t('wiki.rag.uploadAppendHint', { max: MAX_UPLOAD_FILES })
                      : t('wiki.rag.uploadHint', { max: MAX_UPLOAD_FILES })}
                  </p>
                </div>
              )}
            </Upload.Dragger>
          )}
        </div>

        {/* 索引状态面板 */}
        <div style={{
          background: '#fafafa', borderRadius: 12, padding: '16px 20px',
          border: '1px solid #f0f0f0', marginBottom: 20
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 12
          }}>
            <Space size="middle">
              <ThunderboltOutlined style={{ color: '#722ed1', fontSize: 16 }} />
              <Text strong style={{ fontSize: 15 }}>{t('wiki.rag.indexSection')}</Text>
              <Tag color={s.color} icon={s.icon} style={{ borderRadius: 6 }}>{s.text}</Tag>
            </Space>
            {currentVersion?.can_edit && (
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={indexing}
                onClick={handleBuildIndex}
                style={{ borderRadius: 8, background: '#722ed1', borderColor: '#722ed1' }}
                disabled={!is.file_name && !currentItem?.content}
              >
                {is.index_status === 'completed'
                  ? t('wiki.rag.rebuildIndex')
                  : t('wiki.rag.buildIndex')}
              </Button>
            )}
          </div>

          {indexing && (
            <Progress
              percent={99}
              status="active"
              size="small"
              showInfo={false}
              style={{ marginBottom: 12 }}
            />
          )}

          {is.index_status === 'completed' && (
            <Descriptions size="small" column={3} style={{ marginTop: 8 }}>
              <Descriptions.Item label={<><NumberOutlined /> {t('wiki.rag.chunkCount')}</>}>
                <Text strong style={{ color: '#722ed1' }}>
                  {chunkData.total_chunks || is.chunk_count || 0}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label={<><DatabaseOutlined /> {t('wiki.rag.totalTokens')}</>}>
                <Text strong style={{ color: '#1890ff' }}>
                  {chunkData.total_tokens
                    ? (chunkData.total_tokens > 1000
                      ? `${(chunkData.total_tokens / 1000).toFixed(1)}K`
                      : chunkData.total_tokens)
                    : '-'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label={<><ClockCircleOutlined /> {t('wiki.rag.indexedAt')}</>}>
                {is.indexed_at ? dayjs(is.indexed_at).format('MM-DD HH:mm') : '-'}
              </Descriptions.Item>
              <Descriptions.Item
                label={<><ApiOutlined /> {t('wiki.rag.embeddingModel')}</>}
                span={3}
              >
                <Tag color="purple" style={{ borderRadius: 4 }}>
                  {chunkData.chunks?.[0]?.embedding_model || '-'}
                </Tag>
                {chunkData.chunks?.[0]?.has_embedding && (
                  <Tag color="success" style={{ borderRadius: 4 }}>
                    <CheckCircleOutlined /> {t('wiki.rag.vectorReady')}
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
              <Text strong style={{ fontSize: 15 }}>{t('wiki.rag.chunkPreview')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('wiki.rag.chunkTotal', { count: chunkData.total_chunks || 0 })}
              </Text>
            </div>
            {chunksLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            ) : chunkData.chunks && chunkData.chunks.length > 0 ? (
              <Collapse
                size="small"
                ghost
                items={chunkData.chunks.map((chunk, idx) => ({
                  key: idx,
                  label: (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', width: '100%'
                    }}>
                      <Space>
                        <Tag color="blue" style={{ borderRadius: 4, minWidth: 50, textAlign: 'center' }}>
                          #{chunk.chunk_index}
                        </Tag>
                        <Text ellipsis style={{ maxWidth: 350, fontSize: 13 }}>
                          {chunk.content_preview}
                        </Text>
                      </Space>
                      <Space size={4}>
                        <Tag style={{ fontSize: 11 }}>
                          {t('wiki.rag.tokens', { count: chunk.token_count })}
                        </Tag>
                        {chunk.has_embedding && (
                          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                        )}
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
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('wiki.rag.chunkEmpty')}
              />
            )}
          </div>
        )}

        {/* 解析文本只读预览（可折叠） */}
        {currentVersion?.content && (
          <div style={{ marginBottom: 20 }}>
            <Button
              type="link"
              size="small"
              onClick={() => setShowContentPreview(!showContentPreview)}
              icon={showContentPreview ? <DownOutlined /> : <EyeOutlined />}
              style={{ padding: 0, marginBottom: 8 }}
            >
              {showContentPreview
                ? t('wiki.rag.hideParsedText')
                : t('wiki.rag.showParsedText')}
            </Button>
            {showContentPreview && (
              <div style={{
                background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8,
                padding: 16, maxHeight: 300, overflow: 'auto'
              }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopyContent}>
                    {t('wiki.actions.copyText')}
                  </Button>
                </div>
                <pre style={{
                  fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all', margin: 0
                }}>
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
      {/* 头部：标题 + 搜索 + 新建 */}
      <div className="wiki-header-section">
        <div className="wiki-header-content">
          <div className="wiki-header-left">
            <div className="wiki-header-icon-wrapper">
              <BookOutlined className="wiki-header-icon" />
            </div>
            <div className="wiki-header-text">
              <h1 className="wiki-header-title">{t('wiki.title')}</h1>
              <p className="wiki-header-subtitle">{t('wiki.subtitle')}</p>
            </div>
          </div>
          <div className="wiki-header-right">
            <Input
              placeholder={t('wiki.searchPlaceholder')}
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
              {t('wiki.actions.create')}
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
            { label: t('wiki.scope.all'), value: 'all' },
            { label: <span><UserOutlined /> {t('wiki.scope.personal')}</span>, value: 'personal' },
            { label: <span><TeamOutlined /> {t('wiki.scope.team')}</span>, value: 'team' },
            { label: <span><GlobalOutlined /> {t('wiki.scope.global')}</span>, value: 'global' }
          ]}
        />
        <div className="wiki-count">
          {t('wiki.count', { count: filteredItems.length })}
        </div>
      </div>

      {/* 卡片列表 */}
      <div className="wiki-content-section">
        {loading ? (
          <div className="wiki-loading"><Spin size="large" /><p>{t('wiki.loading')}</p></div>
        ) : filteredItems.length === 0 ? (
          <div className="wiki-empty">
            <Empty description={t('wiki.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateModalVisible(true)}
              >
                {t('wiki.actions.createFirst')}
              </Button>
            </Empty>
          </div>
        ) : (
          <Row gutter={[16, 16]} className="wiki-grid">
            {filteredItems.map(item => {
              const sc = getScopeInfo(item.scope)
              const isRAG = item.source_type === 'file'
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.id}>
                  <Card
                    className={`wiki-card ${item.is_pinned ? 'wiki-card-pinned' : ''}`}
                    hoverable
                    onClick={() => handleOpenEdit(item)}
                  >
                    {item.is_pinned && (
                      <div className="wiki-card-pin-badge"><PushpinFilled /></div>
                    )}
                    <div
                      className="wiki-card-scope-badge"
                      style={{ backgroundColor: isRAG ? '#722ed1' : sc.color }}
                    >
                      {isRAG ? (
                        <><ThunderboltOutlined /><span>{t('wiki.card.ragTag')}</span></>
                      ) : (
                        <>{sc.icon}<span>{sc.label}</span></>
                      )}
                    </div>
                    <div className="wiki-card-body">
                      <div className="wiki-card-header">
                        <Text strong ellipsis className="wiki-card-title">{item.title}</Text>
                        <Dropdown
                          menu={{
                            items: getCardMenuItems(item),
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation()
                              handleCardMenuClick(key, item)
                            }
                          }}
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
                      <Paragraph ellipsis={{ rows: 2 }} className="wiki-card-description">
                        {item.description || t('wiki.noDescription')}
                      </Paragraph>
                      <div className="wiki-card-footer">
                        <div className="wiki-card-meta">
                          <UserOutlined />
                          <span>{item.creator_name || t('wiki.unknownUser')}</span>
                          <span className="wiki-card-meta-dot">·</span>
                          <FileTextOutlined /><span>v{item.current_version}</span>
                          {isRAG && item.index_status === 'completed' && (
                            <>
                              <span className="wiki-card-meta-dot">·</span>
                              <Tag color="purple" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                                <ThunderboltOutlined />{' '}
                                {t('wiki.card.chunkCount', { count: item.chunk_count || 0 })}
                              </Tag>
                            </>
                          )}
                        </div>
                        <Text type="secondary" className="wiki-card-time">
                          {dayjs(item.updated_at).fromNow()}
                        </Text>
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
        title={
          <div className="wiki-modal-title">
            <PlusOutlined /><span>{t('wiki.createModal.title')}</span>
          </div>
        }
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false)
          createForm.resetFields()
          setCreateType('text')
        }}
        okText={t('wiki.actions.createOk')}
        cancelText={t('wiki.actions.cancel')}
        width={520}
        className="wiki-modal"
      >
        <Form form={createForm} layout="vertical" className="wiki-form">
          {/* 知识库类型选择 */}
          <Form.Item label={t('wiki.type.label')}>
            <Segmented
              block
              value={createType}
              onChange={setCreateType}
              options={[
                { label: typeOptions.text.label, value: 'text' },
                { label: typeOptions.file.label, value: 'file' }
              ]}
              style={{ marginBottom: 4 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {typeOptions[createType].desc}
            </Text>
          </Form.Item>

          <Form.Item
            name="title"
            label={t('wiki.form.title')}
            rules={[{ required: true, message: t('wiki.form.titleRequired') }]}
          >
            <Input placeholder={t('wiki.form.titlePlaceholder')} maxLength={500} showCount />
          </Form.Item>

          <Form.Item name="scope" label={t('wiki.form.scope')} initialValue="personal">
            <Select>
              {Object.keys(SCOPE_CONFIG).map((key) => {
                /* 团队范围仅管理员及以上可选，全局范围仅超级管理员可选 */
                if (key === 'team' && user?.role !== 'admin' && user?.role !== 'super_admin') return null
                if (key === 'global' && user?.role !== 'super_admin') return null
                const cfg = getScopeInfo(key)
                return (
                  <Select.Option value={key} key={key}>
                    <Space>
                      {React.cloneElement(cfg.icon, { style: { color: cfg.color } })}
                      <span>{cfg.label}</span>
                      <Text type="secondary">- {cfg.desc}</Text>
                    </Space>
                  </Select.Option>
                )
              })}
            </Select>
          </Form.Item>

          <Form.Item name="description" label={t('wiki.form.description')}>
            <TextArea
              placeholder={t('wiki.form.descriptionPlaceholder')}
              rows={3}
              maxLength={2000}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== 编辑抽屉 ===== */}
      <Drawer
        placement="right"
        width={720}
        open={editDrawerVisible}
        onClose={handleCloseEdit}
        className="wiki-edit-drawer"
        closable={false}
      >
        {detailLoading ? (
          <div className="wiki-drawer-loading"><Spin size="large" /></div>
        ) : currentItem && currentVersion ? (
          <div className="wiki-edit-container">
            {/* 抽屉头部 */}
            <div className="wiki-edit-header">
              <div className="wiki-edit-header-top">
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={handleCloseEdit}
                  className="wiki-close-btn"
                />
                <div className="wiki-edit-actions">
                  {/* 版本操作仅文本知识库可用 */}
                  {currentVersion.can_edit && !isRAGMode() && (
                    <>
                      <Button icon={<BranchesOutlined />} onClick={handleCreateVersion}>
                        {t('wiki.actions.newVersion')}
                      </Button>
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSave}
                        loading={loading}
                      >
                        {t('wiki.actions.save')}
                      </Button>
                      <Popconfirm
                        title={t('wiki.version.deleteConfirmTitle')}
                        description={
                          versions.length <= 1
                            ? t('wiki.version.deleteConfirmOnly')
                            : t('wiki.version.deleteConfirmDesc', {
                              version: currentVersion.version_number
                            })
                        }
                        onConfirm={handleDeleteVersion}
                        okText={t('wiki.actions.confirm')}
                        cancelText={t('wiki.actions.cancel')}
                        disabled={versions.length <= 1}
                      >
                        <Button danger icon={<DeleteOutlined />} disabled={versions.length <= 1}>
                          {t('wiki.actions.deleteVersion')}
                        </Button>
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
                      <ThunderboltOutlined /> {t('wiki.editDrawer.ragTag')}
                    </Tag>
                  )}
                  <Tag
                    className="wiki-scope-tag"
                    style={{
                      backgroundColor: `${getScopeInfo(currentItem.scope).color}15`,
                      color: getScopeInfo(currentItem.scope).color,
                      borderColor: getScopeInfo(currentItem.scope).color
                    }}
                  >
                    {getScopeInfo(currentItem.scope).icon}
                    <span>{getScopeInfo(currentItem.scope).label}</span>
                  </Tag>
                </Space>
              </div>

              <div className="wiki-edit-meta-row">
                <div className="wiki-meta-info">
                  <span><UserOutlined /> {currentVersion.created_by_name}</span>
                  <span className="wiki-meta-dot">•</span>
                  <span>
                    <ClockCircleOutlined />{' '}
                    {dayjs(currentVersion.created_at).format('YYYY-MM-DD HH:mm')}
                  </span>
                </div>
                {/* 版本切换下拉仅文本知识库显示 */}
                {!isRAGMode() && (
                  <Dropdown
                    menu={{ items: versionMenuItems }}
                    trigger={['click']}
                    placement="bottomRight"
                    overlayClassName="wiki-version-dropdown"
                  >
                    <Button className="wiki-version-btn">
                      <HistoryOutlined />
                      <span>v{currentVersion.version_number}</span>
                      <span className="wiki-version-total">
                        {t('wiki.editDrawer.versionTotal', { count: versions.length })}
                      </span>
                      <DownOutlined />
                    </Button>
                  </Dropdown>
                )}
              </div>
            </div>

            {/* 编辑主体 - 根据知识库类型切换 */}
            <div className="wiki-edit-body">
              <Form form={editForm} layout="vertical" className="wiki-form">
                {isRAGMode() ? (
                  <>
                    {/* RAG知识库：仅标题与描述可编辑，内容由文档解析得到 */}
                    <Form.Item
                      name="title"
                      label={t('wiki.form.title')}
                      rules={[{ required: true, message: t('wiki.form.titleRequired') }]}
                    >
                      <Input
                        placeholder={t('wiki.form.titleEditPlaceholder')}
                        maxLength={500}
                        disabled={!currentVersion.can_edit}
                      />
                    </Form.Item>
                    <Form.Item name="description" label={t('wiki.form.description')}>
                      <TextArea
                        placeholder={t('wiki.form.descriptionEditPlaceholder')}
                        rows={2}
                        maxLength={2000}
                        disabled={!currentVersion.can_edit}
                      />
                    </Form.Item>
                    {/* RAG编辑区：文件管理 + 向量索引 + chunks预览 */}
                    {renderRAGEditor()}
                    {currentVersion.can_edit && (
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSave}
                        loading={loading}
                        style={{ marginBottom: 20 }}
                      >
                        {t('wiki.actions.saveTitleDesc')}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Form.Item
                      name="title"
                      label={t('wiki.form.title')}
                      rules={[{ required: true, message: t('wiki.form.titleRequired') }]}
                    >
                      <Input
                        placeholder={t('wiki.form.titleEditPlaceholder')}
                        maxLength={500}
                        disabled={!currentVersion.can_edit}
                      />
                    </Form.Item>
                    <Form.Item name="description" label={t('wiki.form.description')}>
                      <TextArea
                        placeholder={t('wiki.form.descriptionEditPlaceholder')}
                        rows={2}
                        maxLength={2000}
                        disabled={!currentVersion.can_edit}
                      />
                    </Form.Item>
                    {renderTextEditor()}
                  </>
                )}
              </Form>

              {/* 危险区域：仅创建者与超级管理员可见 */}
              {(currentItem.creator_id === user?.id || user?.role === 'super_admin') && (
                <div className="wiki-danger-zone">
                  <Divider className="wiki-danger-divider" />
                  <div className="wiki-danger-zone-content">
                    <div className="wiki-danger-zone-info">
                      <div className="wiki-danger-zone-title">
                        <WarningOutlined /> {t('wiki.danger.title')}
                      </div>
                      <div className="wiki-danger-zone-desc">{t('wiki.danger.desc')}</div>
                    </div>
                    <Button
                      danger
                      type="primary"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteWiki(currentItem.id, currentItem.title)}
                    >
                      {t('wiki.danger.button')}
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
