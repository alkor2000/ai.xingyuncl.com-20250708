/**
 * 训练面板：加载特征提取器 → 嵌入全部训练样本 → 训练 kNN → 保存为一个模型版本
 * 训练全程在浏览器内完成；服务器只保存嵌入向量（artifact）与元数据。
 */
import React, { useState } from 'react'
import { Button, Progress, Alert, Input, Space, Tag, Typography, Radio, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { loadExtractor, embedImages, FEATURE_EXTRACTOR_ID, getBackendName } from '../engine/featureExtractor'
import { loadImageElement } from '../engine/imageUtils'
import { trainKnn, serializeKnn, DEFAULT_K } from '../engine/knn'

const { Text } = Typography

/**
 * perClassLimits：给出时显示"每类用多少张"选项（L4 实验），训练只取每类前 N 张（按 id 排序，确定性）
 * extraParams：并入 params 与 train.run 事实的附加信息（如当前错标数量）
 */
const TrainPanel = ({ dataset, models, minPerClass, canEdit, perClassLimits, extraParams }) => {
  const { t } = useTranslation()
  const { fetchSamples, saveModel, recordEvent, extractor, setExtractor } = useAiLabStore()
  const [stage, setStage] = useState('idle') // idle | model | embed | save
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [perClassLimit, setPerClassLimit] = useState(perClassLimits?.[0] || 'all')

  const classes = dataset?.classes || []
  const trainCounts = dataset?.counts?.train || {}
  const readyClasses = classes.filter((c) => (trainCounts[c.key] || 0) > 0)
  const shortClasses = classes.filter((c) => (trainCounts[c.key] || 0) < minPerClass)
  const nextVersion = (models?.length || 0) + 1

  const ensureExtractor = async () => {
    if (extractor.status === 'ready') return
    setExtractor({ status: 'loading', progress: 0, error: null })
    try {
      await loadExtractor((f) => setExtractor({ progress: Math.round(f * 100) }))
      setExtractor({ status: 'ready', progress: 100, backend: getBackendName() })
    } catch (err) {
      setExtractor({ status: 'error', error: err.message })
      throw err
    }
  }

  const handleTrain = async () => {
    setError(null)
    const started = Date.now()
    try {
      setStage('model')
      await ensureExtractor()
      let samples = await fetchSamples(dataset.id, { split: 'train' })
      if (perClassLimits?.length && perClassLimit !== 'all') {
        const taken = {}
        samples = [...samples].sort((a, b) => a.id - b.id).filter((s) => {
          taken[s.class_key] = (taken[s.class_key] || 0) + 1
          return taken[s.class_key] <= perClassLimit
        })
      }
      const present = new Set(samples.map((s) => s.class_key))
      if (present.size < 2) {
        message.warning(t('aiLab.train.needTwoClasses'))
        setStage('idle')
        return
      }
      setStage('embed')
      setProgress(0)
      const images = []
      for (let i = 0; i < samples.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        images.push(await loadImageElement(samples[i].file_url))
      }
      const vectors = await embedImages(images, (done, total) => setProgress(Math.round((done / total) * 100)))
      const knn = trainKnn(samples.map((s, i) => ({ id: s.id, label: s.class_key, vec: vectors[i] })), { k: DEFAULT_K })
      setStage('save')
      const classCounts = {}
      samples.forEach((s) => { classCounts[s.class_key] = (classCounts[s.class_key] || 0) + 1 })
      const model = await saveModel({
        dataset_id: dataset.id,
        dataset_version: dataset.version,
        engine: 'image-knn',
        feature_extractor: FEATURE_EXTRACTOR_ID,
        params: { k: knn.k, metric: 'cosine', ...(perClassLimits?.length && perClassLimit !== 'all' ? { per_class_limit: perClassLimit } : {}), ...(extraParams || {}) },
        class_keys: knn.classKeys,
        train_sample_count: samples.length,
        artifact: serializeKnn(knn, { feature_extractor: FEATURE_EXTRACTOR_ID, dataset_version: dataset.version }),
        note: note.trim() || undefined
      }, knn)
      recordEvent('train.run', {
        model_id: model.id,
        version: model.version,
        dataset_version: dataset.version,
        train_sample_count: samples.length,
        class_counts: classCounts,
        k: knn.k,
        per_class_limit: perClassLimits?.length && perClassLimit !== 'all' ? perClassLimit : undefined,
        ...(extraParams || {}),
        duration_ms: Date.now() - started,
        note: note.trim() || undefined
      })
      setNote('')
      message.success(t('aiLab.train.done', { version: model.version }))
    } catch (err) {
      console.error('training failed:', err)
      setError(err.message)
      message.error(t('aiLab.train.failed'))
    } finally {
      setStage('idle')
    }
  }

  const busy = stage !== 'idle'
  return (
    <div className="ailab-train">
      <div className="ailab-train-status">
        <Space wrap>
          <Tag color={extractor.status === 'ready' ? 'green' : extractor.status === 'error' ? 'red' : 'default'}>
            {t(`aiLab.train.extractor.${extractor.status}`)}
          </Tag>
          {extractor.backend && <Tag>{t('aiLab.train.backend', { backend: extractor.backend })}</Tag>}
          <Text type="secondary">{t('aiLab.train.localOnly')}</Text>
        </Space>
        {extractor.status === 'loading' && <Progress percent={extractor.progress} size="small" />}
      </div>
      {shortClasses.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('aiLab.train.shortClasses', { min: minPerClass, classes: shortClasses.map((c) => c.label).join('、') })}
        />
      )}
      {!dataset?.locked_at && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('aiLab.train.lockFirst')} />
      )}
      {perClassLimits?.length > 0 && (
        <div className="ailab-field">
          <label>{t('aiLab.train.perClassLimit')}</label>
          <Radio.Group value={perClassLimit} onChange={(e) => setPerClassLimit(e.target.value)} optionType="button" size="small" disabled={!canEdit}
            options={[...perClassLimits.map((v) => ({ value: v, label: String(v) })), { value: 'all', label: t('aiLab.preset.perClassAll') }]} />
          <span className="ailab-muted" style={{ marginLeft: 8 }}>{t('aiLab.train.perClassLimitHint')}</span>
        </div>
      )}
      {nextVersion > 1 && canEdit && (
        <Input.TextArea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('aiLab.train.notePlaceholder', { version: nextVersion })}
          style={{ marginBottom: 12 }}
        />
      )}
      <Space>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleTrain}
          loading={busy}
          disabled={!canEdit || readyClasses.length < 2 || !dataset?.locked_at}
        >
          {busy ? t(`aiLab.train.stage.${stage}`) : t('aiLab.train.trainVersion', { version: nextVersion })}
        </Button>
        {stage === 'embed' && <Progress percent={progress} size="small" style={{ width: 200 }} />}
      </Space>
      {error && <Alert type="error" showIcon style={{ marginTop: 12 }} message={error} />}
    </div>
  )
}

export default TrainPanel
