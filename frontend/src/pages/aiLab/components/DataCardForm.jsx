/**
 * 数据卡：采集之前先规划——要解决什么问题、认哪些类别、在什么条件下采多少、可能哪里不公平
 * 保存到 project.context.data_card，记一条 data_card.write 事实
 */
import React, { useEffect, useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const FIELDS = ['goal', 'classes', 'plan', 'risks']

const DataCardForm = ({ project, canEdit }) => {
  const { t } = useTranslation()
  const { updateProject, recordEvent } = useAiLabStore()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    form.setFieldsValue({ goal: '', classes: '', plan: '', risks: '', ...(project?.context?.data_card || {}) })
    // 表单初始化不依赖 t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const save = async (values) => {
    setSaving(true)
    try {
      await updateProject({ context: { ...(project.context || {}), data_card: values } })
      recordEvent('data_card.write', values)
      message.success(t('aiLab.dataCard.saved'))
    } catch (err) {
      message.error(t('aiLab.dataCard.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={save} disabled={!canEdit}>
      {FIELDS.map((f) => (
        <Form.Item key={f} name={f} label={t(`aiLab.dataCard.${f}`)} rules={f === 'goal' || f === 'plan' ? [{ required: true, message: t('aiLab.modelCard.required') }] : []}>
          <Input.TextArea rows={2} maxLength={400} placeholder={t(`aiLab.dataCard.${f}Placeholder`)} />
        </Form.Item>
      ))}
      {canEdit && <Button type="primary" htmlType="submit" loading={saving}>{t('aiLab.dataCard.save')}</Button>}
    </Form>
  )
}

export default DataCardForm
