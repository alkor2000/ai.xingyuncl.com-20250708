/**
 * 公文模板库（弹窗）：模板列表 / 上传样板并贴角色 / 套用到我的草稿
 *
 * "样例即模板"：上传一份单位的 Word 样板 → 系统列出段落并猜好角色 → 老师确认（固定/标题/主送/正文/落款/日期…）→ 保存；
 * 之后画布里的 Word 产物或老师自己的草稿（.docx / 粘贴文字）都能套进去，页眉页脚、字体字号、页边距沿用样板。
 */
import React, { useEffect, useState } from 'react'
import { Modal, Tabs, Table, Button, Space, Tag, Popconfirm, Upload, Input, Switch, Typography, Alert, Radio, message, Tooltip } from 'antd'
import { InboxOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, ArrowLeftOutlined, SaveOutlined, FileWordOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useDocTemplateStore from '../../stores/docTemplateStore'
import RoleLabeler from './RoleLabeler'
import ApplyPanel from './ApplyPanel'
import { textToContent } from '../../utils/docTemplate/markdownToBlocks'
import { downloadBlob } from '../../utils/canvas/download'
import './docTemplate.less'

const { Text, Paragraph } = Typography

const DocTemplateManager = ({ open, onClose, initialTab = 'library' }) => {
  const { t, i18n } = useTranslation()
  const { templates, loading, fetchTemplates, uploadTemplate, fetchTemplate, updateTemplate, deleteTemplate, extractDraft, downloadOriginal } = useDocTemplateStore()
  const [tab, setTab] = useState(initialTab)
  const [editing, setEditing] = useState(null) // {template, blocks, roles, name, dirty}
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [draftMode, setDraftMode] = useState('file')
  const [draftText, setDraftText] = useState('')
  const [draftContent, setDraftContent] = useState(null)
  const [parsing, setParsing] = useState(false)

  useEffect(() => { if (open) { setTab(initialTab); setEditing(null); fetchTemplates().catch(() => message.error(t('chat.docTemplate.loadFailed'))) } }, [open, initialTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const openEditor = async (template) => {
    try {
      const data = await fetchTemplate(template.id)
      setEditing({ template: data.template, blocks: data.blocks, roles: data.template.roles, name: data.template.name, description: data.template.description || '', dirty: false })
    } catch (e) { message.error(t('chat.docTemplate.loadFailed')) }
  }
  const saveEditor = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateTemplate(editing.template.id, { roles: editing.roles, name: editing.name.trim() || editing.template.name, description: editing.description })
      message.success(t('chat.docTemplate.saved'))
      setEditing(null); setTab('library')
    } catch (e) { message.error(e.message || t('chat.docTemplate.saveFailed')) } finally { setSaving(false) }
  }
  const handleUpload = async (file) => {
    setUploading(true)
    try {
      const data = await uploadTemplate(file, { name: uploadName.trim() })
      message.success(t('chat.docTemplate.upload.done', { count: data.blocks.length }))
      setUploadName('')
      setEditing({ template: data.template, blocks: data.blocks, roles: data.template.roles, name: data.template.name, description: '', dirty: true })
    } catch (e) { message.error(e.response?.data?.message || e.message || t('chat.docTemplate.upload.failed')) } finally { setUploading(false) }
    return false
  }
  const handleDraftFile = async (file) => {
    setParsing(true)
    try { setDraftContent(await extractDraft({ file })); message.success(t('chat.docTemplate.draft.parsed')) } catch (e) { message.error(e.response?.data?.message || e.message) } finally { setParsing(false) }
    return false
  }
  const handleDraftText = () => { if (draftText.trim()) setDraftContent(textToContent(draftText)) }

  const fmtTime = (v) => (v ? new Date(v).toLocaleString(i18n.language) : '')
  const columns = [
    { title: t('chat.docTemplate.list.name'), dataIndex: 'name', render: (v, r) => <Space size={4}><FileWordOutlined style={{ color: '#2b579a' }} /><span>{v}</span>{!r.is_owner && <Tag>{t('chat.docTemplate.shared')}</Tag>}</Space> },
    { title: t('chat.docTemplate.list.format'), render: (_, r) => { const b = r.summary?.roleFormats?.body; return <Text type="secondary">{b ? `${b.font || '—'} ${b.sizeName || (b.size ? `${b.size}pt` : '')}` : '—'}{r.summary?.headers?.length ? ` · ${t('chat.docTemplate.apply.hasHeader')}` : ''}</Text> } },
    { title: t('chat.docTemplate.list.share'), width: 90, render: (_, r) => <Switch size="small" checked={r.scope === 'group'} disabled={!r.is_owner} onChange={(v) => updateTemplate(r.id, { scope: v ? 'group' : 'private' }).catch(() => message.error(t('chat.docTemplate.saveFailed')))} /> },
    { title: t('chat.docTemplate.list.used'), width: 70, dataIndex: 'use_count' },
    { title: t('chat.docTemplate.list.updated'), width: 150, render: (_, r) => <Text type="secondary">{fmtTime(r.updated_at)}</Text> },
    {
      title: '',
      width: 130,
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title={r.is_owner ? t('chat.docTemplate.list.edit') : t('chat.docTemplate.list.view')}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditor(r)} /></Tooltip>
          <Tooltip title={t('chat.docTemplate.list.download')}><Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => downloadOriginal(r.id).then((blob) => downloadBlob(blob, `${(r.original_filename || r.name).replace(/\.docx$/i, '')}.docx`)).catch(() => message.error(t('chat.docTemplate.loadFailed')))} /></Tooltip>
          {r.is_owner && (
            <Popconfirm title={t('chat.docTemplate.list.deleteConfirm')} onConfirm={() => deleteTemplate(r.id).then(() => message.success(t('chat.docTemplate.deleted'))).catch(() => message.error(t('chat.docTemplate.saveFailed')))} okText={t('common.confirm')} cancelText={t('common.cancel')}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      )
    }
  ]

  const editorView = editing && (
    <div className="doc-editor">
      <Space style={{ marginBottom: 10 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => setEditing(null)}>{t('chat.docTemplate.editor.back')}</Button>
        <Input value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} maxLength={100} style={{ width: 240 }} placeholder={t('chat.docTemplate.editor.namePlaceholder')} disabled={!editing.template.is_owner} />
        <Input value={editing.description} onChange={(e) => setEditing((s) => ({ ...s, description: e.target.value }))} maxLength={200} style={{ width: 280 }} placeholder={t('chat.docTemplate.editor.descPlaceholder')} disabled={!editing.template.is_owner} />
        {editing.template.is_owner && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveEditor}>{t('chat.docTemplate.editor.save')}</Button>}
      </Space>
      {editing.template.summary?.page && (
        <Paragraph type="secondary" className="doc-editor-summary">
          {t('chat.docTemplate.editor.page', { w: editing.template.summary.page.width_cm, h: editing.template.summary.page.height_cm, top: editing.template.summary.page.margins_cm?.top, bottom: editing.template.summary.page.margins_cm?.bottom, left: editing.template.summary.page.margins_cm?.left, right: editing.template.summary.page.margins_cm?.right })}
          {editing.template.summary.headers?.length ? ` · ${t('chat.docTemplate.editor.header', { text: editing.template.summary.headers.map((h) => h.text).filter(Boolean).join(' / ') || t('chat.docTemplate.editor.headerImage') })}` : ''}
          {editing.template.summary.footers?.length ? ` · ${t('chat.docTemplate.editor.footer')}` : ''}
        </Paragraph>
      )}
      <RoleLabeler blocks={editing.blocks} roles={editing.roles} readOnly={!editing.template.is_owner} onChange={(roles) => setEditing((s) => ({ ...s, roles, dirty: true }))} />
    </div>
  )

  const libraryTab = (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 10 }} message={t('chat.docTemplate.intro')} />
      <Table size="small" rowKey="id" loading={loading} dataSource={templates} columns={columns} pagination={false} locale={{ emptyText: t('chat.docTemplate.list.empty') }} />
    </div>
  )
  const uploadTab = (
    <div>
      <Paragraph type="secondary">{t('chat.docTemplate.upload.intro')}</Paragraph>
      <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} maxLength={100} placeholder={t('chat.docTemplate.upload.namePlaceholder')} style={{ marginBottom: 10 }} />
      <Upload.Dragger accept=".docx" multiple={false} showUploadList={false} beforeUpload={handleUpload} disabled={uploading}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{uploading ? t('chat.docTemplate.upload.uploading') : t('chat.docTemplate.upload.drag')}</p>
        <p className="ant-upload-hint">{t('chat.docTemplate.upload.hint')}</p>
      </Upload.Dragger>
    </div>
  )
  const draftTab = (
    <div className="doc-draft">
      <Space style={{ marginBottom: 10 }} wrap>
        <Radio.Group value={draftMode} onChange={(e) => { setDraftMode(e.target.value); setDraftContent(null) }} optionType="button" buttonStyle="solid" size="small"
          options={[{ value: 'file', label: t('chat.docTemplate.draft.modeFile') }, { value: 'text', label: t('chat.docTemplate.draft.modeText') }]} />
        {draftMode === 'file' && (
          <Upload accept=".docx" multiple={false} showUploadList={false} beforeUpload={handleDraftFile} disabled={parsing}>
            <Button loading={parsing} icon={<FileWordOutlined />}>{t('chat.docTemplate.draft.pick')}</Button>
          </Upload>
        )}
      </Space>
      {draftMode === 'text' && (
        <div style={{ marginBottom: 10 }}>
          <Input.TextArea rows={6} value={draftText} onChange={(e) => setDraftText(e.target.value)} placeholder={t('chat.docTemplate.draft.textPlaceholder')} />
          <Button type="primary" size="small" style={{ marginTop: 6 }} onClick={handleDraftText} disabled={!draftText.trim()}>{t('chat.docTemplate.draft.parse')}</Button>
        </div>
      )}
      {draftContent
        ? <ApplyPanel content={draftContent} onManage={() => setTab('upload')} compact />
        : <Text type="secondary">{t('chat.docTemplate.draft.empty')}</Text>}
    </div>
  )

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={960} title={t('chat.docTemplate.title')} destroyOnClose className="doc-template-modal">
      {editing ? editorView : (
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'library', label: t('chat.docTemplate.tab.library'), children: libraryTab },
          { key: 'upload', label: t('chat.docTemplate.tab.upload'), children: uploadTab },
          { key: 'draft', label: t('chat.docTemplate.tab.draft'), children: draftTab }
        ]} />
      )}
    </Modal>
  )
}

export default DocTemplateManager
