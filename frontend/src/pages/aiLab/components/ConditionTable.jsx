/**
 * 测试条件表（P2）：学生先写"换什么条件、预计准确率、理由"，测试后自动填入实测值
 * 条件名与换条件测试集的名称一致时才能自动对上。
 */
import React, { useEffect, useState } from 'react'
import { Table, Input, InputNumber, Button, Space, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { formatPercent } from '../engine/metrics'

const emptyRow = () => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, condition: '', predicted: null, reason: '' })

const ConditionTable = ({ project, models, canEdit }) => {
  const { t } = useTranslation()
  const { updateProject, recordEvent } = useAiLabStore()
  const [rows, setRows] = useState(project?.context?.condition_table || [emptyRow()])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setRows(project?.context?.condition_table || [emptyRow()]) }, [project?.id])

  const actualOf = (condition) => {
    for (let i = models.length - 1; i >= 0; i -= 1) {
      const acc = models[i].metrics?.shift?.[condition]?.accuracy
      if (typeof acc === 'number') return { acc, version: models[i].version }
    }
    return null
  }

  const save = async () => {
    const clean = rows.filter((r) => r.condition.trim())
    setSaving(true)
    try {
      await updateProject({ context: { ...(project.context || {}), condition_table: clean } })
      recordEvent('condition.design', { rows: clean.map((r) => ({ condition: r.condition, predicted: r.predicted, reason: r.reason })) })
      message.success(t('aiLab.condition.saved'))
    } catch (err) {
      message.error(t('aiLab.condition.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const update = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const columns = [
    { title: t('aiLab.condition.name'), dataIndex: 'condition', render: (v, r) => <Input value={v} maxLength={50} disabled={!canEdit} onChange={(e) => update(r.id, { condition: e.target.value })} placeholder={t('aiLab.condition.namePlaceholder')} /> },
    /* 某个条件已经实测过后，它的预计值就锁定：预测必须先于观察，事后改预测就不是预测了 */
    { title: t('aiLab.condition.predicted'), dataIndex: 'predicted', width: 130, render: (v, r) => <InputNumber value={v} min={0} max={100} disabled={!canEdit || !!actualOf(r.condition.trim())} addonAfter="%" onChange={(val) => update(r.id, { predicted: val })} title={actualOf(r.condition.trim()) ? t('aiLab.condition.predictedLocked') : undefined} /> },
    { title: t('aiLab.condition.reason'), dataIndex: 'reason', render: (v, r) => <Input value={v} maxLength={200} disabled={!canEdit} onChange={(e) => update(r.id, { reason: e.target.value })} placeholder={t('aiLab.condition.reasonPlaceholder')} /> },
    {
      title: t('aiLab.condition.actual'),
      width: 150,
      render: (_, r) => {
        const a = actualOf(r.condition.trim())
        if (!a) return <span className="ailab-muted">{t('aiLab.condition.notTested')}</span>
        const diff = typeof r.predicted === 'number' ? (a.acc * 100 - r.predicted) : null
        return <span>{formatPercent(a.acc)} <small className="ailab-muted">v{a.version}{diff !== null ? ` · ${diff > 0 ? '+' : ''}${diff.toFixed(0)}` : ''}</small></span>
      }
    },
    canEdit ? { title: '', width: 40, render: (_, r) => <Button type="text" icon={<DeleteOutlined />} onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))} /> } : null
  ].filter(Boolean)

  return (
    <div>
      <Table size="small" rowKey="id" pagination={false} dataSource={rows} columns={columns} />
      {canEdit && (
        <Space style={{ marginTop: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, emptyRow()])}>{t('aiLab.condition.addRow')}</Button>
          <Button type="primary" onClick={save} loading={saving}>{t('aiLab.condition.save')}</Button>
        </Space>
      )}
    </div>
  )
}

export default ConditionTable
