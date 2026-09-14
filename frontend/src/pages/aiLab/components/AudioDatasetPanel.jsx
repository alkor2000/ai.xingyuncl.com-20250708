/**
 * 声音数据集面板：类别管理 + 各类别训练片段（频谱缩略图 + 试听）；留出集只显示数量
 */
import React, { useEffect, useState } from 'react'
import { Button, Input, Space, Tag, Popconfirm, Empty, Tooltip, message, Modal } from 'antd'
import { PlusOutlined, DeleteOutlined, LockOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import AudioThumb from './AudioThumb'

const slugify = (label, existing) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) base = `class_${existing.length + 1}`
  let key = base.slice(0, 28)
  let i = 2
  while (existing.some((c) => c.key === key)) { key = `${base.slice(0, 24)}_${i}`; i += 1 }
  return key
}

const AudioDatasetPanel = ({ dataset, samples, onAddClass, onRenameClass, onDeleteSample, canEdit }) => {
  const { t } = useTranslation()
  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState(null)
  const classes = dataset?.classes || []
  const counts = dataset?.counts || { train: {}, holdout: {}, shift: {} }
  useEffect(() => { setEditing(null) }, [dataset?.id])

  const handleAdd = async () => {
    const label = newLabel.trim()
    if (!label) return
    if (classes.some((c) => c.label === label)) { message.warning(t('aiLab.dataset.duplicateClass')); return }
    await onAddClass({ key: slugify(label, classes), label })
    setNewLabel('')
  }
  const trainSamples = (key) => (samples || []).filter((s) => s.split === 'train' && s.class_key === key)
  const shiftTotal = (key) => Object.values(counts.shift || {}).reduce((a, set) => a + (set[key] || 0), 0)

  return (
    <div className="ailab-dataset">
      {canEdit && (
        <Space.Compact style={{ width: '100%', maxWidth: 420, marginBottom: 12 }}>
          <Input placeholder={t('aiLab.audio.newClassPlaceholder')} value={newLabel} maxLength={30} onChange={(e) => setNewLabel(e.target.value)} onPressEnter={handleAdd} />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('aiLab.dataset.addClass')}</Button>
        </Space.Compact>
      )}
      {!classes.length && <Empty description={t('aiLab.dataset.noClasses')} />}
      {classes.map((cls) => {
        const list = trainSamples(cls.key)
        return (
          <div className="ailab-class-block" key={cls.key}>
            <div className="ailab-class-head">
              <span className="ailab-class-name" onClick={() => canEdit && setEditing({ key: cls.key, label: cls.label })} role="presentation">{cls.label}</span>
              <span className="ailab-class-key">{cls.key}</span>
              <Tag>{t('aiLab.split.train')} {counts.train?.[cls.key] || 0}</Tag>
              <Tooltip title={t('aiLab.dataset.holdoutHidden')}><Tag icon={<LockOutlined />}>{t('aiLab.split.holdout')} {counts.holdout?.[cls.key] || 0}</Tag></Tooltip>
              <Tag color="orange">{t('aiLab.split.shift')} {shiftTotal(cls.key)}</Tag>
            </div>
            <div className="ailab-sample-grid">
              {list.map((s) => (
                <div className="ailab-thumb" key={s.id} title={Object.entries(s.condition_tags || {}).map(([k, v]) => `${t(`aiLab.audioCondition.${k}`, { defaultValue: k })}: ${v}`).join(' / ')}>
                  <AudioThumb sample={s} />
                  {canEdit && (
                    <Popconfirm title={t('aiLab.dataset.deleteConfirm')} onConfirm={() => onDeleteSample(s)} okText={t('common.confirm')} cancelText={t('common.cancel')}>
                      <button type="button" className="ailab-thumb-del" aria-label="delete"><DeleteOutlined /></button>
                    </Popconfirm>
                  )}
                </div>
              ))}
              {!list.length && <div className="ailab-sample-empty">{t('aiLab.audio.noTrainSamples')}</div>}
            </div>
          </div>
        )
      })}
      <Modal title={t('aiLab.dataset.renameClass')} open={!!editing} onCancel={() => setEditing(null)} onOk={async () => { await onRenameClass(editing.key, editing.label.trim()); setEditing(null) }} okText={t('common.save')} cancelText={t('common.cancel')}>
        <Input value={editing?.label || ''} maxLength={30} onChange={(e) => setEditing((prev) => ({ ...prev, label: e.target.value }))} />
      </Modal>
    </div>
  )
}

export default AudioDatasetPanel
