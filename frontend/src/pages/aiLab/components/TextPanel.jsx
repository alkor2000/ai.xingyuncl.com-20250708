/**
 * 文本数据集面板：各类别的训练句子列表、手工添加句子、导入预置语料；留出集只显示数量
 */
import React, { useMemo, useState } from 'react'
import { Button, Input, Select, Space, Tag, Tooltip, Empty, Popconfirm, Table, message } from 'antd'
import { PlusOutlined, LockOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

export const toTextRows = (samples, split = 'train') => (samples || []).filter((s) => s.split === split).map((s) => ({ id: s.id, label: s.class_key, text: s.payload?.text || '' , sample: s }))

const TextPanel = ({ dataset, samples, canEdit, labelOf, onAddRow, onDeleteSample, onImport }) => {
  const { t } = useTranslation()
  const classes = dataset?.classes || []
  const counts = dataset?.counts || { train: {}, holdout: {}, shift: {} }
  const rows = useMemo(() => toTextRows(samples, 'train'), [samples])
  const [draft, setDraft] = useState('')
  const [draftClass, setDraftClass] = useState(classes[0]?.key)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState(null)
  const shiftTotal = (key) => Object.values(counts.shift || {}).reduce((a, set) => a + (set[key] || 0), 0)
  const holdoutTotal = Object.values(counts.holdout || {}).reduce((a, b) => a + b, 0)

  const submit = async () => {
    const text = draft.trim()
    const cls = draftClass || classes[0]?.key
    if (!text || !cls) return
    setAdding(true)
    try {
      await onAddRow({ class_key: cls, payload: { text } })
      setDraft('')
      message.success(t('aiLab.text.addDone'))
    } catch (err) {
      message.error(t('aiLab.table.addRowFailed'))
    } finally {
      setAdding(false)
    }
  }

  const shown = filter ? rows.filter((r) => r.label === filter) : rows
  return (
    <div className="ailab-text-panel">
      <div className="ailab-class-head" style={{ marginBottom: 12 }}>
        {classes.map((cls) => (
          <span key={cls.key} className={`ailab-class-chip ${filter === cls.key ? 'active' : ''}`} onClick={() => setFilter(filter === cls.key ? null : cls.key)} role="presentation">
            <b>{cls.label}</b>
            <Tag>{t('aiLab.split.train')} {counts.train?.[cls.key] || 0}</Tag>
            <Tooltip title={t('aiLab.dataset.holdoutHidden')}><Tag icon={<LockOutlined />}>{counts.holdout?.[cls.key] || 0}</Tag></Tooltip>
            <Tag color="orange">{t('aiLab.split.shift')} {shiftTotal(cls.key)}</Tag>
          </span>
        ))}
        {canEdit && onImport && <Button size="small" icon={<PlusOutlined />} onClick={onImport}>{t('aiLab.preset.buttonOpen')}</Button>}
      </div>
      {!rows.length && <Empty description={t('aiLab.text.noRows')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {rows.length > 0 && (
        <>
          <div className="ailab-muted" style={{ marginBottom: 6 }}>{t('aiLab.text.rowsShown', { count: rows.length, holdout: holdoutTotal })}</div>
          <Table
            size="small"
            rowKey="id"
            dataSource={shown}
            pagination={{ pageSize: 10, size: 'small' }}
            columns={[
              { title: t('aiLab.table.classCol'), dataIndex: 'label', width: 110, render: (v) => <Tag color="blue">{labelOf(v)}</Tag> },
              { title: t('aiLab.text.textCol'), dataIndex: 'text' },
              ...(canEdit ? [{ title: '', width: 50, render: (_, r) => (
                <Popconfirm title={t('aiLab.dataset.deleteConfirm')} onConfirm={() => onDeleteSample(r.sample)} okText={t('common.confirm')} cancelText={t('common.cancel')}>
                  <Button size="small" type="text" icon={<DeleteOutlined />} />
                </Popconfirm>
              ) }] : [])
            ]}
          />
        </>
      )}
      {canEdit && classes.length > 0 && onAddRow && (
        <div className="ailab-add-row">
          <div className="ailab-muted" style={{ marginBottom: 6 }}>{t('aiLab.text.addHint')}</div>
          <Space.Compact style={{ width: '100%' }}>
            <Input value={draft} maxLength={300} placeholder={t('aiLab.text.placeholder')} onChange={(e) => setDraft(e.target.value)} onPressEnter={submit} />
            <Select value={draftClass} onChange={setDraftClass} style={{ width: 130 }} options={classes.map((c) => ({ value: c.key, label: c.label }))} />
            <Button type="primary" icon={<PlusOutlined />} onClick={submit} loading={adding}>{t('aiLab.table.addRow')}</Button>
          </Space.Compact>
        </div>
      )}
    </div>
  )
}

export default TextPanel
