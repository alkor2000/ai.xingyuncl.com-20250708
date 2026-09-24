import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Select, Space, Tag, Typography } from 'antd'
import { BookOutlined, EyeOutlined, LinkOutlined, PushpinOutlined, SendOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import api from '../../utils/api'

// "关联到教学任务": the student picks the entry page of one of their own projects and links it to the
// task they arrived from. Everything about the task (assignment, school, their own student identity)
// comes from the signed context edu handed over — this panel never sends an assignment id of its own,
// and it never claims a work is submitted: submission is an act in edu over a fixed version.
const ROOT = '/p09/website-artifacts'
// The task context is a credential. edu hands it over in the URL *fragment* (`#p09_task=…`): a fragment
// is never sent to any server, never appears in an access log and never leaks through Referer. It is
// kept in memory for this tab only, removed from the address bar at once, and never persisted.
let taskContext = null
export function captureTaskContext(hash = window.location.hash) {
  try {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''))
    const value = params.get('p09_task')
    if (!value) return taskContext
    taskContext = value
    params.delete('p09_task')
    const rest = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`)
  } catch { /* a hostile URL must not break the editor */ }
  return taskContext
}
export function setTaskContext(value) { taskContext = value || null }

let capabilityPromise = null
export function loadCapability(client = api) {
  if (!capabilityPromise) {
    capabilityPromise = client.get(`${ROOT}/capability`, { skipDebugLogging: true, skipErrorMessage: true })
      .then(({ data }) => (data?.available === true ? data : { available: false }))
      .catch(() => ({ available: false }))
  }
  return capabilityPromise
}
export function resetCapabilityCache() { capabilityPromise = null }

// `unknown` is not a failure: it is what the platform says when the evidence of a real save does not
// reach back far enough. It must never look like 未开始.
const STATE_TONE = { linked: 'default', working: 'processing', preview_ready: 'success', unknown: 'warning', unavailable: 'warning' }
const time = (ms, locale) => (ms ? new Date(ms).toLocaleString(locale) : '—')

export default function TaskArtifactPanel({ project, pages = [], client = api }) {
  const { t, i18n } = useTranslation()
  const [capability, setCapability] = useState(null)
  const [links, setLinks] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [linking, setLinking] = useState(false)
  const [entryPageId, setEntryPageId] = useState(null)
  const [context, setContext] = useState(() => captureTaskContext())
  // What edu answered about handing in, this session only. Nothing is remembered as 已交 across a
  // reload: the submission fact belongs to edu, and a stale tick here would be a lie about their state.
  const [submission, setSubmission] = useState(null)
  const lock = useRef(false)

  useEffect(() => { let alive = true; loadCapability(client).then(value => { if (alive) setCapability(value) }); return () => { alive = false } }, [client])

  const refresh = useCallback(async () => {
    if (!capability?.available) return
    try {
      const { data } = await client.get(`${ROOT}/links`, { skipDebugLogging: true, skipErrorMessage: true })
      setLinks(data?.links || [])
    } catch { setLinks([]) }
  }, [capability, client])
  useEffect(() => { refresh() }, [refresh])

  const run = async fn => {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(null)
    try { await fn() } catch (e) {
      setError(e.response?.data?.error?.code || 'network_error')
    } finally { lock.current = false; setBusy(false) }
  }
  const post = async (path, body, key) => (await client.post(`${ROOT}${path}`, body, {
    headers: { ...(key ? { 'Idempotency-Key': key } : {}), ...(context ? { 'X-P09-Task-Context': context } : {}) },
    skipDebugLogging: true, skipErrorMessage: true
  })).data

  const current = useMemo(() => links.find(item => String(item.project_id) === String(project?.id) && item.state === 'active') || null, [links, project])
  const entryTitle = useMemo(() => pages.find(page => String(page.id) === String(current?.entry_page_id))?.title || null, [pages, current])
  // A different work, or a link that went away, must not keep showing the previous answer.
  useEffect(() => { setSubmission(null) }, [current?.link_id])

  const associate = () => run(async () => {
    await post('/links', { schema_version: 1, project_id: Number(project.id), entry_page_id: Number(entryPageId) }, crypto.randomUUID())
    // The context is single use on the server; drop it here too so a second click cannot reuse it.
    setTaskContext(null); setContext(null); setLinking(false)
    await refresh()
  })
  const freeze = () => run(async () => {
    await post(`/links/${current.link_id}/revisions`, { schema_version: 1 }, crypto.randomUUID())
    await refresh()
  })
  // 交作业. edu fixes the version and decides whether this counts; this only carries the press and shows
  // the answer. `run` holds a lock, so a double click is one request, and only submitted === true is
  // ever displayed as 已交. Nothing here retries on its own: when the answer is lost, edu's state is
  // unknown to us, and pressing again is the student's decision to make after checking there.
  const submit = () => run(async () => {
    setSubmission(null)
    const data = await post(`/links/${current.link_id}/submissions`, { schema_version: 1 })
    setSubmission(data?.submission || null)
    await refresh()
  })
  const unlink = () => run(async () => {
    await post(`/links/${current.link_id}/unlink`)
    await refresh()
  })
  const openPreview = (revisionRef = null) => run(async () => {
    const data = await post(`/links/${current.link_id}/preview-sessions`, { schema_version: 1, revision_ref: revisionRef })
    if (data?.session?.open_url) window.open(data.session.open_url, '_blank', 'noopener,noreferrer')
  })

  if (!capability?.available) return null
  const prefix = 'htmlEditor.p09.'
  const latest = current?.revisions?.length ? current.revisions[current.revisions.length - 1] : null
  const submitConfigured = capability?.submit_configured === true
  // Linked but nothing saved since: the way forward is to save again, not to unlink and start over.
  const needsSaveAfterLink = !!current && current.save_evidence !== 'observed'

  return (
    <div className="html-editor-task-panel" style={{ padding: 12, borderTop: '1px solid var(--border-color, #eee)' }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <BookOutlined style={{ color: 'var(--primary-color)' }} />
          <Typography.Text strong>{t(`${prefix}title`)}</Typography.Text>
          {current && <Tag color={STATE_TONE[current.work_state] || 'default'} data-testid="p09-state">{t(`${prefix}state.${current.work_state}`)}</Tag>}
        </Space>

        {error && <Alert type="error" showIcon data-testid="p09-error"
          message={t(`${prefix}error.${error}`, { defaultValue: t(`${prefix}error.unknown`) })} />}

        {!current && (
          context
            ? <>
              <Typography.Text type="secondary">{t(`${prefix}linkHint`)}</Typography.Text>
              <Button type="primary" block icon={<LinkOutlined />} disabled={busy || !pages.length}
                onClick={() => { setEntryPageId(pages[0]?.id ?? null); setLinking(true) }} data-testid="p09-link">
                {t(`${prefix}link`)}
              </Button>
              {!pages.length && <Typography.Text type="secondary">{t(`${prefix}needPage`)}</Typography.Text>}
            </>
            : <Typography.Text type="secondary" data-testid="p09-no-context">{t(`${prefix}noContext`)}</Typography.Text>
        )}

        {current && <>
          <Descriptions size="small" column={1} colon={false} items={[
            { key: 'assignment', label: t(`${prefix}assignment`), children: current.assignment_ref },
            { key: 'entry', label: t(`${prefix}entry`), children: entryTitle || current.entry_ref?.slice(0, 8) },
            { key: 'saved', label: t(`${prefix}evidenceLabel`), children: current.save_evidence === 'observed'
              ? t(`${prefix}evidence.observed`, { at: time(current.last_real_save_at ?? current.saved_at, i18n.language) })
              : t(`${prefix}evidence.${current.save_evidence || 'none'}`) },
            { key: 'revision', label: t(`${prefix}revision`), children: latest
              ? t(`${prefix}revisionValue`, { no: latest.revision_no, at: time(latest.created_at, i18n.language) })
              : t(`${prefix}revisionNone`) }
          ]} />
          {/* Three outcomes, kept apart on purpose. A refusal is edu's own answer and is shown as its own
              sentence; an unknown is the absence of an answer, and it may NOT be read as "not handed in" —
              edu may already hold this submission, so the student is sent there to check. */}
          {submission?.submitted === true
            ? <Alert type="success" showIcon data-testid="p09-submitted"
              message={t(`${prefix}submitted`, { no: submission.revision_no, at: time(submission.submitted_at, i18n.language) })}
              description={t(`${prefix}submittedHint`)} />
            : submission?.outcome === 'refused'
              ? <Alert type={submission.retryable ? 'warning' : 'error'} showIcon data-testid="p09-submit-refusal"
                message={submission.message || t(`${prefix}submitRefusal.${submission.code}`,
                  { defaultValue: t(`${prefix}submitRefusal.unknown`) })}
                description={t(`${prefix}${submission.retryable ? 'submitRetry' : 'submitStop'}`)} />
              : submission
                ? <Alert type="warning" showIcon data-testid="p09-submit-unknown"
                  message={t(`${prefix}submitUnknown`)}
                  description={<>
                    <div>{t(`${prefix}submitUnknownHint`)}</div>
                    <div style={{ marginTop: 6 }}>{t(`${prefix}submitUnknownAgain`)}</div>
                  </>} />
                : null}

          {submitConfigured
            ? <Typography.Text type="secondary">{t(`${prefix}submitWhereYouWork`)}</Typography.Text>
            : <Typography.Text type="secondary">{t(`${prefix}submitHint`)}</Typography.Text>}
          {needsSaveAfterLink && <Alert type="info" showIcon data-testid="p09-save-after-link"
            message={t(`${prefix}saveAfterLink`)} />}
          <Typography.Text type="secondary">{t(`${prefix}frozenScopeHint`)}</Typography.Text>
          <Space wrap>
            {submitConfigured && <Button type="primary" icon={<SendOutlined />} disabled={busy} loading={busy}
              onClick={submit} data-testid="p09-submit">{t(`${prefix}submit`)}</Button>}
            <Button icon={<EyeOutlined />} disabled={busy || !current.preview_available} onClick={() => openPreview(null)} data-testid="p09-preview">
              {t(`${prefix}preview`)}
            </Button>
            {/* Freezing by hand stays for the paths that are not an edu submission; when 交作业 is wired
                it is no longer the primary action, because edu fixes the version as part of submitting. */}
            <Button type={submitConfigured ? 'default' : 'primary'} icon={<PushpinOutlined />}
              disabled={busy || current.has_effective_save === false}
              onClick={freeze} data-testid="p09-freeze">{t(`${prefix}freeze`)}</Button>
            {latest && <Button disabled={busy} onClick={() => openPreview(latest.revision_ref)} data-testid="p09-open-revision">
              {t(`${prefix}openRevision`)}</Button>}
          </Space>
          {/* Unlinking is a way out, not a retry: it is small, last, and says what it destroys. */}
          <Button type="text" danger size="small" disabled={busy} style={{ paddingLeft: 0 }}
            onClick={() => Modal.confirm({
              title: t(`${prefix}unlinkConfirm`), content: t(`${prefix}unlinkHint`), okText: t(`${prefix}unlink`),
              okType: 'danger', okButtonProps: { 'data-testid': 'p09-unlink-ok' },
              cancelText: t('common.cancel'), onOk: unlink
            })} data-testid="p09-unlink">{t(`${prefix}unlink`)}</Button>
        </>}
      </Space>

      <Modal open={linking} title={t(`${prefix}link`)} okText={t(`${prefix}confirmLink`)} cancelText={t('common.cancel')}
        confirmLoading={busy} onOk={associate} onCancel={() => setLinking(false)} destroyOnClose>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t(`${prefix}confirmHint`)} />
          <Typography.Text strong>{t(`${prefix}chooseEntry`)}</Typography.Text>
          <Select style={{ width: '100%' }} value={entryPageId} onChange={setEntryPageId} data-testid="p09-entry-select"
            options={pages.map(page => ({ value: page.id, label: page.title || page.slug }))} />
          <Typography.Text type="secondary">{t(`${prefix}multiPageHint`)}</Typography.Text>
        </Space>
      </Modal>
    </div>
  )
}
