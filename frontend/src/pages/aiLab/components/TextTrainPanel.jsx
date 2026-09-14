/**
 * 文本训练面板：训练朴素贝叶斯 → 保存版本 → 展示每类最有代表性的词（模型学到了什么）
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Alert, Input, Space, Tag, Select, Typography, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { trainNaiveBayes, predictNaiveBayes, topTokens, serializeNaiveBayes, deserializeNaiveBayes } from '../engine/text/naiveBayes'
import { computeMetrics, formatPercent } from '../engine/metrics'
import { toTextRows } from './TextPanel'

const { Text } = Typography

const TextTrainPanel = ({ dataset, samples, models, canEdit, labelOf, minPerClass }) => {
  const { t } = useTranslation()
  const { saveModel, loadLiveModel, recordEvent, liveModels } = useAiLabStore()
  const rows = useMemo(() => toTextRows(samples, 'train'), [samples])
  const classes = dataset?.classes || []
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const textModels = models.filter((m) => m.engine === 'text-nb')
  const [selectedId, setSelectedId] = useState(textModels[textModels.length - 1]?.id || null)
  const [live, setLive] = useState(null)
  const selected = textModels.find((m) => m.id === selectedId) || textModels[textModels.length - 1]
  const trainCounts = dataset?.counts?.train || {}
  const shortClasses = classes.filter((c) => (trainCounts[c.key] || 0) < (minPerClass || 10))

  useEffect(() => { if (selected && selectedId !== selected.id) setSelectedId(selected.id) }, [selected, selectedId])
  useEffect(() => {
    let cancelled = false
    if (!selected) { setLive(null); return undefined }
    const cached = liveModels[selected.id]
    if (cached) { setLive(cached); return undefined }
    loadLiveModel(selected.id, deserializeNaiveBayes).then((m) => { if (!cancelled) setLive(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTrain = async () => {
    const present = new Set(rows.map((r) => r.label))
    if (present.size < 2) { message.warning(t('aiLab.train.needTwoClasses')); return }
    setBusy(true)
    const started = Date.now()
    try {
      const nb = trainNaiveBayes(rows)
      const preds = rows.map((r) => ({ id: r.id, actual: r.label, predicted: predictNaiveBayes(nb, r.text).label, confidence: 1 }))
      const trainAcc = computeMetrics(preds, nb.classKeys).accuracy
      const classCounts = {}
      rows.forEach((r) => { classCounts[r.label] = (classCounts[r.label] || 0) + 1 })
      const model = await saveModel({
        dataset_id: dataset.id, dataset_version: dataset.version, engine: 'text-nb', feature_extractor: 'char-ngram',
        params: { alpha: nb.alpha, vocab_size: nb.vocabSize, train_accuracy: trainAcc },
        class_keys: nb.classKeys, train_sample_count: rows.length,
        artifact: serializeNaiveBayes(nb, { dataset_version: dataset.version }), note: note.trim() || undefined
      }, nb)
      recordEvent('train.run', { model_id: model.id, version: model.version, engine: 'text-nb', dataset_version: dataset.version, train_sample_count: rows.length, class_counts: classCounts, vocab_size: nb.vocabSize, train_accuracy: trainAcc, duration_ms: Date.now() - started, note: note.trim() || undefined })
      setSelectedId(model.id); setLive(nb); setNote('')
      message.success(t('aiLab.train.done', { version: model.version }))
    } catch (err) {
      console.error('text training failed:', err)
      message.error(t('aiLab.train.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ailab-text-train">
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.text.trainIntro')} />
      {shortClasses.length > 0 && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.train.shortClasses', { min: minPerClass || 10, classes: shortClasses.map((c) => c.label).join('、') })} />}
      {!dataset?.locked_at && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('aiLab.train.lockFirst')} />}
      {canEdit && models.length > 0 && <Input.TextArea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('aiLab.train.notePlaceholder', { version: models.length + 1 })} style={{ marginBottom: 12 }} />}
      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleTrain} loading={busy} disabled={!canEdit || rows.length < 4 || !dataset?.locked_at}>{t('aiLab.train.trainVersion', { version: (models?.length || 0) + 1 })}</Button>
        <Text type="secondary">{t('aiLab.text.rowsUsed', { count: rows.length })}</Text>
      </Space>
      {textModels.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <span>{t('aiLab.evaluate.selectVersion')}</span>
            <Select size="small" value={selected?.id} onChange={setSelectedId} style={{ width: 160 }} options={textModels.map((m) => ({ value: m.id, label: t('aiLab.version', { version: m.version }) }))} />
            {selected?.params && <Tag>{t('aiLab.text.vocab', { count: selected.params.vocab_size })}</Tag>}
            {typeof selected?.params?.train_accuracy === 'number' && <Tag color="blue">{t('aiLab.rules.trainAccuracyShort', { value: formatPercent(selected.params.train_accuracy) })}</Tag>}
          </Space>
          {live && (
            <div className="ailab-top-tokens">
              <div className="ailab-muted" style={{ marginBottom: 6 }}>{t('aiLab.text.topTokensHint')}</div>
              {live.classKeys.map((c) => (
                <div className="ailab-token-row" key={c}>
                  <Tag color="blue">{labelOf(c)}</Tag>
                  {topTokens(live, c, 12).map((tk) => <span className="ailab-token" key={tk.token} title={`×${tk.count}`}>{tk.token}</span>)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TextTrainPanel
