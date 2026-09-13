/**
 * 模型卡：学生用自己的话写"这个模型能用在哪、不能用在哪、依据是什么"；指标由系统填
 */
import React, { useEffect, useState } from 'react'
import { Form, Input, Button, Select, Space, message, Descriptions } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { formatPercent } from '../engine/metrics'

const ModelCardForm = ({ models, canEdit }) => {
  const { t } = useTranslation()
  const { updateModel, recordEvent } = useAiLabStore()
  const [modelId, setModelId] = useState(models[models.length - 1]?.id)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const model = models.find((m) => m.id === modelId) || models[models.length - 1]

  useEffect(() => {
    if (model) form.setFieldsValue({ scope: '', not_scope: '', evidence: '', notes: '', ...(model.model_card || {}) })
    // 表单初始化不依赖 t，避免语言切换覆盖未提交输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id])

  if (!models.length) return null

  const save = async (values) => {
    setSaving(true)
    try {
      await updateModel(model.id, { model_card: values })
      recordEvent('model_card.write', { model_id: model.id, version: model.version, ...values })
      message.success(t('aiLab.modelCard.saved'))
    } catch (err) {
      message.error(t('aiLab.modelCard.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <span>{t('aiLab.evaluate.selectVersion')}</span>
        <Select value={model?.id} onChange={setModelId} style={{ width: 200 }} options={models.map((m) => ({ value: m.id, label: t('aiLab.version', { version: m.version }) }))} />
      </Space>
      <Descriptions size="small" column={3} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label={t('aiLab.compare.trainCount')}>{model.train_sample_count}</Descriptions.Item>
        <Descriptions.Item label={t('aiLab.split.holdout')}>{formatPercent(model.metrics?.holdout?.accuracy)}</Descriptions.Item>
        <Descriptions.Item label={t('aiLab.compare.gap')}>{formatPercent(model.metrics?.generalization_gap)}</Descriptions.Item>
      </Descriptions>
      <Form form={form} layout="vertical" onFinish={save} disabled={!canEdit}>
        <Form.Item name="scope" label={t('aiLab.modelCard.scope')} rules={[{ required: true, message: t('aiLab.modelCard.required') }]}>
          <Input.TextArea rows={2} maxLength={300} placeholder={t('aiLab.modelCard.scopePlaceholder')} />
        </Form.Item>
        <Form.Item name="not_scope" label={t('aiLab.modelCard.notScope')} rules={[{ required: true, message: t('aiLab.modelCard.required') }]}>
          <Input.TextArea rows={2} maxLength={300} placeholder={t('aiLab.modelCard.notScopePlaceholder')} />
        </Form.Item>
        <Form.Item name="evidence" label={t('aiLab.modelCard.evidence')}>
          <Input.TextArea rows={2} maxLength={300} placeholder={t('aiLab.modelCard.evidencePlaceholder')} />
        </Form.Item>
        <Form.Item name="notes" label={t('aiLab.modelCard.notes')}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
        {canEdit && <Button type="primary" htmlType="submit" loading={saving}>{t('aiLab.modelCard.save')}</Button>}
      </Form>
    </div>
  )
}

export default ModelCardForm
