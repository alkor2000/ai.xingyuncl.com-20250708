/**
 * 决策树训练面板（表格数据）：选最大深度 → 在训练行上训练 CART → 保存为一个版本 → 展示树与展开的规则
 * 训练在浏览器内完成，artifact 就是整棵树的 JSON。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Space, Input, Alert, Tag, Segmented, Typography, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { trainTree, treeToRules, treeDepth, countLeaves, serializeTree, deserializeTree, DEFAULT_MAX_DEPTH } from '../engine/tabular/decisionTree'
import { predictTree } from '../engine/tabular/decisionTree'
import { computeMetrics, formatPercent } from '../engine/metrics'
import TreeView from './TreeView'
import RuleList from './RuleList'
import { toRows } from './TablePanel'

const { Text } = Typography

const TreeTrainPanel = ({ dataset, samples, models, canEdit, labelOf, depthOptions }) => {
  const { t } = useTranslation()
  const { saveModel, loadLiveModel, recordEvent, liveModels } = useAiLabStore()
  const columns = (dataset?.columns || []).filter((c) => c.type !== 'text')
  const classes = dataset?.classes || []
  const rows = useMemo(() => toRows(samples, 'train'), [samples])
  const options = depthOptions?.length ? depthOptions : [1, 2, 3, 4, 6]
  const [maxDepth, setMaxDepth] = useState(options.includes(DEFAULT_MAX_DEPTH) ? DEFAULT_MAX_DEPTH : options[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('tree')
  const treeModels = models.filter((m) => m.engine === 'table-tree')
  const [selectedId, setSelectedId] = useState(treeModels[treeModels.length - 1]?.id || null)
  const [live, setLive] = useState(null)
  const selected = treeModels.find((m) => m.id === selectedId) || treeModels[treeModels.length - 1]

  useEffect(() => { if (selected && selectedId !== selected.id) setSelectedId(selected.id) }, [selected, selectedId])
  useEffect(() => {
    let cancelled = false
    if (!selected) { setLive(null); return undefined }
    const cached = liveModels[selected.id]
    if (cached) { setLive(cached); return undefined }
    loadLiveModel(selected.id, deserializeTree).then((m) => { if (!cancelled) setLive(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const columnLabel = (key) => columns.find((c) => c.key === key)?.label || key
  const unit = (key) => columns.find((c) => c.key === key)?.unit || ''
  const present = new Set(rows.map((r) => r.label))

  const handleTrain = async () => {
    if (present.size < 2) { message.warning(t('aiLab.train.needTwoClasses')); return }
    setBusy(true)
    const started = Date.now()
    try {
      const tree = trainTree(rows, columns, { maxDepth })
      const preds = rows.map((r) => ({ id: r.id, actual: r.label, predicted: predictTree(tree, r.payload).label, confidence: 1 }))
      const trainAcc = computeMetrics(preds, tree.classKeys).accuracy
      const classCounts = {}
      rows.forEach((r) => { classCounts[r.label] = (classCounts[r.label] || 0) + 1 })
      const model = await saveModel({
        dataset_id: dataset.id,
        dataset_version: dataset.version,
        engine: 'table-tree',
        feature_extractor: 'none',
        params: { max_depth: maxDepth, min_samples: tree.minSamples, depth: treeDepth(tree.root), leaves: countLeaves(tree.root), train_accuracy: trainAcc },
        class_keys: tree.classKeys,
        train_sample_count: rows.length,
        artifact: serializeTree(tree, { dataset_version: dataset.version }),
        note: note.trim() || undefined
      }, tree)
      recordEvent('train.run', { model_id: model.id, version: model.version, engine: 'table-tree', dataset_version: dataset.version, train_sample_count: rows.length, class_counts: classCounts, max_depth: maxDepth, depth: treeDepth(tree.root), leaves: countLeaves(tree.root), train_accuracy: trainAcc, duration_ms: Date.now() - started, note: note.trim() || undefined })
      setSelectedId(model.id)
      setLive(tree)
      setNote('')
      message.success(t('aiLab.train.done', { version: model.version }))
    } catch (err) {
      console.error('tree training failed:', err)
      message.error(t('aiLab.train.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ailab-tree-train">
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.tree.intro')} />
      {!dataset?.locked_at && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('aiLab.train.lockFirst')} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('aiLab.tree.maxDepth')}</span>
        <Segmented size="small" value={maxDepth} onChange={setMaxDepth} options={options.map((d) => ({ value: d, label: String(d) }))} disabled={!canEdit} />
        <Text type="secondary" className="ailab-muted">{t('aiLab.tree.depthHint')}</Text>
      </Space>
      {canEdit && models.length > 0 && (
        <Input.TextArea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('aiLab.train.notePlaceholder', { version: models.length + 1 })} style={{ marginBottom: 12 }} />
      )}
      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleTrain} loading={busy} disabled={!canEdit || present.size < 2 || !dataset?.locked_at}>
          {t('aiLab.tree.trainVersion', { version: (models?.length || 0) + 1, depth: maxDepth })}
        </Button>
        <Text type="secondary">{t('aiLab.tree.rowsUsed', { count: rows.length })}</Text>
      </Space>
      {treeModels.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <span>{t('aiLab.evaluate.selectVersion')}</span>
            <Select size="small" value={selected?.id} onChange={setSelectedId} style={{ width: 200 }} options={treeModels.map((m) => ({ value: m.id, label: `${t('aiLab.version', { version: m.version })} · ${t('aiLab.tree.depthLabel', { depth: m.params?.depth ?? m.params?.max_depth })}` }))} />
            {selected?.params && <Tag>{t('aiLab.tree.leaves', { count: selected.params.leaves })}</Tag>}
            {typeof selected?.params?.train_accuracy === 'number' && <Tag color="blue">{t('aiLab.rules.trainAccuracyShort', { value: formatPercent(selected.params.train_accuracy) })}</Tag>}
            <Segmented size="small" value={view} onChange={setView} options={[{ value: 'tree', label: t('aiLab.tree.viewTree') }, { value: 'rules', label: t('aiLab.tree.viewRules') }]} />
          </Space>
          {live && view === 'tree' && <TreeView root={live.root} labelOf={labelOf} columnLabel={columnLabel} unit={unit} />}
          {live && view === 'rules' && <RuleList rules={treeToRules(live)} labelOf={labelOf} columnLabel={columnLabel} unit={unit} />}
        </div>
      )}
    </div>
  )
}

export default TreeTrainPanel
