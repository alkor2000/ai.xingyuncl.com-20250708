/**
 * 预测卡：动手前先写下"你觉得会怎样"，保存到项目上下文并记一条 predict.write 事实。
 * 学术上这是"预测—观察—解释"：一旦训练出模型，预测就锁定不能再改（否则可以事后改成"我早就猜到了"）；
 * 之后出现第二个框"看到结果后，你的想法"，存到 context.prediction_reflection，记 reflection.write。
 */
import React, { useEffect, useState } from 'react'
import { Input, Button, Space, Tag, message, Typography } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const { Text, Paragraph } = Typography

const PredictionCard = ({ project, prompt, canEdit, locked = false }) => {
  const { t } = useTranslation()
  const { updateProject, recordEvent } = useAiLabStore()
  const [text, setText] = useState(project?.context?.prediction || '')
  const [reflection, setReflection] = useState(project?.context?.prediction_reflection || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setText(project?.context?.prediction || ''); setReflection(project?.context?.prediction_reflection || '') }, [project?.id])

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
  const saveReflection = async () => {
    setSaving(true)
    try {
      await updateProject({ context: { ...(project.context || {}), prediction_reflection: reflection.trim() } })
      recordEvent('reflection.write', { step: 'predict', text: reflection.trim() })
      message.success(t('aiLab.predict.reflectionSaved'))
    } catch (err) {
      message.error(t('aiLab.predict.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const saved = project?.context?.prediction || ''
  if (locked) {
    return (
      <div>
        <Text>{prompt}</Text>
        <div className="ailab-prediction-locked">
          <Tag icon={<LockOutlined />} color="blue">{t('aiLab.predict.locked')}</Tag>
          <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{saved || <Text type="secondary">{t('aiLab.predict.none')}</Text>}</Paragraph>
        </div>
        <Text strong>{t('aiLab.predict.reflectionPrompt')}</Text>
        <Input.TextArea rows={3} maxLength={500} value={reflection} onChange={(e) => setReflection(e.target.value)} disabled={!canEdit} style={{ margin: '8px 0' }} placeholder={t('aiLab.predict.reflectionPlaceholder')} />
        {canEdit && <Space><Button type="primary" onClick={saveReflection} loading={saving} disabled={!reflection.trim()}>{t('aiLab.predict.saveReflection')}</Button></Space>}
      </div>
    )
  }

  return (
    <div>
      <Text>{prompt}</Text>
      <Input.TextArea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} style={{ margin: '8px 0' }} placeholder={t('aiLab.predict.placeholder')} />
      {canEdit && <Space><Button type="primary" onClick={save} loading={saving} disabled={!text.trim()}>{t('aiLab.predict.save')}</Button><Text type="secondary" className="ailab-muted">{t('aiLab.predict.lockHint')}</Text></Space>}
    </div>
  )
}

export default PredictionCard
