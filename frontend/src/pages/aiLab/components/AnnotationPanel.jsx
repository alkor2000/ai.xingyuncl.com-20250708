/**
 * 双人标注与一致性（M5）：两位同学各自给同一批训练句子贴情绪标签，算一致率与 Cohen's kappa，
 * 不一致的句子讨论后采纳一方标签（写回样本类别）。标注表存 project.context.annotations。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Table, Select, Button, Space, Tag, Alert, Typography, message } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { cohenKappa, kappaLevel } from '../engine/text/agreement'
import { formatPercent } from '../engine/metrics'
import { toTextRows } from './TextPanel'

const { Text } = Typography

const AnnotationPanel = ({ mode, project, dataset, samples, canEdit, labelOf }) => {
  const { t } = useTranslation()
  const { updateProject, recordEvent, relabelSample } = useAiLabStore()
  const classes = dataset?.classes || []
  const rows = useMemo(() => toTextRows(samples, 'train'), [samples])
  const [annState, setAnn] = useState(project?.context?.annotations || {})
  const ann = mode === 'agreement' ? (project?.context?.annotations || {}) : annState
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { setAnn(project?.context?.annotations || {}) }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLabel = (id, who, value) => setAnn((a) => ({ ...a, [id]: { ...(a[id] || {}), [who]: value } }))
  const filled = (who) => rows.filter((r) => ann[r.id]?.[who]).length

  const save = async () => {
    setSaving(true)
    try {
      await updateProject({ context: { ...(project.context || {}), annotations: ann } })
      recordEvent('annotation.write', { count_a: filled('a'), count_b: filled('b'), total: rows.length })
      message.success(t('aiLab.annotate.saved'))
    } catch (err) {
      message.error(t('aiLab.annotate.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const compute = () => {
    const stats = cohenKappa(rows.map((r) => ({ id: r.id, a: ann[r.id]?.a, b: ann[r.id]?.b, text: r.text, current: r.label })))
    setResult(stats)
    recordEvent('agreement.compute', { n: stats.n, agreement: stats.agreement, kappa: stats.kappa, disagreements: stats.disagreements.length })
  }

  const adopt = async (row, who) => {
    const label = ann[row.id]?.[who]
    if (!label) return
    try {
      await relabelSample(row.sample || samples.find((s) => s.id === row.id), label)
      recordEvent('dataset.relabel', { dataset_id: dataset.id, sample_id: row.id, class_key: label, source: `annotator_${who}` })
      setResult((r) => r && { ...r, disagreements: r.disagreements.filter((d) => d.id !== row.id) })
    } catch (err) {
      message.error(t('aiLab.annotate.adoptFailed'))
    }
  }

  const labelOptions = classes.map((c) => ({ value: c.key, label: c.label }))
  if (mode === 'agreement') {
    const stored = result || (filled('a') && filled('b') ? cohenKappa(rows.map((r) => ({ id: r.id, a: ann[r.id]?.a, b: ann[r.id]?.b, text: r.text }))) : null)
    return (
      <div>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.annotate.agreementIntro')} />
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={compute} disabled={!filled('a') || !filled('b')}>{t('aiLab.annotate.compute')}</Button>
          <Text type="secondary">{t('aiLab.annotate.filled', { a: filled('a'), b: filled('b'), total: rows.length })}</Text>
        </Space>
        {stored && stored.n > 0 && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <span className="ailab-big-number" style={{ fontSize: 26 }}>{formatPercent(stored.agreement)}</span>
              <Text type="secondary">{t('aiLab.annotate.agreementRate', { n: stored.n })}</Text>
              <Tag color={{ excellent: 'green', good: 'cyan', fair: 'orange', poor: 'red', none: 'default' }[kappaLevel(stored.kappa)]}>{t('aiLab.annotate.kappa', { value: stored.kappa.toFixed(2) })} · {t(`aiLab.annotate.level.${kappaLevel(stored.kappa)}`)}</Tag>
            </Space>
            <div className="ailab-muted" style={{ marginBottom: 8 }}>{t('aiLab.annotate.kappaHint')}</div>
            {stored.disagreements.length > 0 ? (
              <Table
                size="small" rowKey="id" pagination={{ pageSize: 8, size: 'small' }}
                dataSource={stored.disagreements.map((d) => ({ ...d, text: rows.find((r) => r.id === d.id)?.text || '', sample: rows.find((r) => r.id === d.id)?.sample }))}
                columns={[
                  { title: t('aiLab.text.textCol'), dataIndex: 'text' },
                  { title: 'A', dataIndex: 'a', width: 90, render: (v) => <Tag>{labelOf(v)}</Tag> },
                  { title: 'B', dataIndex: 'b', width: 90, render: (v) => <Tag>{labelOf(v)}</Tag> },
                  ...(canEdit ? [{ title: t('aiLab.annotate.resolve'), width: 170, render: (_, r) => (
                    <Space size={4}>
                      <Button size="small" onClick={() => adopt(r, 'a')}>{t('aiLab.annotate.adoptA')}</Button>
                      <Button size="small" onClick={() => adopt(r, 'b')}>{t('aiLab.annotate.adoptB')}</Button>
                    </Space>
                  ) }] : [])
                ]}
              />
            ) : <Alert type="success" showIcon message={t('aiLab.annotate.noDisagreement')} />}
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.annotate.intro')} />
      {!rows.length && <Text type="secondary">{t('aiLab.text.noRows')}</Text>}
      {rows.length > 0 && (
        <Table
          size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 10, size: 'small' }}
          columns={[
            { title: t('aiLab.text.textCol'), dataIndex: 'text' },
            { title: t('aiLab.annotate.current'), dataIndex: 'label', width: 90, render: (v) => <Tag color="blue">{labelOf(v)}</Tag> },
            { title: t('aiLab.annotate.annotatorA'), width: 130, render: (_, r) => <Select size="small" style={{ width: 120 }} value={ann[r.id]?.a} disabled={!canEdit} placeholder={t('aiLab.verify.choose')} options={labelOptions} onChange={(v) => setLabel(r.id, 'a', v)} /> },
            { title: t('aiLab.annotate.annotatorB'), width: 130, render: (_, r) => <Select size="small" style={{ width: 120 }} value={ann[r.id]?.b} disabled={!canEdit} placeholder={t('aiLab.verify.choose')} options={labelOptions} onChange={(v) => setLabel(r.id, 'b', v)} /> }
          ]}
        />
      )}
      {canEdit && rows.length > 0 && (
        <Space style={{ marginTop: 10 }}>
          <Button type="primary" onClick={save} loading={saving}>{t('aiLab.annotate.save')}</Button>
          <Text type="secondary">{t('aiLab.annotate.filled', { a: filled('a'), b: filled('b'), total: rows.length })}</Text>
        </Space>
      )}
    </div>
  )
}

export default AnnotationPanel
