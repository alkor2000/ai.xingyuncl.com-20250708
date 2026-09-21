import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ImagePlus,
  X,
} from "../../components/product-feedback/icons";
import { createProductFeedback } from "../../api/productFeedback";
import {
  FEEDBACK_CONTENT_MAX_CHARS,
  FEEDBACK_SCREENSHOT_ACCEPT,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_TYPE_OPTIONS,
  collectFeedbackClientContext,
  formatFeedbackBytes,
} from "./feedbackLabels";
import "./product-feedback.css";
const ACCEPTED_MIME = new Set(FEEDBACK_SCREENSHOT_ACCEPT.split(","));
function FeedbackDialog({ open, onClose, onSubmitted }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const backdropRef = useRef(null);
  const [feedbackType, setFeedbackType] = useState("bug");
  const [content, setContent] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotURL, setScreenshotURL] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const snapshot = useMemo(() => {
    if (!open || typeof window === "undefined") return null;
    return {
      page_url: window.location.origin + window.location.pathname,
      page_title: document.title,
      client_context: collectFeedbackClientContext(),
    };
  }, [open]);
  useEffect(() => {
    if (!open) {
      setFeedbackType("bug");
      setContent("");
      setScreenshot(null);
      setError("");
      setSubmitting(false);
      setSubmitted(null);
    }
  }, [open]);
  useEffect(() => {
    if (!screenshot) {
      setScreenshotURL(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setScreenshotURL(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const unscaled = viewport?.scale === 1;
      backdropRef.current?.style.setProperty(
        "--pf-dialog-top",
        `${unscaled ? viewport.offsetTop : 0}px`,
      );
      backdropRef.current?.style.setProperty(
        "--pf-dialog-height",
        `${unscaled ? viewport.height : window.innerHeight}px`,
      );
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);
  if (!open) return null;
  const pickScreenshot = (file) => {
    setError("");
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!ACCEPTED_MIME.has(file.type)) {
      setError("\u622A\u56FE\u4EC5\u652F\u6301 PNG\u3001JPEG \u6216 WebP");
      return;
    }
    if (file.size > FEEDBACK_SCREENSHOT_MAX_BYTES) {
      setError(
        `\u622A\u56FE\u4E0D\u80FD\u8D85\u8FC7 5 MB\uFF08\u5F53\u524D ${formatFeedbackBytes(file.size)}\uFF09`,
      );
      return;
    }
    setScreenshot(file);
  };
  const submit = async () => {
    const trimmed = content.trim();
    if (trimmed.length < 2) {
      setError("\u8BF7\u81F3\u5C11\u63CF\u8FF0 2 \u4E2A\u5B57\u7B26");
      return;
    }
    if (trimmed.length > FEEDBACK_CONTENT_MAX_CHARS) {
      setError(
        `\u53CD\u9988\u5185\u5BB9\u4E0D\u80FD\u8D85\u8FC7 ${FEEDBACK_CONTENT_MAX_CHARS} \u4E2A\u5B57\u7B26`,
      );
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await createProductFeedback({
        feedback_type: feedbackType,
        content: trimmed,
        page_url:
          snapshot?.page_url ??
          window.location.origin + window.location.pathname,
        page_title: snapshot?.page_title ?? document.title,
        client_context:
          snapshot?.client_context ?? collectFeedbackClientContext(),
        screenshot,
      });
      setSubmitted(created);
      onSubmitted?.(created);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "\u63D0\u4EA4\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return createPortal(
    <div
      ref={backdropRef}
      className="pf-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="pf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pf-dialog-title"
      >
        <div className="pf-modal-header">
          <div>
            <h2 id="pf-dialog-title">
              {submitted
                ? "\u53CD\u9988\u5DF2\u63D0\u4EA4"
                : "\u63D0\u4EA4\u53CD\u9988"}
            </h2>
            {!submitted && (
              <p>
                反馈会进入中央反馈池，处理进度可在「我的反馈」中查看；处理完成后需要你确认验收。
              </p>
            )}
          </div>
          <button
            type="button"
            className="pf-icon-button"
            aria-label="关闭"
            onClick={onClose}
            disabled={submitting}
          >
            <X size={18} />
          </button>
        </div>

        {submitted ? (
          <>
            <div className="pf-modal-body">
              <div className="pf-success-box">
                <CheckCircle2 size={40} color="#059669" />
                <h3>已收到你的反馈</h3>
                <p>
                  编号 {submitted.id.slice(0, 8)} ·
                  管理员分类后会在「我的反馈」中更新进度。
                </p>
              </div>
            </div>
            <div className="pf-modal-footer">
              <button type="button" className="pf-btn" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                onClick={() => {
                  onClose();
                  navigate(`/feedback/${submitted.id}`);
                }}
              >
                查看我的反馈
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pf-modal-body">
              {error && (
                <p className="pf-error" role="alert">
                  {error}
                </p>
              )}

              <div className="pf-field">
                <div className="pf-field-label">反馈类型</div>
                <div className="pf-type-grid">
                  {FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pf-type-option${feedbackType === option.value ? " is-active" : ""}`}
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
                  <small>
                    {content.trim().length} / {FEEDBACK_CONTENT_MAX_CHARS}
                  </small>
                </div>
                <textarea
                  className="pf-textarea"
                  value={content}
                  maxLength={FEEDBACK_CONTENT_MAX_CHARS}
                  placeholder="发生了什么？你期望的结果是什么？如能写出复现步骤会更快定位。"
                  onChange={(event) => setContent(event.target.value)}
                  autoFocus
                />
              </div>

              <div className="pf-field">
                <div className="pf-field-label">
                  <span>截图（可选）</span>
                  <small>PNG / JPEG / WebP，≤ 5 MB</small>
                </div>
                <div className="pf-screenshot-picker">
                  {screenshotURL && (
                    <img
                      className="pf-screenshot-preview"
                      src={screenshotURL}
                      alt="截图预览"
                    />
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={FEEDBACK_SCREENSHOT_ACCEPT}
                    hidden
                    onChange={(event) =>
                      pickScreenshot(event.target.files?.[0] ?? null)
                    }
                  />
                  <button
                    type="button"
                    className="pf-btn pf-btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus size={14} />
                    {screenshot
                      ? "\u66F4\u6362\u622A\u56FE"
                      : "\u9009\u62E9\u622A\u56FE"}
                  </button>
                  {screenshot && (
                    <button
                      type="button"
                      className="pf-btn pf-btn-sm"
                      onClick={() => {
                        setScreenshot(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>

              <div className="pf-field">
                <div className="pf-field-label">
                  <span>随反馈提交的页面信息</span>
                  <small>自动采集，不含账号与凭据</small>
                </div>
                <div className="pf-context-box">
                  {snapshot?.page_title ? `${snapshot.page_title} \xB7 ` : ""}
                  {snapshot?.page_url}
                  <br />
                  视口 {String(snapshot?.client_context.viewport ?? "")} ·{" "}
                  {String(snapshot?.client_context.language ?? "")}
                </div>
              </div>
            </div>
            <div className="pf-modal-footer">
              <button
                type="button"
                className="pf-btn"
                onClick={onClose}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                onClick={submit}
                disabled={submitting}
              >
                {submitting
                  ? "\u63D0\u4EA4\u4E2D\u2026"
                  : "\u63D0\u4EA4\u53CD\u9988"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
export { FeedbackDialog as default };
