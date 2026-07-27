/**
 * 思维导图页面
 *
 * v2.1 (i18n全量改造):
 *   - 引入 useTranslation，全部界面文案走 t()（此前整页硬编码中文）
 *   - typeTabs / getTypeTag / 导出菜单 / 保存菜单移入组件内用 t() 实时构造
 *   - formatTime 改用 time.justNow / minutesAgo / hoursAgo / daysAgo
 *   - 功能逻辑零变更：markmap/mermaid/svg 渲染、项目式持久化、分享、积分计费均原样保留
 *
 * v2.0: 项目式持久化（保存/列表/重命名/删除/另存为/永久分享链接）
 * 支持三种模式: Markdown(markmap) / Mermaid / SVG
 * 导出: SVG / PNG / PDF / 源代码，按次积分计费
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Button, Input, Tabs, Space, message, Modal, Dropdown, Tooltip,
  Drawer, List, Tag, Popconfirm, Spin, Empty
} from 'antd'
import {
  SaveOutlined, ExportOutlined, ShareAltOutlined, FolderOpenOutlined,
  PlusOutlined, DeleteOutlined, EditOutlined, CopyOutlined,
  ZoomInOutlined, ZoomOutOutlined, ExpandOutlined, NodeExpandOutlined,
  DollarOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined,
  Html5Outlined, DownOutlined, LinkOutlined, CheckCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Markmap } from 'markmap-view'
import { Transformer } from 'markmap-lib'
import mermaid from 'mermaid'
import apiClient from '../../utils/api'
import useAuthStore from '../../stores/authStore'
import './Mindmap.less'

const transformer = new Transformer()

// 默认示例内容（代码示例数据，保留原文不做i18n）
const DEFAULT_MARKDOWN = `# 中心主题\n\n## 分支一\n- 要点 1\n- 要点 2\n\n## 分支二\n- 要点 A\n- 要点 B\n`
const DEFAULT_MERMAID = `graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n  C --> D\n`
const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">\n  <rect x="50" y="50" width="300" height="100" rx="12" fill="#e6f4ff" stroke="#1677ff"/>\n  <text x="200" y="105" text-anchor="middle" font-size="20" fill="#1677ff">SVG</text>\n</svg>`

const DEFAULT_CONTENT = {
  markdown: DEFAULT_MARKDOWN,
  mermaid: DEFAULT_MERMAID,
  svg: DEFAULT_SVG
}

const Mindmap = () => {
  const { t } = useTranslation()
  const { user, getCurrentUser } = useAuthStore()

  // ============ 状态 ============
  const [mode, setMode] = useState('markdown')          // markdown | mermaid | svg
  const [content, setContent] = useState(DEFAULT_MARKDOWN)
  const [title, setTitle] = useState('')
  const [currentId, setCurrentId] = useState(null)      // 当前打开的导图ID（null=未保存）
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [credits, setCredits] = useState(0)
  const [creditsConfig, setCreditsConfig] = useState({ save: 0, export_svg: 0, export_png: 0, export_pdf: 0 })
  const [listVisible, setListVisible] = useState(false)
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [shareVisible, setShareVisible] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [renameVisible, setRenameVisible] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState(null)

  const previewRef = useRef(null)
  const markmapRef = useRef(null)
  const svgRef = useRef(null)
  const contentRef = useRef(content)
  useEffect(() => { contentRef.current = content }, [content])

  // ============ 类型Tab（组件内构造，label走i18n） ============
  const typeTabs = [
    { key: 'markdown', label: t('mindmap.mode.markdown') },
    { key: 'mermaid', label: t('mindmap.mode.mermaid') },
    { key: 'svg', label: t('mindmap.mode.svg') }
  ]

  // ============ 初始化 ============
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
    fetchCreditsConfig()
    refreshCredits()
  }, [])

  const fetchCreditsConfig = async () => {
    try {
      const res = await apiClient.get('/mindmap/credits-config')
      if (res.data.success) setCreditsConfig(res.data.data)
    } catch (e) { /* 使用默认值0 */ }
  }

  const refreshCredits = async () => {
    try {
      await getCurrentUser()
      const u = useAuthStore.getState().user
      if (u?.credits_stats?.remaining !== undefined) setCredits(Math.max(0, u.credits_stats.remaining))
      else if (u?.credits_quota !== undefined) setCredits(Math.max(0, (u.credits_quota || 0) - (u.used_credits || 0)))
    } catch (e) { /* 静默 */ }
  }

  const canAfford = (cost) => {
    if (cost > 0 && credits < cost) {
      message.error(t('mindmap.credits.insufficientNeed', { credits: cost }))
      return false
    }
    return true
  }

  // ============ 渲染 ============
  const renderPreview = useCallback(async () => {
    const el = previewRef.current
    if (!el) return
    const value = contentRef.current
    try {
      if (mode === 'markdown') {
        el.innerHTML = '<svg style="width:100%;height:100%" class="markmap-svg"></svg>'
        const svg = el.querySelector('svg')
        const { root } = transformer.transform(value || '')
        markmapRef.current = Markmap.create(svg, { autoFit: true }, root)
        svgRef.current = svg
      } else if (mode === 'mermaid') {
        const { svg } = await mermaid.render(`mermaid-${Date.now()}`, value || 'graph TD\n  A')
        el.innerHTML = svg
        svgRef.current = el.querySelector('svg')
        markmapRef.current = null
      } else {
        el.innerHTML = value || ''
        svgRef.current = el.querySelector('svg')
        markmapRef.current = null
      }
    } catch (e) {
      el.innerHTML = `<div style="color:#ff4d4f;padding:20px;">${t('mindmap.message.renderError')}</div>`
      svgRef.current = null
      markmapRef.current = null
    }
  }, [mode, t])

  useEffect(() => {
    const timer = setTimeout(renderPreview, 400)
    return () => clearTimeout(timer)
  }, [content, mode, renderPreview])

  // 切换模式：内容为空或等于其它模式默认值时填充该模式默认内容
  const handleModeChange = (key) => {
    setMode(key)
    const isDefault = Object.values(DEFAULT_CONTENT).includes(contentRef.current) || !contentRef.current.trim()
    if (isDefault) setContent(DEFAULT_CONTENT[key])
  }

  // ============ 缩放控制（仅markmap） ============
  const handleZoomIn = () => markmapRef.current?.rescale(1.25)
  const handleZoomOut = () => markmapRef.current?.rescale(0.8)
  const handleFit = () => markmapRef.current?.fit()
  const handleExpandAll = () => {
    if (markmapRef.current) {
      markmapRef.current.setData(markmapRef.current.state.data)
      markmapRef.current.fit()
    }
  }

  // ============ 保存 / 另存为 ============
  const validateBeforeSave = () => {
    if (!title.trim()) { message.warning(t('mindmap.pleaseInputTitle')); return false }
    if (!content.trim()) { message.warning(t('mindmap.pleaseInputContent')); return false }
    return true
  }

  const handleSave = async () => {
    if (!validateBeforeSave()) return
    if (!canAfford(creditsConfig.save)) return
    setSaving(true)
    try {
      if (currentId) {
        await apiClient.put(`/mindmap/${currentId}`, { title: title.trim(), map_type: mode, content })
      } else {
        const res = await apiClient.post('/mindmap', { title: title.trim(), map_type: mode, content })
        if (res.data.success) setCurrentId(res.data.data.id)
      }
      message.success(t('mindmap.message.saveSuccess'))
      refreshCredits()
    } catch (e) {
      message.error(e.response?.data?.message || t('mindmap.message.saveFailed'))
    } finally { setSaving(false) }
  }

  const handleSaveAs = async () => {
    if (!validateBeforeSave()) return
    if (!canAfford(creditsConfig.save)) return
    setSaving(true)
    try {
      const newTitle = `${title.trim()}${t('mindmap.saveAsCopySuffix')}`
      const res = await apiClient.post('/mindmap', { title: newTitle, map_type: mode, content })
      if (res.data.success) {
        setCurrentId(res.data.data.id)
        setTitle(newTitle)
        message.success(t('mindmap.saveAsSuccess'))
        refreshCredits()
      }
    } catch (e) {
      message.error(e.response?.data?.message || t('mindmap.saveAsFailed'))
    } finally { setSaving(false) }
  }

  // 保存下拉菜单（组件内构造，label走i18n）
  const saveMenuItems = [
    { key: 'saveAs', icon: <CopyOutlined />, label: t('mindmap.saveAs'), onClick: handleSaveAs }
  ]

  // ============ 新建 ============
  const handleNew = () => {
    Modal.confirm({
      title: t('mindmap.newConfirmTitle'),
      content: t('mindmap.newConfirmContent'),
      okText: t('mindmap.newConfirmOk'),
      cancelText: t('common.cancel'),
      onOk: () => {
        setCurrentId(null)
        setTitle('')
        setContent(DEFAULT_CONTENT[mode])
      }
    })
  }

  // ============ 列表 / 打开 / 删除 / 重命名 ============
  const fetchList = async () => {
    setListLoading(true)
    try {
      const res = await apiClient.get('/mindmap')
      if (res.data.success) setList(res.data.data || [])
    } catch (e) {
      message.error(t('mindmap.listLoadFailed'))
    } finally { setListLoading(false) }
  }

  const handleOpenList = () => { setListVisible(true); fetchList() }

  const handleOpenItem = async (item) => {
    try {
      const res = await apiClient.get(`/mindmap/${item.id}`)
      if (res.data.success) {
        const d = res.data.data
        setCurrentId(d.id)
        setTitle(d.title)
        setMode(d.map_type)
        setContent(d.content)
        setListVisible(false)
        message.success(t('mindmap.opened', { title: d.title }))
      }
    } catch (e) { message.error(t('mindmap.openFailed')) }
  }

  const handleDeleteItem = async (item) => {
    try {
      await apiClient.delete(`/mindmap/${item.id}`)
      message.success(t('common.deleteSuccess'))
      if (item.id === currentId) { setCurrentId(null) }
      fetchList()
    } catch (e) { message.error(t('common.deleteFailed')) }
  }

  const openRename = (item) => {
    setRenameTarget(item)
    setRenameValue(item.title)
    setRenameVisible(true)
  }

  const handleRename = async () => {
    const v = renameValue.trim()
    if (!v) { message.warning(t('mindmap.titleRequired')); return }
    if (v.length > 100) { message.warning(t('mindmap.titleTooLong')); return }
    try {
      await apiClient.put(`/mindmap/${renameTarget.id}`, { title: v })
      message.success(t('mindmap.renameSuccess'))
      if (renameTarget.id === currentId) setTitle(v)
      setRenameVisible(false)
      fetchList()
    } catch (e) { message.error(t('mindmap.renameFailed')) }
  }

  // 类型标签（组件内构造，label走i18n）
  const getTypeTag = (mapType) => {
    const map = {
      markdown: { color: 'blue', label: t('mindmap.type.markdown') },
      mermaid: { color: 'purple', label: t('mindmap.type.mermaid') },
      svg: { color: 'green', label: t('mindmap.type.svg') }
    }
    const cfg = map[mapType] || map.markdown
    return <Tag color={cfg.color}>{cfg.label}</Tag>
  }

  // 相对时间（走 time.* i18n key）
  const formatTime = (ts) => {
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('time.justNow')
    if (mins < 60) return t('time.minutesAgo', { count: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('time.hoursAgo', { count: hours })
    return t('time.daysAgo', { count: Math.floor(hours / 24) })
  }

  // ============ 分享 ============
  const handleShare = async () => {
    if (!currentId) { message.warning(t('mindmap.shareSaveFirst')); return }
    try {
      const res = await apiClient.post(`/mindmap/${currentId}/share`)
      if (res.data.success) {
        setShareUrl(`${window.location.origin}${res.data.data.share_path}`)
        setShareVisible(true)
      }
    } catch (e) { message.error(e.response?.data?.message || t('message.error')) }
  }

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(shareUrl)
      .then(() => message.success(t('mindmap.shareLinkCopied')))
      .catch(() => message.error(t('message.copyFailed')))
  }

  // ============ 导出 ============
  const getSvgElement = () => {
    const svg = svgRef.current || previewRef.current?.querySelector('svg')
    if (!svg) { message.error(t('mindmap.svgNotFound')); return null }
    return svg
  }

  const serializeSvg = (svg) => {
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return new XMLSerializer().serializeToString(clone)
  }

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const svgToPngBlob = (svg) => new Promise((resolve, reject) => {
    const svgStr = serializeSvg(svg)
    const img = new Image()
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    img.onload = () => {
      const rect = svg.getBoundingClientRect()
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, rect.width * scale)
      canvas.height = Math.max(1, rect.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('mindmap.pngGenerateFailed'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('mindmap.imageRenderFailed'))) }
    img.src = url
  })

  const chargeExport = async (type) => {
    try {
      await apiClient.post('/mindmap/charge-export', { export_type: type })
      refreshCredits()
      return true
    } catch (e) {
      message.error(e.response?.data?.message || t('mindmap.credits.insufficient'))
      return false
    }
  }

  const handleExport = async (type) => {
    if (!content.trim()) { message.warning(t('mindmap.pleaseCreateContent')); return }
    const costMap = { svg: creditsConfig.export_svg, png: creditsConfig.export_png, pdf: creditsConfig.export_pdf, source: 0 }
    const cost = costMap[type] || 0
    if (!canAfford(cost)) return

    setExporting(true)
    try {
      const filename = (title.trim() || 'mindmap')
      if (type === 'source') {
        const ext = mode === 'markdown' ? 'md' : mode === 'mermaid' ? 'mmd' : 'svg'
        downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${filename}.${ext}`)
      } else {
        const svg = getSvgElement()
        if (!svg) return
        if (cost > 0) { const ok = await chargeExport(type); if (!ok) return }
        if (type === 'svg') {
          downloadBlob(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`)
        } else if (type === 'png') {
          const blob = await svgToPngBlob(svg)
          downloadBlob(blob, `${filename}.png`)
        } else if (type === 'pdf') {
          const { jsPDF } = await import('jspdf')
          const blob = await svgToPngBlob(svg)
          const imgUrl = URL.createObjectURL(blob)
          const img = new Image()
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = imgUrl })
          const landscape = img.width >= img.height
          const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'px', format: [img.width, img.height] })
          pdf.addImage(img, 'PNG', 0, 0, img.width, img.height)
          pdf.save(`${filename}.pdf`)
          URL.revokeObjectURL(imgUrl)
        }
      }
      message.success(t('mindmap.message.exportSuccess'))
    } catch (e) {
      message.error(e.message || t('mindmap.message.exportFailed'))
    } finally { setExporting(false) }
  }

  // 导出菜单（组件内构造，label+积分后缀走i18n）
  const withCredits = (label, cost) => cost > 0 ? `${label} ${t('mindmap.export.creditsSuffix', { credits: cost })}` : label
  const exportMenuItems = [
    { key: 'svg', icon: <Html5Outlined />, label: withCredits(t('mindmap.export.svg'), creditsConfig.export_svg), onClick: () => handleExport('svg') },
    { key: 'png', icon: <FileImageOutlined />, label: withCredits(t('mindmap.export.png'), creditsConfig.export_png), onClick: () => handleExport('png') },
    { key: 'pdf', icon: <FilePdfOutlined />, label: withCredits(t('mindmap.export.pdf'), creditsConfig.export_pdf), onClick: () => handleExport('pdf') },
    { key: 'source', icon: <FileTextOutlined />, label: t('mindmap.export.markdown'), onClick: () => handleExport('source') }
  ]

  // ============ 渲染 ============
  return (
    <div className="mindmap-page">
      {/* 顶部工具栏 */}
      <div className="mindmap-toolbar">
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={handleOpenList}>{t('mindmap.myMindmaps')}</Button>
          <Input
            className="title-input"
            placeholder={t('mindmap.titlePlaceholder')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={100}
            style={{ width: 220 }}
          />
          <Dropdown.Button
            type="primary"
            icon={<DownOutlined />}
            loading={saving}
            onClick={handleSave}
            menu={{ items: saveMenuItems }}
          >
            <SaveOutlined /> {t('mindmap.save')}{creditsConfig.save > 0 ? ` ${t('mindmap.export.creditsSuffix', { credits: creditsConfig.save })}` : ''}
          </Dropdown.Button>
          <Tooltip title={currentId ? t('mindmap.shareTooltip') : t('mindmap.shareTooltipSaveFirst')}>
            <Button icon={<ShareAltOutlined />} onClick={handleShare} disabled={!currentId}>{t('mindmap.share')}</Button>
          </Tooltip>
          <Dropdown menu={{ items: exportMenuItems }} disabled={exporting}>
            <Button icon={<ExportOutlined />} loading={exporting}>{t('mindmap.export')} <DownOutlined /></Button>
          </Dropdown>
        </Space>
        <Tooltip title={t('mindmap.credits.balanceTooltip', { credits })}>
          <Tag color="gold" icon={<DollarOutlined />}>{t('mindmap.credits.balance')}: {credits}</Tag>
        </Tooltip>
      </div>

      {/* 模式Tabs */}
      <Tabs activeKey={mode} onChange={handleModeChange} items={typeTabs} className="mode-tabs" />

      {/* 编辑器 + 预览 */}
      <div className="mindmap-body">
        <div className="editor-panel">
          <div className="panel-header">{t('mindmap.editor.title')}</div>
          <textarea
            className="code-editor"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t('mindmap.editor.placeholder', { type: mode })}
            spellCheck={false}
          />
        </div>
        <div className="preview-panel">
          <div className="panel-header">
            <span>{t('mindmap.preview')}</span>
            {mode === 'markdown' && (
              <Space size={4}>
                <Tooltip title={t('mindmap.zoom.in')}><Button size="small" type="text" icon={<ZoomInOutlined />} onClick={handleZoomIn} /></Tooltip>
                <Tooltip title={t('mindmap.zoom.out')}><Button size="small" type="text" icon={<ZoomOutOutlined />} onClick={handleZoomOut} /></Tooltip>
                <Tooltip title={t('mindmap.zoom.fit')}><Button size="small" type="text" icon={<ExpandOutlined />} onClick={handleFit} /></Tooltip>
                <Tooltip title={t('mindmap.zoom.expandAll')}><Button size="small" type="text" icon={<NodeExpandOutlined />} onClick={handleExpandAll} /></Tooltip>
              </Space>
            )}
          </div>
          <div ref={previewRef} className="preview-content" />
        </div>
      </div>

      {/* 我的导图抽屉 */}
      <Drawer
        title={t('mindmap.myMindmaps')}
        open={listVisible}
        onClose={() => setListVisible(false)}
        width={380}
        extra={<Button size="small" icon={<PlusOutlined />} onClick={() => { setListVisible(false); handleNew() }}>{t('mindmap.new')}</Button>}
      >
        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : list.length === 0 ? (
          <Empty description={t('mindmap.listEmpty')} />
        ) : (
          <List
            dataSource={list}
            renderItem={item => (
              <List.Item
                className="mindmap-list-item"
                actions={[
                  <Tooltip title={t('mindmap.rename')} key="rename">
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); openRename(item) }} />
                  </Tooltip>,
                  <Popconfirm
                    key="del"
                    title={t('mindmap.deleteConfirmTitle')}
                    description={t('mindmap.deleteConfirmDesc')}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                    onConfirm={e => { if (e) e.stopPropagation(); handleDeleteItem(item) }}
                    onCancel={e => { if (e) e.stopPropagation() }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                  </Popconfirm>
                ]}
                onClick={() => handleOpenItem(item)}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      <span>{item.title}</span>
                      {getTypeTag(item.map_type)}
                      {item.id === currentId && <Tag color="processing">{t('mindmap.listCurrent')}</Tag>}
                    </Space>
                  }
                  description={formatTime(item.updated_at || item.created_at)}
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      {/* 分享弹窗 */}
      <Modal
        title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }} />{t('mindmap.shareModalTitle')}</Space>}
        open={shareVisible}
        onCancel={() => setShareVisible(false)}
        footer={[
          <Button key="preview" icon={<LinkOutlined />} onClick={() => window.open(shareUrl, '_blank')}>{t('mindmap.sharePreviewNewTab')}</Button>,
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={handleCopyShareLink}>{t('mindmap.shareCopyLink')}</Button>,
          <Button key="close" onClick={() => setShareVisible(false)}>{t('button.close')}</Button>
        ]}
      >
        <p>{t('mindmap.shareDesc')}</p>
        <Input value={shareUrl} readOnly />
        <ul style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12, paddingLeft: 18 }}>
          <li>{t('mindmap.shareNote1')}</li>
          <li>{t('mindmap.shareNote2')}</li>
          <li>{t('mindmap.shareNote3')}</li>
        </ul>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title={t('mindmap.renameModalTitle')}
        open={renameVisible}
        onOk={handleRename}
        onCancel={() => setRenameVisible(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Input
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          placeholder={t('mindmap.renamePlaceholder')}
          maxLength={100}
          onPressEnter={handleRename}
        />
      </Modal>
    </div>
  )
}

export default Mindmap
