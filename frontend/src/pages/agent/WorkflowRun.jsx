import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, Segmented, Space, Spin, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import apiClient from '../../utils/api'
import useAgentStore from '../../stores/agentStore'

export default function WorkflowRun() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const executeWorkflow = useAgentStore(state => state.executeWorkflow)
  const [workflow, setWorkflow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('text')
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const inFlight = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setWorkflow(null); setResult(null); setError(''); setInput(''); setRunning(false)
    inFlight.current = false
    apiClient.get(`/agent/workflows/${id}`).then(res => {
      if (!res.data.success) throw new Error(res.data.message)
      if (current === generation.current) setWorkflow(res.data.data)
    }).catch(e => {
      if (current === generation.current) setError(e.response?.data?.message || 'agent.store.workflowDetailLoadFailed')
    }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [id])

  const run = async () => {
    if (inFlight.current || !workflow) return
    let data
    try {
      data = mode === 'json' ? JSON.parse(input || '{}') : { query: input.trim() }
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error()
    } catch { setError('agent.execution.invalidJson'); return }
    inFlight.current = true
    const current = generation.current
    setRunning(true); setResult(null); setError('')
    try {
      const output = await executeWorkflow(id, data)
      if (current === generation.current) setResult(output)
    } catch (e) {
      if (current === generation.current) setError(e.response?.data?.message || 'agent.execution.checkHistoryAfterError')
    } finally {
      if (current === generation.current) { inFlight.current = false; setRunning(false) }
    }
  }

  return <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
    <Space wrap style={{ marginBottom: 16 }}>
      <Button onClick={() => navigate('/agent')}>{t('agent.execution.back')}</Button>
      <Button onClick={() => navigate(`/agent/executions?workflow_id=${id}`)}>{t('agent.execution.history')}</Button>
      {workflow && <Button onClick={() => navigate(`/agent/editor/${id}`)}>{t('agent.workflow.edit')}</Button>}
    </Space>
    {loading ? <Spin /> : <Card title={`${t('agent.workflow.execute')} · ${workflow?.name || ''}`}>
      {error && <Alert type="error" showIcon message={error.startsWith('agent.') ? t(error) : error} style={{ marginBottom: 16 }} />}
      {workflow && <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Paragraph type="secondary">{t('agent.execution.runHint')}</Typography.Paragraph>
        <Segmented value={mode} disabled={running} onChange={value => { setMode(value); setInput(''); setError('') }}
          options={[{ value: 'text', label: t('agent.execution.textMode') }, { value: 'json', label: 'JSON' }]} />
        <Input.TextArea aria-label={t('agent.execution.inputData')} value={input} disabled={running}
          onChange={e => setInput(e.target.value)} rows={6}
          placeholder={mode === 'json' ? '{"query": "..."}' : t('agent.test.inputPlaceholder')} />
        <Button type="primary" loading={running} onClick={run} disabled={mode === 'text' && !input.trim()}>{t('agent.workflow.execute')}</Button>
        {running && <Alert type="info" message={t('agent.execution.runningHint')} />}
        {result && <Card size="small" title={t('agent.execution.outputData')}>
          <Typography.Paragraph>{t('agent.execution.resultMeta', { id: result.executionId, credits: result.credits?.used ?? 0 })}</Typography.Paragraph>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)}</pre>
        </Card>}
      </Space>}
    </Card>}
  </div>
}
