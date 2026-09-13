/**
 * 预测卡：动手前先写下"你觉得会怎样"，保存到项目上下文并记一条 predict.write 事实
 */
import React, { useEffect, useState } from 'react'
import { Input, Button, Space, message, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const { Text } = Typography

const PredictionCard = ({ project, prompt, canEdit }) => {
  const { t } = useTranslation()
  const { updateProject, recordEvent } = useAiLabStore()
  const [text, setText] = useState(project?.context?.prediction || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setText(project?.context?.prediction || '') }, [project?.id])

  const save = async () => {
    setSaving(true)
    try {
      await updateProject({ context: { ...(project.context || {}), prediction: text.trim() } })
      recordEvent('predict.write', { text: text.trim() })
      message.success(t('aiLab.predict.saved'))
    } catch (err) {
      message.error(t('aiLab.predict.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Text>{prompt}</Text>
      <Input.TextArea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} style={{ margin: '8px 0' }} placeholder={t('aiLab.predict.placeholder')} />
      {canEdit && <Space><Button type="primary" onClick={save} loading={saving} disabled={!text.trim()}>{t('aiLab.predict.save')}</Button></Space>}
    </div>
  )
}

export default PredictionCard
