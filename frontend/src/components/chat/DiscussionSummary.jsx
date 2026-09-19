import React, { useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import './DiscussionSummary.less'

// Reuses chat generation/billing and the existing answer download. Does not transfer data.
export default function DiscussionSummary({ available, disabled, onSummarize }) {
  const { t } = useTranslation()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  if (!available) return null
  const summarize = async () => {
    if (lock.current || disabled) return
    lock.current = true
    setBusy(true); setFailure(null)
    try { await onSummarize(t('chat.summary.request')) }
    catch (error) {
      const reason = [400, 409, 413].includes(error.response?.status) ? error.response?.data?.message : null
      setFailure({ reason })
    }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="discussion-summary">
    <div className="discussion-summary-row">
      <div className="discussion-summary-copy">
        <strong>{t('chat.summary.title')}</strong>
        <span>{t('chat.summary.hint')}</span>
      </div>
      <Button aria-label={t('chat.summary.action')} icon={<FileTextOutlined aria-hidden="true" />} disabled={disabled || busy} loading={busy} onClick={summarize}>
        {t('chat.summary.action')}
      </Button>
    </div>
    {failure && <Alert showIcon type="error" message={failure.reason ? t('chat.summary.failedDetail', { reason: failure.reason }) : t('chat.summary.failed')} />}
  </div>
}
