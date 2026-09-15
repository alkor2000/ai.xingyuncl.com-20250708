/**
 * 表格模型测试面板：对手写规则版本或决策树版本跑留出集 / 换条件集，指标、混淆矩阵与错误行
 * 错误行展开能看到规则命中或树的判断路径，对应 error.view 事实。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Space, Tabs, Alert, Tag, Table, Typography, Divider, message } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { predictTree, deserializeTree } from '../engine/tabular/decisionTree'
import { evaluateRules, deserializeRules } from '../engine/tabular/rules'
import { predictMlp, deserializeMlp } from '../engine/tabular/mlp'
import { computeMetrics, formatPercent, generalizationGap } from '../engine/metrics'
import MetricsView from './MetricsView'
import { describeCondition } from './RuleList'

const { Text } = Typography

const deserializeAny = (json) => {
  if (json?.engine === 'table-rules') return deserializeRules(json)
  if (json?.engine === 'table-mlp') return deserializeMlp(json)
  return deserializeTree(json)
}

const TableEvaluatePanel = ({ dataset, models, labelOf, canEdit, defaultTab = 'holdout' }) => {
  const { t } = useTranslation()
  const { fetchSamples, loadLiveModel, saveEvaluation, recordEvent, evalResults, setEvalResult } = useAiLabStore()
  const tableModels = useMemo(() => models.filter((m) => m.engine === 'table-rules' || m.engine === 'table-tree' || m.engine === 'table-mlp'), [models])
  const [modelId, setModelId] = useState(null)
  const [running, setRunning] = useState(null)
  const [shiftSet, setShiftSet] = useState(null)
  const [error, setError] = useState(null)
  const model = useMemo(() => tableModels.find((m) => m.id === modelId) || tableModels[tableModels.length - 1], [tableModels, modelId])
  const results = (model && evalResults[model.id]) || {}
  useEffect(() => { if (model && modelId !== model.id) setModelId(model.id) }, [model, modelId])
  /* 训练出新版本后自动切到最新版，学生接着测的就是刚训练的那一版 */
  useEffect(() => { const latest = tableModels[tableModels.length - 1]; if (latest) setModelId(latest.id) }, [tableModels.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const shiftSets = useMemo(() => Object.keys(dataset?.counts?.shift || {}), [dataset])
  useEffect(() => { if (!shiftSet && shiftSets.length) setShiftSet(shiftSets[0]) }, [shiftSets, shiftSet])
  const columns = dataset?.columns || []
  const columnLabel = (key) => columns.find((c) => c.key === key)?.label || key
  const unit = (key) => columns.find((c) => c.key === key)?.unit || ''
  const holdoutTotal = Object.values(dataset?.counts?.holdout || {}).reduce((a, b) => a + b, 0)
  const shiftTotal = (name) => Object.values(dataset?.counts?.shift?.[name] || {}).reduce((a, b) => a + b, 0)

  const predictWith = (live, payload) => {
    if (live.engine === 'table-rules') {
      const r = evaluateRules(live, payload, live.columns)
      return { label: r.label || '?', confidence: 1, explain: r.rule_index === -1 ? t('aiLab.rules.otherwise') : t('aiLab.rules.ruleNo', { no: r.rule_index + 1 }) }
    }
    if (live.engine === 'table-mlp') {
      const r = predictMlp(live, payload)
      return { label: r.label, confidence: r.confidence, explain: Object.entries(r.scores).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${labelOf(k)} ${formatPercent(v)}`).join(' · ') }
    }
    const r = predictTree(live, payload)
    return { label: r.label, confidence: r.confidence, explain: r.path.map((p) => describeCondition({ col: p.col, op: p.type === 'number' ? (p.left ? '<=' : '>') : (p.left ? '==' : '!='), value: p.type === 'number' ? p.threshold : p.value }, columnLabel, unit)).join(' → ') }
  }

  const runTest = async (split, setName) => {
    if (!model) return
    setError(null)
    setRunning(split === 'holdout' ? 'holdout' : setName)
    try {
      const live = await loadLiveModel(model.id, deserializeAny)
      const params = split === 'holdout' ? { split: 'holdout' } : { split: 'shift', shift_set: setName }
      const samples = await fetchSamples(dataset.id, params)
      const trainIds = new Set(live.trainIds || [])
      const testable = samples.filter((s) => !trainIds.has(s.id))
      if (!testable.length) { message.warning(t('aiLab.evaluate.noSamples')); return }
      const predictions = testable.map((s) => {
        const r = predictWith(live, s.payload || {})
        return { id: s.id, actual: s.class_key, predicted: r.label, confidence: r.confidence, explain: r.explain, payload: s.payload || {} }
      })
      const metrics = computeMetrics(predictions, live.classKeys || [])
      const errors = predictions.filter((p) => p.actual !== p.predicted).slice(0, 200).map(({ id, actual, predicted, confidence }) => ({ sample_id: id, actual, predicted, confidence }))
      await saveEvaluation(model.id, { split, shift_set: split === 'shift' ? setName : undefined, sample_count: predictions.length, metrics, errors })
      recordEvent('test.run', { model_id: model.id, version: model.version, engine: model.engine, split, shift_set: split === 'shift' ? setName : undefined, sample_count: predictions.length, accuracy: metrics.accuracy, error_count: errors.length })
      setEvalResult(model.id, split === 'holdout' ? 'holdout' : `shift:${setName}`, { metrics, predictions })
    } catch (err) {
      console.error('table evaluation failed:', err)
      setError(err.message)
      message.error(t('aiLab.evaluate.failed'))
    } finally {
      setRunning(null)
    }
  }

  if (!tableModels.length) return <Alert type="info" showIcon message={t('aiLab.evaluate.noModel')} />

  const holdoutMetrics = results.holdout?.metrics || model?.metrics?.holdout || null
  const shiftMetricsOf = (name) => results[`shift:${name}`]?.metrics || model?.metrics?.shift?.[name] || null
  const gap = generalizationGap(holdoutMetrics?.accuracy, shiftSets.map((n) => shiftMetricsOf(n)?.accuracy))

  const errorTable = (predictions) => {
    const errors = predictions.filter((p) => p.actual !== p.predicted)
    if (!errors.length) return <Alert type="success" showIcon message={t('aiLab.errors.none')} />
    return (
      <>
        <div className="ailab-errors-head">{t('aiLab.errors.countRows', { count: errors.length })}</div>
        <Table
          size="small"
          rowKey="id"
          dataSource={errors}
          pagination={{ pageSize: 8, size: 'small' }}
          scroll={{ x: true }}
          expandable={{
            expandedRowRender: (p) => <div className="ailab-muted">{t('aiLab.errors.explain')}: {p.explain}</div>,
            onExpand: (open, p) => { if (open) recordEvent('error.view', { model_id: model.id, sample_id: p.id, actual: p.actual, predicted: p.predicted }) }
          }}
          columns={[
            { title: t('aiLab.errors.actual'), dataIndex: 'actual', render: (v) => <Tag color="green">{labelOf(v)}</Tag> },
            { title: t('aiLab.errors.predicted'), dataIndex: 'predicted', render: (v) => <Tag color="red">{labelOf(v)}</Tag> },
            ...columns.map((c) => ({ title: c.label, render: (_, p) => String(p.payload?.[c.key] ?? '—') }))
          ]}
        />
      </>
    )
  }

  return (
    <div className="ailab-evaluate">
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('aiLab.evaluate.selectVersion')}</span>
        <Select value={model?.id} onChange={setModelId} style={{ width: 260 }} options={tableModels.map((m) => ({ value: m.id, label: `${t('aiLab.version', { version: m.version })} · ${t(`aiLab.engine.${m.engine}`)}` }))} />
        {gap !== null && <Tag color={gap > 0.15 ? 'red' : gap > 0.05 ? 'orange' : 'green'}>{t('aiLab.evaluate.gap', { value: formatPercent(gap) })}</Tag>}
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Tabs
        defaultActiveKey={defaultTab}
        items={[
          {
            key: 'holdout',
            label: t('aiLab.evaluate.holdoutTab', { count: holdoutTotal }),
            children: (
              <div>
                <Space style={{ marginBottom: 12 }} wrap>
                  <Button type="primary" icon={<ExperimentOutlined />} onClick={() => runTest('holdout')} loading={running === 'holdout'} disabled={!canEdit || !holdoutTotal || !!running}>{t('aiLab.evaluate.runHoldout')}</Button>
                  <Text type="secondary">{t('aiLab.evaluate.holdoutHintRows')}</Text>
                </Space>
                <MetricsView unit="row" metrics={holdoutMetrics} labelOf={labelOf} title={t('aiLab.split.holdout')} />
                {results.holdout && <><Divider />{errorTable(results.holdout.predictions)}</>}
              </div>
            )
          },
          {
            key: 'shift',
            label: t('aiLab.evaluate.shiftTab', { count: shiftSets.length }),
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.evaluate.shiftIntroRows')} />
                <Space wrap style={{ marginBottom: 12 }}>
                  <span>{t('aiLab.evaluate.chooseShiftSet')}</span>
                  <Select value={shiftSet} onChange={setShiftSet} style={{ width: 200 }} options={shiftSets.map((s) => ({ value: s, label: `${s} (${shiftTotal(s)})` }))} placeholder={t('aiLab.evaluate.noShiftSets')} />
                  <Button type="primary" onClick={() => runTest('shift', shiftSet)} loading={!!running && running !== 'holdout'} disabled={!canEdit || !shiftSet || !!running}>{t('aiLab.evaluate.runShift')}</Button>
                </Space>
                {shiftSet && (
                  <>
                    <MetricsView unit="row" metrics={shiftMetricsOf(shiftSet)} labelOf={labelOf} title={`${t('aiLab.split.shift')} · ${shiftSet}`} />
                    {holdoutMetrics && shiftMetricsOf(shiftSet) && <div className="ailab-gap-line">{t('aiLab.evaluate.gapLine', { holdout: formatPercent(holdoutMetrics.accuracy), shift: formatPercent(shiftMetricsOf(shiftSet).accuracy) })}</div>}
                    {results[`shift:${shiftSet}`] && <><Divider />{errorTable(results[`shift:${shiftSet}`].predictions)}</>}
                  </>
                )}
              </div>
            )
          }
        ]}
      />
    </div>
  )
}

export default TableEvaluatePanel
