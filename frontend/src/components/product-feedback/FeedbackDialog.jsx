/**
 * 提交反馈弹窗（全局入口打开）。
 *
 * - 打开时冻结当前页面地址/标题与非敏感客户端快照，随反馈一起提交；
 * - 截图仅 PNG/JPEG/WebP、≤5MiB，前端先做大小/类型初筛，真实类型由后端按文件签名裁决；
 * - 提交成功后显示回执，并可直接跳到「我的反馈」查看进度。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ImagePlus, X } from './icons'
import { createProductFeedback } from '../../api/productFeedback'
import {
  FEEDBACK_CONTENT_MAX_CHARS,
  FEEDBACK_SCREENSHOT_ACCEPT,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_TYPE_OPTIONS,
  collectFeedbackClientContext,
  formatFeedbackBytes,
} from './feedbackLabels'
import './product-feedback.css'

const ACCEPTED_MIME = new Set(FEEDBACK_SCREENSHOT_ACCEPT.split(','))

export default function FeedbackDialog({ open, onClose, onSubmitted }) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const backdropRef = useRef(null)

  const [feedbackType, setFeedbackType] = useState('bug')
  const [content, setContent] = useState('')
  const [screenshots, setScreenshots] = useState([])
  const screenshotsRef = useRef([])
  const [screenshotURLs, setScreenshotURLs] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)

  // 打开时冻结页面上下文：用户在弹窗里打字期间不应随路由变化而漂移。
  const snapshot = useMemo(() => {
    if (!open || typeof window === 'undefined') return null
    return {
      page_url: window.location.origin + window.location.pathname,
      page_title: document.title,
      client_context: collectFeedbackClientContext(),
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setFeedbackType('bug')
      setContent('')
      setScreenshots([])
      screenshotsRef.current = []
      setError('')
      setSubmitting(false)
      setSubmitted(null)
    }
  }, [open])

  useEffect(() => {
    const urls = screenshots.map(file => URL.createObjectURL(file))
    setScreenshotURLs(urls)
    return () => urls.forEach(url => URL.revokeObjectURL(url))
  }, [screenshots])

  useEffect(() => {
    if (!open) return
    // 软键盘可能只缩小 visualViewport；让整个弹窗始终处于可见区域。
    const viewport = window.visualViewport
    const updateViewport = () => {
      const unscaled = viewport?.scale === 1
      backdropRef.current?.style.setProperty('--pf-dialog-top', `${unscaled ? viewport.offsetTop : 0}px`)
      backdropRef.current?.style.setProperty('--pf-dialog-height', `${unscaled ? viewport.height : window.innerHeight}px`)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    return () => {
      document.body.style.overflow = previousOverflow
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, submitting, onClose])

  if (!open) return null

  const changeScreenshots = (files) => {
    screenshotsRef.current = files
    setScreenshots(files)
  }
  const pickScreenshots = (files) => {
    if (submitting || submitted || files.length === 0) return
    if (screenshotsRef.current.length + files.length > 5) {
      setError('每条反馈最多添加 5 张截图，请先移除不需要的图片')
      return
    }
    if (files.some(file => !ACCEPTED_MIME.has(file.type))) {
      setError('截图仅支持 PNG、JPEG 或 WebP')
      return
    }
    if (files.some(file => file.size === 0 || file.size > FEEDBACK_SCREENSHOT_MAX_BYTES)) {
      setError('每张截图需大于 0 字节且不能超过 5 MB')
      return
    }
    setError('')
    changeScreenshots([...screenshotsRef.current, ...files])
  }
  const pasteScreenshot = (event) => {
    let files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
    if (!files.length) files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
    if (files.length === 0) return // 普通文字继续正常粘贴。
    event.preventDefault()
    pickScreenshots(files)
  }

  const submit = async () => {
    const trimmed = content.trim()
    if (trimmed.length < 2) {
      setError('请至少描述 2 个字符')
      return
    }
    if (trimmed.length > FEEDBACK_CONTENT_MAX_CHARS) {
      setError(`反馈内容不能超过 ${FEEDBACK_CONTENT_MAX_CHARS} 个字符`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const created = await createProductFeedback({
        feedback_type: feedbackType,
        content: trimmed,
        page_url: snapshot?.page_url ?? window.location.origin + window.location.pathname,
        page_title: snapshot?.page_title ?? document.title,
        client_context: snapshot?.client_context ?? collectFeedbackClientContext(),
        screenshots,
      })
      setSubmitted(created)
      onSubmitted?.(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 顶栏的 backdrop-filter/transform 会改变 fixed 定位的包含块，弹层必须脱离顶栏。
  return createPortal(
    <div ref={backdropRef} className="pf-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <div className="pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-dialog-title" onPaste={pasteScreenshot}>
        <div className="pf-modal-header">
          <div>
            <h2 id="pf-dialog-title">{submitted ? '反馈已提交' : '提交反馈'}</h2>
            {!submitted && (
              <p>反馈会进入中央反馈池，处理进度可在「我的反馈」中查看；处理完成后需要你确认验收。</p>
            )}
          </div>
          <button type="button" className="pf-icon-button" aria-label="关闭" onClick={onClose} disabled={submitting}>
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          <>
            <div className="pf-modal-body">
              <div className="pf-success-box">
                <CheckCircle2 size={40} color="#059669" />
                <h3>已收到你的反馈</h3>
                <p>编号 {submitted.id.slice(0, 8)} · 管理员分类后会在「我的反馈」中更新进度。</p>
              </div>
            </div>
            <div className="pf-modal-footer">
              <button type="button" className="pf-btn" onClick={onClose}>关闭</button>
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                onClick={() => { onClose(); navigate(`/feedback/${submitted.id}`) }}
              >
                查看我的反馈
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pf-modal-body">
              {error && <p className="pf-error" role="alert">{error}</p>}

              <div className="pf-field">
                <div className="pf-field-label">反馈类型</div>
                <div className="pf-type-grid">
                  {FEEDBACK_TYPE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pf-type-option${feedbackType === option.value ? ' is-active' : ''}`}
                      onClick={() => setFeedbackType(option.value)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pf-field">
                <div className="pf-field-label">
                  <span>具体描述</span>
                  <small>{content.trim().length} / {FEEDBACK_CONTENT_MAX_CHARS}</small>
                </div>
                <textarea
                  className="pf-textarea"
                  value={content}
                  maxLength={FEEDBACK_CONTENT_MAX_CHARS}
                  placeholder="发生了什么？你期望的结果是什么？如能写出复现步骤会更快定位。"
                  onChange={event => setContent(event.target.value)}
                  aria-describedby="pf-screenshot-hint"
                  autoFocus
                />
                <small id="pf-screenshot-hint">可直接粘贴截图（Ctrl+V / ⌘V），也可以在下方选择图片。</small>
                <div role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--pf-text-sec)', overflowWrap: 'anywhere' }}>
                  {`已添加 ${screenshots.length} / 5 张截图`}
                </div>
              </div>

              <div className="pf-field">
                <div className="pf-field-label">
                  <span>截图（可选）</span>
                  <small>最多 5 张 · PNG / JPEG / WebP · 每张 ≤ 5 MB</small>
                </div>
                <div className="pf-screenshot-picker">
                  <input ref={fileInputRef} type="file" accept={FEEDBACK_SCREENSHOT_ACCEPT} multiple hidden disabled={submitting}
                    onChange={event => { pickScreenshots(Array.from(event.target.files ?? [])); event.target.value = '' }} />
                  <button type="button" className="pf-btn pf-btn-sm" disabled={submitting || screenshots.length >= 5} onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus size={14} />添加截图
                  </button>
                  <div className="pf-upload-grid">
                    {screenshots.map((file, index) => (
                      <div className="pf-upload-item" key={`${index}-${file.name}`}>
                        {screenshotURLs[index] && <img className="pf-screenshot-preview" src={screenshotURLs[index]} alt={`截图 ${index + 1} 预览`} />}
                        <small>{index + 1}. {file.name || '粘贴的截图'}（{formatFeedbackBytes(file.size)}）</small>
                        <button type="button" className="pf-btn pf-btn-sm" aria-label={`移除截图 ${index + 1}`} disabled={submitting}
                          onClick={() => { changeScreenshots(screenshotsRef.current.filter((_, i) => i !== index)); setError('') }}>移除</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pf-field">
                <div className="pf-field-label">
                  <span>随反馈提交的页面信息</span>
                  <small>自动采集，不含账号与凭据</small>
                </div>
                <div className="pf-context-box">
                  {snapshot?.page_title ? `${snapshot.page_title} · ` : ''}{snapshot?.page_url}
                  <br />
                  视口 {String(snapshot?.client_context.viewport ?? '')} · {String(snapshot?.client_context.language ?? '')}
                </div>
              </div>
            </div>
            <div className="pf-modal-footer">
              <button type="button" className="pf-btn" onClick={onClose} disabled={submitting}>取消</button>
              <button type="button" className="pf-btn pf-btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
