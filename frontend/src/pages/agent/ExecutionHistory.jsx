import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Descriptions, Drawer, Popconfirm, Select, Space, Spin, Table, Tag } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import useAgentStore from '../../stores/agentStore'

const statuses = { running: 'processing', success: 'success', failed: 'error', cancelled: 'default' }
const date = value => value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—'
const elapsed = row => row.duration_ms ?? (row.completed_at && row.started_at ? dayjs(row.completed_at).diff(dayjs(row.started_at)) : null)

export default function ExecutionHistory() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const workflowId = searchParams.get('workflow_id') || undefined
  const { executions, executionsLoading, executionsError, executionsPagination,
    fetchExecutions, fetchExecutionById, deleteExecution } = useAgentStore()
  const [query, setQuery] = useState({ current: 1, pageSize: 20, status: undefined })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const detailRequest = useRef(0)
  useEffect(() => () => { detailRequest.current++ }, [])
  useEffect(() => { setQuery(q => ({ ...q, current: 1 })) }, [workflowId])
  useEffect(() => { fetchExecutions({ ...query, workflow_id: workflowId }) }, [query, workflowId, fetchExecutions])
  const reload = () => fetchExecutions({ ...query, workflow_id: workflowId })
  const statusTag = status => <Tag color={statuses[status]}>{Object.hasOwn(statuses, status) ? t(`agent.execution.status.${status}`) : status}</Tag>
  const durationText = row => elapsed(row) == null ? '—' : t('agent.execution.seconds', { count: Math.max(0, elapsed(row)) / 1000 })

  const viewDetail = async id => {
    const request = ++detailRequest.current
    setDrawerOpen(true); setDetail(null); setDetailError(false); setDetailLoading(true)
    try {
      const data = await fetchExecutionById(id)
      if (request === detailRequest.current) setDetail(data)
    } catch { if (request === detailRequest.current) setDetailError(true) }
    finally { if (request === detailRequest.current) setDetailLoading(false) }
  }
  const remove = async id => {
    await deleteExecution(id)
    if (executions.length === 1 && query.current > 1) setQuery(q => ({ ...q, current: q.current - 1 }))
    else await reload()
  }
  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: t('agent.workflow.name'), dataIndex: 'workflow_name', ellipsis: true },
    { title: t('agent.workflow.status'), dataIndex: 'status', render: statusTag },
    { title: t('agent.execution.credits.used'), dataIndex: 'total_credits_used', render: value => value ?? 0 },
    { title: t('agent.execution.duration'), render: (_, row) => durationText(row) },
    { title: t('agent.execution.startTime'), dataIndex: 'started_at', render: date },
    { title: t('agent.execution.endTime'), dataIndex: 'completed_at', render: date },
    { title: t('agent.execution.actions'), render: (_, row) => <Space>
      <Button onClick={() => viewDetail(row.id)}>{t('agent.execution.detail')}</Button>
      <Popconfirm title={t('agent.execution.deleteConfirm')} onConfirm={() => remove(row.id)}
        okText={t('agent.actions.confirm')} cancelText={t('agent.actions.cancel')}>
        <Button danger disabled={row.status === 'running'}>{t('agent.workflow.delete')}</Button>
      </Popconfirm>
    </Space> }
  ]
  return <div style={{ padding: 24 }}>
    <Space wrap style={{ marginBottom: 16 }}>
      <Button onClick={() => navigate('/agent')}>{t('agent.execution.back')}</Button>
      {workflowId && <Button onClick={() => navigate(`/agent/execute/${workflowId}`)}>{t('agent.workflow.execute')}</Button>}
      <Select aria-label={t('agent.execution.filter')} placeholder={t('agent.execution.allStatuses')} allowClear
        style={{ minWidth: 150 }} value={query.status}
        options={Object.keys(statuses).map(value => ({ value, label: t(`agent.execution.status.${value}`) }))}
        onChange={status => setQuery(q => ({ ...q, status, current: 1 }))} />
      <Button onClick={reload} loading={executionsLoading}>{t('agent.actions.refresh')}</Button>
    </Space>
    <Card title={t('agent.execution.history')}>
      {executionsError ? <Alert type="error" showIcon message={t('agent.store.executionsLoadFailed')} /> :
        <Table columns={columns} dataSource={executions} rowKey="id" loading={executionsLoading} scroll={{ x: 1000 }}
          pagination={{ current: query.current, pageSize: query.pageSize, total: executionsPagination.total,
            showSizeChanger: true, onChange: (current, pageSize) => setQuery(q => ({ ...q, current, pageSize })) }} />}
    </Card>
    <Drawer title={t('agent.execution.detail')} width={720} open={drawerOpen}
      onClose={() => { detailRequest.current++; setDrawerOpen(false) }}>
      {detailLoading ? <Spin /> : detailError ? <Alert type="error" message={t('agent.store.executionDetailLoadFailed')} /> : detail &&
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detail.id}</Descriptions.Item>
            <Descriptions.Item label={t('agent.workflow.name')}>{detail.workflow_name}</Descriptions.Item>
            <Descriptions.Item label={t('agent.workflow.status')}>{statusTag(detail.status)}</Descriptions.Item>
            <Descriptions.Item label={t('agent.execution.startTime')}>{date(detail.started_at)}</Descriptions.Item>
            <Descriptions.Item label={t('agent.execution.endTime')}>{date(detail.completed_at)}</Descriptions.Item>
            <Descriptions.Item label={t('agent.execution.duration')}>{durationText(detail)}</Descriptions.Item>
            <Descriptions.Item label={t('agent.execution.credits.used')}>{detail.total_credits_used ?? 0}</Descriptions.Item>
          </Descriptions>
          {detail.error_message && <Alert type="error" showIcon message={detail.error_message} />}
          {['input_data', 'output_data', 'execution_log'].filter(key => detail[key] != null).map(key =>
            <Card key={key} size="small" title={t(`agent.execution.${{ input_data: 'inputData', output_data: 'outputData', execution_log: 'log' }[key]}`)}>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(detail[key], null, 2)}</pre>
            </Card>)}
        </Space>}
    </Drawer>
  </div>
}
