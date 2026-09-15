/**
 * 测试面板：对选定版本跑留出测试集与换条件测试集，展示指标、混淆矩阵与错误样本
 * 留出集在训练前锁定，学生第一次看到这些图就是在这里。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Space, Tabs, Alert, Progress, Tag, Typography, Divider, message } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { imageModality } from '../engine/modalities'
import AudioCapturePanel from './AudioCapturePanel'
import SubgroupTable from './SubgroupTable'
import { predictKnn, deserializeKnn } from '../engine/knn'
import { computeMetrics, formatPercent, generalizationGap } from '../engine/metrics'
import MetricsView from './MetricsView'
import ErrorGallery from './ErrorGallery'
import CapturePanel from './CapturePanel'

const { Text } = Typography

const EvaluatePanel = ({ dataset, models, labelOf, canEdit, defaultTab = 'holdout', modality = imageModality, subgroupTag }) => {
  const { t } = useTranslation()
  const { fetchSamples, loadLiveModel, saveEvaluation, recordEvent, uploadSamples, setExtractor, extractor, liveModels, evalResults, setEvalResult } = useAiLabStore()
  const [modelId, setModelId] = useState(null)
  const [running, setRunning] = useState(null) // 'holdout' | shift set name
  const [progress, setProgress] = useState(0)
  const [shiftSet, setShiftSet] = useState(null)
  const [error, setError] = useState(null)

  const model = useMemo(() => models.find((m) => m.id === modelId) || models[models.length - 1], [models, modelId])
  const results = (model && evalResults[model.id]) || {}
  useEffect(() => { if (model && modelId !== model.id) setModelId(model.id) }, [model, modelId])
  /* 训练出新版本后自动切到最新版，学生接着测的就是刚训练的那一版 */
  useEffect(() => { const latest = models[models.length - 1]; if (latest) setModelId(latest.id) }, [models.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const shiftSets = useMemo(() => Object.keys(dataset?.counts?.shift || {}), [dataset])
  useEffect(() => { if (!shiftSet && shiftSets.length) setShiftSet(shiftSets[0]) }, [shiftSets, shiftSet])

  const holdoutTotal = Object.values(dataset?.counts?.holdout || {}).reduce((a, b) => a + b, 0)
  const shiftTotal = (name) => Object.values(dataset?.counts?.shift?.[name] || {}).reduce((a, b) => a + b, 0)

  const runTest = async (split, setName) => {
    if (!model) return
    setError(null)
    setRunning(split === 'holdout' ? 'holdout' : setName)
    setProgress(0)
    try {
      if (extractor.status !== 'ready') {
        setExtractor({ status: 'loading', progress: 0 })
        await modality.load((f) => setExtractor({ progress: Math.round(f * 100) }))
        setExtractor({ status: 'ready', progress: 100, backend: modality.backendName() })
      }
      const live = await loadLiveModel(model.id, deserializeKnn)
      const params = split === 'holdout' ? { split: 'holdout' } : { split: 'shift', shift_set: setName }
      const samples = await fetchSamples(dataset.id, params)
      const trainIds = new Set(live.ids)
      const testable = samples.filter((s) => !trainIds.has(s.id))
      if (!testable.length) {
        message.warning(t('aiLab.evaluate.noSamples'))
        return
      }
      const vectors = await modality.embedSamples(testable, (d, tot) => setProgress(Math.round((d / tot) * 100)))
      const predictions = testable.map((s, i) => {
        const r = predictKnn(live, vectors[i])
        return { id: s.id, actual: s.class_key, predicted: r.label, confidence: r.confidence, file_url: s.file_url, condition_tags: s.condition_tags || {} }
      })
      const metrics = computeMetrics(predictions, live.classKeys)
      const errors = predictions.filter((p) => p.actual !== p.predicted).slice(0, 200)
        .map(({ id, actual, predicted, confidence }) => ({ sample_id: id, actual, predicted, confidence }))
      await saveEvaluation(model.id, {
        split,
        shift_set: split === 'shift' ? setName : undefined,
        sample_count: predictions.length,
        metrics,
        errors
      })
      recordEvent('test.run', {
        model_id: model.id,
        version: model.version,
        split,
        shift_set: split === 'shift' ? setName : undefined,
        sample_count: predictions.length,
        accuracy: metrics.accuracy,
        error_count: errors.length
      })
      setEvalResult(model.id, split === 'holdout' ? 'holdout' : `shift:${setName}`, { metrics, predictions })
    } catch (err) {
      console.error('evaluation failed:', err)
      setError(err.message)
      message.error(t('aiLab.evaluate.failed'))
    } finally {
      setRunning(null)
    }
  }

  const holdoutMetrics = results.holdout?.metrics || model?.metrics?.holdout || null
  const shiftMetricsOf = (name) => results[`shift:${name}`]?.metrics || model?.metrics?.shift?.[name] || null
  const gap = generalizationGap(holdoutMetrics?.accuracy, shiftSets.map((n) => shiftMetricsOf(n)?.accuracy))
  const live = model ? liveModels[model.id] : null

  const onErrorView = (p, withHeatmap) => {
    recordEvent('error.view', { model_id: model.id, sample_id: p.id, actual: p.actual, predicted: p.predicted, heatmap: withHeatmap })
  }

  if (!models.length) return <Alert type="info" showIcon message={t('aiLab.evaluate.noModel')} />

  const shiftUpload = async (blobs, meta) => {
    const created = await uploadSamples(dataset.id, blobs, meta)
    recordEvent('dataset.add', { dataset_id: dataset.id, split: 'shift', shift_set: meta.shift_set, class_key: meta.class_key, count: created.length, condition_tags: meta.condition_tags, source: meta.source })
    if (meta.shift_set) setShiftSet(meta.shift_set)
  }

  return (
    <div className="ailab-evaluate">
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('aiLab.evaluate.selectVersion')}</span>
        <Select
          value={model?.id}
          onChange={setModelId}
          style={{ width: 200 }}
          options={models.map((m) => ({ value: m.id, label: t('aiLab.version', { version: m.version }) }))}
        />
        {gap !== null && (
          <Tag color={gap > 0.15 ? 'red' : gap > 0.05 ? 'orange' : 'green'}>{t('aiLab.evaluate.gap', { value: formatPercent(gap) })}</Tag>
        )}
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
                <Space style={{ marginBottom: 12 }}>
                  <Button type="primary" icon={<ExperimentOutlined />} onClick={() => runTest('holdout')} loading={running === 'holdout'} disabled={!canEdit || !holdoutTotal || !!running}>
                    {t('aiLab.evaluate.runHoldout')}
                  </Button>
                  {running === 'holdout' && <Progress percent={progress} size="small" style={{ width: 200 }} />}
                  <Text type="secondary">{t(modality.id === 'audio' ? 'aiLab.evaluate.holdoutHintAudio' : 'aiLab.evaluate.holdoutHint')}</Text>
                </Space>
                <MetricsView unit={modality.id} metrics={holdoutMetrics} labelOf={labelOf} title={t('aiLab.split.holdout')} />
                {results.holdout && (
                  <>
                    {subgroupTag && <SubgroupTable predictions={results.holdout.predictions} tagKey={subgroupTag} model={model} split="holdout" />}
                    <Divider />
                    <ErrorGallery predictions={results.holdout.predictions} liveModel={live} labelOf={labelOf} onView={onErrorView} modality={modality} />
                  </>
                )}
              </div>
            )
          },
          {
            key: 'shift',
            label: t('aiLab.evaluate.shiftTab', { count: shiftSets.length }),
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t(modality.id === 'audio' ? 'aiLab.evaluate.shiftIntroAudio' : 'aiLab.evaluate.shiftIntro')} />
                {canEdit && modality.id === 'audio' && (
                  <AudioCapturePanel dataset={dataset} classes={dataset?.classes || []} split="shift" shiftSetOptions={shiftSets.map((s) => ({ value: s, label: s }))} onUpload={shiftUpload} />
                )}
                {canEdit && modality.id !== 'audio' && (
                  <CapturePanel
                    dataset={dataset}
                    classes={dataset?.classes || []}
                    split="shift"
                    shiftSetOptions={shiftSets.map((s) => ({ value: s, label: s }))}
                    onUpload={shiftUpload}
                  />
                )}
                <Divider />
                <Space wrap style={{ marginBottom: 12 }}>
                  <span>{t('aiLab.evaluate.chooseShiftSet')}</span>
                  <Select value={shiftSet} onChange={setShiftSet} style={{ width: 200 }} options={shiftSets.map((s) => ({ value: s, label: `${s} (${shiftTotal(s)})` }))} placeholder={t('aiLab.evaluate.noShiftSets')} />
                  <Button type="primary" onClick={() => runTest('shift', shiftSet)} loading={!!running && running !== 'holdout'} disabled={!canEdit || !shiftSet || !!running}>
                    {t('aiLab.evaluate.runShift')}
                  </Button>
                  {running && running !== 'holdout' && <Progress percent={progress} size="small" style={{ width: 200 }} />}
                </Space>
                {shiftSet && (
                  <>
                    <MetricsView unit={modality.id} metrics={shiftMetricsOf(shiftSet)} labelOf={labelOf} title={`${t('aiLab.split.shift')} · ${shiftSet}`} />
                    {holdoutMetrics && shiftMetricsOf(shiftSet) && (
                      <div className="ailab-gap-line">
                        {t('aiLab.evaluate.gapLine', { holdout: formatPercent(holdoutMetrics.accuracy), shift: formatPercent(shiftMetricsOf(shiftSet).accuracy) })}
                      </div>
                    )}
                    {results[`shift:${shiftSet}`] && (
                      <>
                        <Divider />
                        <ErrorGallery predictions={results[`shift:${shiftSet}`].predictions} liveModel={live} labelOf={labelOf} onView={onErrorView} modality={modality} />
                      </>
                    )}
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

export default EvaluatePanel
