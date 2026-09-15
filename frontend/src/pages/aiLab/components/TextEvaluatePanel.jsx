/**
 * 文本测试面板：对朴素贝叶斯版本跑留出集 / 换条件集，错误句子展开可见"哪些词把它推错了"
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Space, Tabs, Alert, Tag, Table, Typography, Divider, message } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { predictNaiveBayes, deserializeNaiveBayes } from '../engine/text/naiveBayes'
import { computeMetrics, formatPercent, generalizationGap } from '../engine/metrics'
import MetricsView from './MetricsView'

const { Text } = Typography

const TextEvaluatePanel = ({ dataset, models, labelOf, canEdit, defaultTab = 'holdout' }) => {
  const { t } = useTranslation()
  const { fetchSamples, loadLiveModel, saveEvaluation, recordEvent, evalResults, setEvalResult } = useAiLabStore()
  const textModels = useMemo(() => models.filter((m) => m.engine === 'text-nb'), [models])
  const [modelId, setModelId] = useState(null)
  const [running, setRunning] = useState(null)
  const [shiftSet, setShiftSet] = useState(null)
  const [error, setError] = useState(null)
  const model = useMemo(() => textModels.find((m) => m.id === modelId) || textModels[textModels.length - 1], [textModels, modelId])
  const results = (model && evalResults[model.id]) || {}
  useEffect(() => { if (model && modelId !== model.id) setModelId(model.id) }, [model, modelId])
  useEffect(() => { const latest = textModels[textModels.length - 1]; if (latest) setModelId(latest.id) }, [textModels.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const shiftSets = useMemo(() => Object.keys(dataset?.counts?.shift || {}), [dataset])
  useEffect(() => { if (!shiftSet && shiftSets.length) setShiftSet(shiftSets[0]) }, [shiftSets, shiftSet])
  const holdoutTotal = Object.values(dataset?.counts?.holdout || {}).reduce((a, b) => a + b, 0)
  const shiftTotal = (name) => Object.values(dataset?.counts?.shift?.[name] || {}).reduce((a, b) => a + b, 0)

  const runTest = async (split, setName) => {
    if (!model) return
    setError(null)
    setRunning(split === 'holdout' ? 'holdout' : setName)
    try {
      const live = await loadLiveModel(model.id, deserializeNaiveBayes)
      const samples = await fetchSamples(dataset.id, split === 'holdout' ? { split: 'holdout' } : { split: 'shift', shift_set: setName })
      const trainIds = new Set(live.ids || [])
      const testable = samples.filter((s) => !trainIds.has(s.id))
      if (!testable.length) { message.warning(t('aiLab.evaluate.noSamples')); return }
      const predictions = testable.map((s) => {
        const r = predictNaiveBayes(live, s.payload?.text || '')
        return { id: s.id, actual: s.class_key, predicted: r.label, confidence: r.confidence, text: s.payload?.text || '', contributions: r.contributions.slice(0, 6) }
      })
      const metrics = computeMetrics(predictions, live.classKeys)
      const errors = predictions.filter((p) => p.actual !== p.predicted).slice(0, 200).map(({ id, actual, predicted, confidence }) => ({ sample_id: id, actual, predicted, confidence }))
      await saveEvaluation(model.id, { split, shift_set: split === 'shift' ? setName : undefined, sample_count: predictions.length, metrics, errors })
      recordEvent('test.run', { model_id: model.id, version: model.version, engine: 'text-nb', split, shift_set: split === 'shift' ? setName : undefined, sample_count: predictions.length, accuracy: metrics.accuracy, error_count: errors.length })
      setEvalResult(model.id, split === 'holdout' ? 'holdout' : `shift:${setName}`, { metrics, predictions })
    } catch (err) {
      console.error('text evaluation failed:', err)
      setError(err.message)
      message.error(t('aiLab.evaluate.failed'))
    } finally {
      setRunning(null)
    }
  }

  if (!textModels.length) return <Alert type="info" showIcon message={t('aiLab.evaluate.noModel')} />
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
          size="small" rowKey="id" dataSource={errors} pagination={{ pageSize: 8, size: 'small' }}
          expandable={{
            expandedRowRender: (p) => (
              <div className="ailab-muted">
                {t('aiLab.text.pushedBy')}：
                {p.contributions.map((c) => <span key={c.token} className={`ailab-token ${c.weight > 0 ? 'pro' : 'con'}`}>{c.token} {c.weight > 0 ? '+' : ''}{c.weight.toFixed(2)}</span>)}
              </div>
            ),
            onExpand: (open, p) => { if (open) recordEvent('error.view', { model_id: model.id, sample_id: p.id, actual: p.actual, predicted: p.predicted }) }
          }}
          columns={[
            { title: t('aiLab.text.textCol'), dataIndex: 'text' },
            { title: t('aiLab.errors.actual'), dataIndex: 'actual', width: 90, render: (v) => <Tag color="green">{labelOf(v)}</Tag> },
            { title: t('aiLab.errors.predicted'), dataIndex: 'predicted', width: 90, render: (v) => <Tag color="red">{labelOf(v)}</Tag> },
            { title: t('aiLab.text.confidence'), dataIndex: 'confidence', width: 80, render: (v) => formatPercent(v) }
          ]}
        />
      </>
    )
  }

  return (
    <div className="ailab-evaluate">
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('aiLab.evaluate.selectVersion')}</span>
        <Select value={model?.id} onChange={setModelId} style={{ width: 200 }} options={textModels.map((m) => ({ value: m.id, label: t('aiLab.version', { version: m.version }) }))} />
        {gap !== null && <Tag color={gap > 0.15 ? 'red' : gap > 0.05 ? 'orange' : 'green'}>{t('aiLab.evaluate.gap', { value: formatPercent(gap) })}</Tag>}
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Tabs defaultActiveKey={defaultTab} items={[
        { key: 'holdout', label: t('aiLab.evaluate.holdoutTab', { count: holdoutTotal }), children: (
          <div>
            <Space style={{ marginBottom: 12 }} wrap>
              <Button type="primary" icon={<ExperimentOutlined />} onClick={() => runTest('holdout')} loading={running === 'holdout'} disabled={!canEdit || !holdoutTotal || !!running}>{t('aiLab.evaluate.runHoldout')}</Button>
              <Text type="secondary">{t('aiLab.text.holdoutHint')}</Text>
            </Space>
            <MetricsView unit="sentence" metrics={holdoutMetrics} labelOf={labelOf} title={t('aiLab.split.holdout')} />
            {results.holdout && <><Divider />{errorTable(results.holdout.predictions)}</>}
          </div>
        ) },
        { key: 'shift', label: t('aiLab.evaluate.shiftTab', { count: shiftSets.length }), children: (
          <div>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.text.shiftIntro')} />
            <Space wrap style={{ marginBottom: 12 }}>
              <span>{t('aiLab.evaluate.chooseShiftSet')}</span>
              <Select value={shiftSet} onChange={setShiftSet} style={{ width: 240 }} options={shiftSets.map((s) => ({ value: s, label: `${s} (${shiftTotal(s)})` }))} placeholder={t('aiLab.evaluate.noShiftSets')} />
              <Button type="primary" onClick={() => runTest('shift', shiftSet)} loading={!!running && running !== 'holdout'} disabled={!canEdit || !shiftSet || !!running}>{t('aiLab.evaluate.runShift')}</Button>
            </Space>
            {shiftSet && (
              <>
                <MetricsView unit="sentence" metrics={shiftMetricsOf(shiftSet)} labelOf={labelOf} title={`${t('aiLab.split.shift')} · ${shiftSet}`} />
                {holdoutMetrics && shiftMetricsOf(shiftSet) && <div className="ailab-gap-line">{t('aiLab.evaluate.gapLine', { holdout: formatPercent(holdoutMetrics.accuracy), shift: formatPercent(shiftMetricsOf(shiftSet).accuracy) })}</div>}
                {results[`shift:${shiftSet}`] && <><Divider />{errorTable(results[`shift:${shiftSet}`].predictions)}</>}
              </>
            )}
          </div>
        ) }
      ]} />
    </div>
  )
}

export default TextEvaluatePanel
