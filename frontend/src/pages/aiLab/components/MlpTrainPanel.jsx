/**
 * 表格神经网络训练面板（M3）：同一批训练行训练一个小 MLP，展示损失曲线，保存为版本与决策树对照
 */
import React, { useMemo, useState } from 'react'
import { Button, Space, Input, Alert, Tag, Segmented, Typography, Progress, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { trainMlp, predictMlp, serializeMlp, DEFAULT_MLP } from '../engine/tabular/mlp'
import { computeMetrics, formatPercent } from '../engine/metrics'
import { toRows } from './TablePanel'
import LossCurve from './LossCurve'

const { Text } = Typography

const MlpTrainPanel = ({ dataset, samples, models, canEdit, config }) => {
  const { t } = useTranslation()
  const { saveModel, recordEvent } = useAiLabStore()
  const columns = (dataset?.columns || []).filter((c) => c.type !== 'text')
  const rows = useMemo(() => toRows(samples, 'train'), [samples])
  const [hidden, setHidden] = useState(config?.hidden || DEFAULT_MLP.hidden)
  const [epochs, setEpochs] = useState(config?.epochs || DEFAULT_MLP.epochs)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState(models.filter((m) => m.engine === 'table-mlp').slice(-1)[0]?.params?.history || [])
  const present = new Set(rows.map((r) => r.label))
  const mlpModels = models.filter((m) => m.engine === 'table-mlp')

  const handleTrain = async () => {
    if (present.size < 2) { message.warning(t('aiLab.train.needTwoClasses')); return }
    setBusy(true); setProgress(0); setHistory([])
    const started = Date.now()
    try {
      const live = []
      const mlp = await trainMlp(rows, columns, { hidden, epochs, onEpoch: (e, total, logs) => { live.push({ epoch: e, loss: logs.loss, acc: logs.acc ?? logs.accuracy }); setHistory([...live]); setProgress(Math.round((e / total) * 100)) } })
      const preds = rows.map((r) => ({ id: r.id, actual: r.label, predicted: predictMlp(mlp, r.payload).label, confidence: 1 }))
      const trainAcc = computeMetrics(preds, mlp.classKeys).accuracy
      const model = await saveModel({
        dataset_id: dataset.id, dataset_version: dataset.version, engine: 'table-mlp', feature_extractor: 'none',
        params: { hidden, epochs, learning_rate: mlp.learningRate, seed: mlp.seed, input_dim: mlp.encoder.dim, train_accuracy: trainAcc, final_loss: mlp.history[mlp.history.length - 1]?.loss, history: mlp.history.filter((_, i) => i % Math.max(1, Math.floor(mlp.history.length / 40)) === 0 || i === mlp.history.length - 1) },
        class_keys: mlp.classKeys, train_sample_count: rows.length,
        artifact: serializeMlp(mlp, { dataset_version: dataset.version }), note: note.trim() || undefined
      }, mlp)
      recordEvent('train.run', { model_id: model.id, version: model.version, engine: 'table-mlp', dataset_version: dataset.version, train_sample_count: rows.length, hidden, epochs, train_accuracy: trainAcc, final_loss: mlp.history[mlp.history.length - 1]?.loss, duration_ms: Date.now() - started, note: note.trim() || undefined })
      setNote('')
      message.success(t('aiLab.train.done', { version: model.version }))
    } catch (err) {
      console.error('mlp training failed:', err)
      message.error(t('aiLab.train.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ailab-mlp-train">
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.mlp.intro')} />
      {!dataset?.locked_at && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('aiLab.train.lockFirst')} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <span>{t('aiLab.mlp.hidden')}</span>
        <Segmented size="small" value={hidden} onChange={setHidden} disabled={!canEdit} options={[4, 8, 16, 32].map((v) => ({ value: v, label: String(v) }))} />
        <span>{t('aiLab.mlp.epochs')}</span>
        <Segmented size="small" value={epochs} onChange={setEpochs} disabled={!canEdit} options={[20, 40, 80, 160].map((v) => ({ value: v, label: String(v) }))} />
        <Text type="secondary" className="ailab-muted">{t('aiLab.mlp.paramsHint')}</Text>
      </Space>
      {canEdit && models.length > 0 && <Input.TextArea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('aiLab.train.notePlaceholder', { version: models.length + 1 })} style={{ marginBottom: 12 }} />}
      <Space wrap>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleTrain} loading={busy} disabled={!canEdit || present.size < 2 || !dataset?.locked_at}>{t('aiLab.mlp.trainVersion', { version: (models?.length || 0) + 1 })}</Button>
        {busy && <Progress percent={progress} size="small" style={{ width: 200 }} />}
        <Text type="secondary">{t('aiLab.tree.rowsUsed', { count: rows.length })}</Text>
      </Space>
      {history.length > 0 && <LossCurve history={history} />}
      {mlpModels.length > 0 && !busy && (
        <Space wrap style={{ marginTop: 8 }}>
          {mlpModels.slice(-3).map((m) => <Tag key={m.id}>{t('aiLab.version', { version: m.version })} · {t('aiLab.mlp.summary', { hidden: m.params?.hidden, epochs: m.params?.epochs, acc: formatPercent(m.params?.train_accuracy) })}</Tag>)}
        </Space>
      )}
    </div>
  )
}

export default MlpTrainPanel
