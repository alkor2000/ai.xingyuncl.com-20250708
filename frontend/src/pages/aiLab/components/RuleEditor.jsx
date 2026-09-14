/**
 * 手写规则编辑器（P3）："如果 … 且 … 那么是 …"，在训练集上试一试，再保存成一个"人工规则"版本，
 * 与决策树版本在同一批留出/换条件集上对照。规则草稿存在 project.context.rules。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Input, InputNumber, Space, Tag, Alert, Divider, Typography, message } from 'antd'
import { PlusOutlined, DeleteOutlined, ExperimentOutlined, SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { evaluateRules, validateRuleSet, serializeRules, NUMBER_OPS, CATEGORY_OPS } from '../engine/tabular/rules'
import { columnValues } from '../engine/tabular/stats'
import { computeMetrics, formatPercent } from '../engine/metrics'
import RuleList from './RuleList'
import ScatterPlot from './ScatterPlot'
import { toRows } from './TablePanel'

const { Text } = Typography
const OP_TEXT = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', '!=': '≠' }

const RuleEditor = ({ dataset, samples, models, project, canEdit, labelOf }) => {
  const { t } = useTranslation()
  const { saveModel, updateProject, recordEvent } = useAiLabStore()
  const columns = (dataset?.columns || []).filter((c) => c.type !== 'text')
  const classes = dataset?.classes || []
  const rows = useMemo(() => toRows(samples, 'train'), [samples])
  const numeric = columns.filter((c) => c.type === 'number')
  const emptyCondition = () => ({ col: columns[0]?.key, op: columns[0]?.type === 'number' ? '<=' : '==', value: '' })
  const [ruleSet, setRuleSet] = useState(() => project?.context?.rules || { rules: [{ conditions: [emptyCondition()], label: classes[0]?.key }], default_label: classes[classes.length - 1]?.key })
  const [trial, setTrial] = useState(null) // {accuracy, hits}
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [xKey, setXKey] = useState(numeric[0]?.key)
  const [yKey, setYKey] = useState(numeric[1]?.key || numeric[0]?.key)

  useEffect(() => { if (project?.context?.rules) setRuleSet(project.context.rules) }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  /* 列定义与类别可能在导入预置包后才到达：把草稿里还没选列/类别的位置补上默认值 */
  useEffect(() => {
    if (!columns.length || !classes.length) return
    setRuleSet((rs) => {
      let changed = false
      const rules = rs.rules.map((r) => {
        const conditions = r.conditions.map((c) => (columns.find((col) => col.key === c.col) ? c : (changed = true, emptyCondition())))
        const label = classes.find((cls) => cls.key === r.label) ? r.label : (changed = true, classes[0].key)
        return { ...r, conditions, label }
      })
      const default_label = rs.default_label && classes.find((cls) => cls.key === rs.default_label) ? rs.default_label : (changed = true, classes[classes.length - 1].key)
      return changed ? { ...rs, rules, default_label } : rs
    })
    if (!numeric.find((c) => c.key === xKey)) setXKey(numeric[0]?.key)
    if (!numeric.find((c) => c.key === yKey)) setYKey(numeric[1]?.key || numeric[0]?.key)
  }, [columns, classes]) // eslint-disable-line react-hooks/exhaustive-deps

  const columnLabel = (key) => columns.find((c) => c.key === key)?.label || key
  const unit = (key) => columns.find((c) => c.key === key)?.unit || ''
  const colType = (key) => columns.find((c) => c.key === key)?.type || 'category'
  const classKeys = classes.map((c) => c.key)
  const rulesVersion = models.filter((m) => m.engine === 'table-rules').length + 1

  const patchRule = (ri, patch) => setRuleSet((rs) => ({ ...rs, rules: rs.rules.map((r, i) => (i === ri ? { ...r, ...patch } : r)) }))
  const patchCondition = (ri, ci, patch) => patchRule(ri, { conditions: ruleSet.rules[ri].conditions.map((c, j) => (j === ci ? { ...c, ...patch } : c)) })
  const addRule = () => setRuleSet((rs) => ({ ...rs, rules: [...rs.rules, { conditions: [emptyCondition()], label: classes[0]?.key }] }))
  const removeRule = (ri) => setRuleSet((rs) => ({ ...rs, rules: rs.rules.filter((_, i) => i !== ri) }))
  const addCondition = (ri) => patchRule(ri, { conditions: [...ruleSet.rules[ri].conditions, emptyCondition()] })
  const removeCondition = (ri, ci) => patchRule(ri, { conditions: ruleSet.rules[ri].conditions.filter((_, j) => j !== ci) })

  const problems = validateRuleSet(ruleSet, columns, classKeys)

  const tryOnTrain = () => {
    if (problems.length) { message.warning(t('aiLab.rules.invalid')); return null }
    const hits = {}
    const preds = rows.map((r) => {
      const res = evaluateRules(ruleSet, r.payload, columns)
      const key = res.rule_index === -1 ? 'default' : res.rule_index
      hits[key] = hits[key] || { hit: 0, correct: 0 }
      hits[key].hit += 1
      if (res.label === r.label) hits[key].correct += 1
      return { id: r.id, actual: r.label, predicted: res.label || '?', confidence: 1 }
    })
    const metrics = computeMetrics(preds, classKeys)
    const result = { accuracy: metrics.accuracy, hits, metrics }
    setTrial(result)
    return result
  }

  const save = async () => {
    const result = tryOnTrain()
    if (!result) return
    setSaving(true)
    try {
      const model = await saveModel({
        dataset_id: dataset.id,
        dataset_version: dataset.version,
        engine: 'table-rules',
        feature_extractor: 'none',
        params: { rule_count: ruleSet.rules.length, default_label: ruleSet.default_label, train_accuracy: result.accuracy },
        class_keys: classKeys,
        train_sample_count: rows.length,
        artifact: serializeRules({ ...ruleSet, columns, classKeys }, { dataset_version: dataset.version }),
        note: note.trim() || undefined
      })
      await updateProject({ context: { ...(project.context || {}), rules: ruleSet } })
      recordEvent('rules.write', { model_id: model.id, version: model.version, rule_count: ruleSet.rules.length, rules: ruleSet.rules, default_label: ruleSet.default_label, train_accuracy: result.accuracy })
      recordEvent('train.run', { model_id: model.id, version: model.version, engine: 'table-rules', dataset_version: dataset.version, train_sample_count: rows.length, rule_count: ruleSet.rules.length, note: note.trim() || undefined })
      setNote('')
      message.success(t('aiLab.rules.saved', { version: model.version }))
    } catch (err) {
      console.error('save rules failed:', err)
      message.error(t('aiLab.rules.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const thresholds = ruleSet.rules.flatMap((r) => r.conditions.filter((c) => colType(c.col) === 'number' && c.value !== ''))

  return (
    <div className="ailab-rule-editor">
      {numeric.length >= 2 && rows.length > 0 && (
        <div className="ailab-rule-scatter">
          <Space wrap style={{ marginBottom: 6 }}>
            <span>{t('aiLab.table.xAxis')}</span>
            <Select size="small" value={xKey} onChange={setXKey} style={{ width: 140 }} options={numeric.map((c) => ({ value: c.key, label: c.label }))} />
            <span>{t('aiLab.table.yAxis')}</span>
            <Select size="small" value={yKey} onChange={setYKey} style={{ width: 140 }} options={numeric.map((c) => ({ value: c.key, label: c.label }))} />
            <Text type="secondary" className="ailab-muted">{t('aiLab.rules.scatterHint')}</Text>
          </Space>
          <ScatterPlot rows={rows} xKey={xKey} yKey={yKey} classKeys={classKeys} labelOf={labelOf} columnLabel={(k) => `${columnLabel(k)}${unit(k) ? ` (${unit(k)})` : ''}`} thresholds={thresholds} />
        </div>
      )}
      {ruleSet.rules.map((rule, ri) => (
        <div className="ailab-rule-card" key={ri}>
          <div className="ailab-rule-row">
            <span className="ailab-rule-if">{t('aiLab.rules.ruleNo', { no: ri + 1 })} {t('aiLab.rules.if')}</span>
            {canEdit && ruleSet.rules.length > 1 && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeRule(ri)} />}
          </div>
          {rule.conditions.map((c, ci) => (
            <Space key={ci} wrap className="ailab-rule-row">
              {ci > 0 && <span className="ailab-rule-and">{t('aiLab.rules.and')}</span>}
              <Select size="small" value={c.col} disabled={!canEdit} style={{ width: 130 }} options={columns.map((col) => ({ value: col.key, label: col.label }))}
                onChange={(v) => patchCondition(ri, ci, { col: v, op: colType(v) === 'number' ? '<=' : '==', value: '' })} />
              <Select size="small" value={c.op} disabled={!canEdit} style={{ width: 70 }}
                options={(colType(c.col) === 'number' ? NUMBER_OPS : CATEGORY_OPS).map((op) => ({ value: op, label: OP_TEXT[op] }))}
                onChange={(v) => patchCondition(ri, ci, { op: v })} />
              {colType(c.col) === 'number'
                ? <InputNumber size="small" value={c.value === '' ? null : c.value} disabled={!canEdit} style={{ width: 110 }} addonAfter={unit(c.col) || undefined} onChange={(v) => patchCondition(ri, ci, { value: v === null ? '' : v })} />
                : <Select size="small" value={c.value || undefined} disabled={!canEdit} style={{ width: 130 }} showSearch options={columnValues(rows, c.col).map((v) => ({ value: v, label: v }))} onChange={(v) => patchCondition(ri, ci, { value: v })} />}
              {canEdit && rule.conditions.length > 1 && <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => removeCondition(ri, ci)} />}
            </Space>
          ))}
          <Space wrap className="ailab-rule-row">
            {canEdit && <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addCondition(ri)}>{t('aiLab.rules.addCondition')}</Button>}
            <span className="ailab-rule-then">{t('aiLab.rules.then')}</span>
            <Select size="small" value={rule.label} disabled={!canEdit} style={{ width: 140 }} options={classes.map((cls) => ({ value: cls.key, label: cls.label }))} onChange={(v) => patchRule(ri, { label: v })} />
            {trial?.hits?.[ri] && <Tag color={trial.hits[ri].correct === trial.hits[ri].hit ? 'green' : 'orange'}>{t('aiLab.rules.hitStat', { hit: trial.hits[ri].hit, correct: trial.hits[ri].correct })}</Tag>}
          </Space>
        </div>
      ))}
      <Space wrap className="ailab-rule-row" style={{ marginTop: 8 }}>
        {canEdit && <Button size="small" icon={<PlusOutlined />} onClick={addRule}>{t('aiLab.rules.addRule')}</Button>}
        <span className="ailab-rule-if">{t('aiLab.rules.otherwise')}</span>
        <Select size="small" value={ruleSet.default_label} disabled={!canEdit} style={{ width: 140 }} allowClear options={classes.map((cls) => ({ value: cls.key, label: cls.label }))} onChange={(v) => setRuleSet((rs) => ({ ...rs, default_label: v || null }))} />
        {trial?.hits?.default && <Tag>{t('aiLab.rules.hitStat', { hit: trial.hits.default.hit, correct: trial.hits.default.correct })}</Tag>}
      </Space>
      {problems.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 10 }} message={t('aiLab.rules.problems', { list: Array.from(new Set(problems.map((p) => t(`aiLab.rules.problem.${p.code}`)))).join('；') })} />}
      <Divider style={{ margin: '12px 0' }} />
      <Space wrap>
        <Button icon={<ExperimentOutlined />} onClick={tryOnTrain} disabled={!rows.length || problems.length > 0}>{t('aiLab.rules.tryOnTrain')}</Button>
        {trial && <span className="ailab-big-number" style={{ fontSize: 22 }}>{formatPercent(trial.accuracy)}</span>}
        {trial && <Text type="secondary">{t('aiLab.rules.trainAccuracy', { count: rows.length })}</Text>}
      </Space>
      {canEdit && (
        <div style={{ marginTop: 12 }}>
          {rulesVersion > 1 && <Input.TextArea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('aiLab.rules.notePlaceholder')} style={{ marginBottom: 8 }} />}
          <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!rows.length || problems.length > 0 || !dataset?.locked_at}>{t('aiLab.rules.saveVersion', { version: (models?.length || 0) + 1 })}</Button>
          {!dataset?.locked_at && <Text type="warning" style={{ marginLeft: 8 }}>{t('aiLab.train.lockFirst')}</Text>}
        </div>
      )}
      {!canEdit && (
        <div style={{ marginTop: 12 }}>
          <RuleList rules={ruleSet.rules} labelOf={labelOf} columnLabel={columnLabel} unit={unit} defaultLabel={ruleSet.default_label} />
        </div>
      )}
    </div>
  )
}

export default RuleEditor
