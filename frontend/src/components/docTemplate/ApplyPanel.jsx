/**
 * 套用模板：选模板 → 确认字段（标题/主送/附件/落款/日期，从内容里猜的，可改）→ 预览正文 → 下载 .docx
 * 画布的"套模板"弹窗和模板库里的"套用到我的草稿"都用它；正文块（blocks）由调用方给。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Select, Input, Button, Space, Typography, Spin, Alert, Empty, message } from 'antd'
import { DownloadOutlined, EyeOutlined, SettingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import useDocTemplateStore from '../../stores/docTemplateStore'
import { downloadBlob, buildSafeBaseName } from '../../utils/canvas/download'
import { LAST_TEMPLATE_KEY } from './roleMeta'

const { Text } = Typography
const readLast = () => { try { return Number(localStorage.getItem(LAST_TEMPLATE_KEY)) || null } catch (e) { return null } }
const writeLast = (id) => { try { localStorage.setItem(LAST_TEMPLATE_KEY, String(id)) } catch (e) { /* ignore */ } }

const ApplyPanel = ({ content, onManage, compact = false }) => {
  const { t } = useTranslation()
  const { templates, fetchTemplates, renderDocx, previewHtml } = useDocTemplateStore()
  const [templateId, setTemplateId] = useState(readLast())
  const [fields, setFields] = useState({ title: '', recipient: '', attachments: '', signer: '', date: '' })
  const [html, setHtml] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchTemplates().catch(() => {}) }, [fetchTemplates])
  useEffect(() => {
    setFields({
      title: content?.title || '',
      recipient: content?.recipient || '',
      attachments: (content?.attachments || []).join('\n'),
      signer: (content?.signer || []).join('\n'),
      date: content?.date || ''
    })
    setHtml('')
  }, [content])
  useEffect(() => {
    if (templates.length && !templates.some((x) => x.id === templateId)) setTemplateId(templates[0].id)
  }, [templates, templateId])

  const payload = useMemo(() => ({
    title: fields.title.trim(),
    recipient: fields.recipient.trim(),
    blocks: content?.blocks || [],
    attachments: fields.attachments.split('\n').map((s) => s.trim()).filter(Boolean),
    signer: fields.signer.split('\n').map((s) => s.trim()).filter(Boolean),
    date: fields.date.trim()
  }), [fields, content])
  const template = templates.find((x) => x.id === templateId)
  const blockCount = payload.blocks.length

  const doPreview = async () => {
    if (!templateId) return
    setPreviewing(true); setError(null)
    try { setHtml(await previewHtml(templateId, payload)) } catch (e) { setError(e.message) } finally { setPreviewing(false) }
  }
  const doDownload = async () => {
    if (!templateId) return
    setDownloading(true); setError(null)
    try {
      const blob = await renderDocx(templateId, payload, payload.title)
      downloadBlob(blob, `${buildSafeBaseName(payload.title, 'document', '')}.docx`)
      writeLast(templateId)
      message.success(t('chat.docTemplate.apply.downloaded'))
    } catch (e) { setError(e.message); message.error(t('chat.docTemplate.apply.failed')) } finally { setDownloading(false) }
  }
  const field = (key, rows, placeholderKey) => (
    <div className="doc-field">
      <label>{t(`chat.docTemplate.field.${key}`)}</label>
      {rows > 1
        ? <Input.TextArea rows={rows} value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} placeholder={t(placeholderKey)} />
        : <Input value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} placeholder={t(placeholderKey)} />}
    </div>
  )

  if (!templates.length) {
    return (
      <Empty description={t('chat.docTemplate.apply.noTemplates')}>
        {onManage && <Button type="primary" icon={<SettingOutlined />} onClick={onManage}>{t('chat.docTemplate.apply.goUpload')}</Button>}
      </Empty>
    )
  }
  return (
    <div className={`doc-apply ${compact ? 'compact' : ''}`}>
      <div className="doc-apply-left">
        <div className="doc-field">
          <label>{t('chat.docTemplate.apply.template')}</label>
          <Space.Compact style={{ width: '100%' }}>
            <Select value={templateId} onChange={(v) => { setTemplateId(v); setHtml('') }} style={{ flex: 1 }}
              options={templates.map((x) => ({ value: x.id, label: `${x.name}${x.is_owner ? '' : ` · ${t('chat.docTemplate.shared')}`}` }))} />
            {onManage && <Button icon={<SettingOutlined />} onClick={onManage}>{t('chat.docTemplate.apply.manage')}</Button>}
          </Space.Compact>
          {template?.summary?.roleFormats?.body && (
            <Text type="secondary" className="doc-apply-meta">
              {t('chat.docTemplate.apply.bodyFormat', { font: template.summary.roleFormats.body.font || '—', size: template.summary.roleFormats.body.sizeName || `${template.summary.roleFormats.body.size || '—'}pt` })}
              {template.summary.headers?.length ? ` · ${t('chat.docTemplate.apply.hasHeader')}` : ''}
            </Text>
          )}
        </div>
        {field('title', 1, 'chat.docTemplate.field.titlePlaceholder')}
        {field('recipient', 1, 'chat.docTemplate.field.recipientPlaceholder')}
        <div className="doc-field"><label>{t('chat.docTemplate.field.body')}</label><Text type="secondary">{t('chat.docTemplate.field.bodyCount', { count: blockCount })}</Text></div>
        {field('attachments', 2, 'chat.docTemplate.field.attachmentsPlaceholder')}
        {field('signer', 2, 'chat.docTemplate.field.signerPlaceholder')}
        {field('date', 1, 'chat.docTemplate.field.datePlaceholder')}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
        <Space>
          <Button icon={<EyeOutlined />} onClick={doPreview} loading={previewing} disabled={!templateId || (!blockCount && !payload.title)}>{t('chat.docTemplate.apply.preview')}</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={doDownload} loading={downloading} disabled={!templateId || (!blockCount && !payload.title)}>{t('chat.docTemplate.apply.download')}</Button>
        </Space>
      </div>
      <div className="doc-apply-right">
        {previewing ? <div className="doc-apply-loading"><Spin /></div> : (
          html
            ? <div className="doc-template-preview"><div className="doc-template-paper" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} /><Text type="secondary" className="doc-apply-note">{t('chat.docTemplate.apply.previewNote')}</Text></div>
            : <div className="doc-apply-placeholder"><Text type="secondary">{t('chat.docTemplate.apply.previewEmpty')}</Text></div>
        )}
      </div>
    </div>
  )
}

export default ApplyPanel
