import { Bot, RefreshCw } from "../../components/product-feedback/icons";
import { FeedbackPriorityBadge } from "./FeedbackBadges";
import {
  FEEDBACK_AI_FORMULA_HINT,
  feedbackAIApplyReasonLabel,
  feedbackAIInProgress,
  feedbackAIStateLabel,
  feedbackTypeLabel,
  formatFeedbackDateTime,
} from "./feedbackLabels";
import "./product-feedback.css";
const SCORE_ROWS = [
  {
    key: "ux_importance",
    label: "\u91CD\u8981\u5EA6",
    hint: "\u5BF9\u7528\u6237\u4F53\u9A8C\u7684\u91CD\u8981\u6027",
  },
  {
    key: "impact",
    label: "\u5F71\u54CD\u9762",
    hint: "\u53D7\u5F71\u54CD\u7684\u4EBA\u6570\u4E0E\u9891\u7387",
  },
  {
    key: "difficulty",
    label: "\u96BE\u5EA6",
    hint: "\u5F00\u53D1\u5B9E\u73B0\u96BE\u5EA6",
  },
];
function FeedbackAIAssessmentCard({ feedback, busy, onReassess }) {
  const state = feedback.ai_assessment_state;
  const assessment = feedback.ai_assessment;
  const inProgress = feedbackAIInProgress(state);
  return (
    <section className="pf-ai-card" aria-label="AI 评估">
      <div className="pf-ai-card-head">
        <span className="pf-ai-card-title">
          <Bot size={15} />
          AI 评估
        </span>
        <span
          className={`pf-badge ${state === "completed" ? "pf-badge-indigo" : state === "failed" ? "pf-badge-rose" : "pf-badge-gray"}`}
        >
          {feedbackAIStateLabel(state)}
        </span>
        {state !== "skipped" && (
          <button
            type="button"
            className="pf-btn pf-btn-sm"
            disabled={busy || inProgress}
            onClick={onReassess}
          >
            <RefreshCw size={13} className={inProgress ? "is-spinning" : ""} />
            {inProgress
              ? "\u8BC4\u4F30\u4E2D\u2026"
              : "\u91CD\u65B0\u8BC4\u4F30"}
          </button>
        )}
      </div>

      {state === "skipped" && (
        <p className="pf-ai-card-note">本条反馈提交时 AI 评估未启用。</p>
      )}
      {inProgress && (
        <p className="pf-ai-card-note">
          评估通常在一分钟内完成，页面会自动刷新结果。
        </p>
      )}
      {state === "failed" && !assessment && (
        <p className="pf-ai-card-note">
          评估失败，原因见下方处理过程；可点「重新评估」。
        </p>
      )}

      {assessment && (
        <>
          <div className="pf-ai-scores">
            {SCORE_ROWS.map((row) => (
              <div key={row.key} className="pf-ai-score" title={row.hint}>
                <span className="pf-ai-score-label">{row.label}</span>
                <span className="pf-ai-score-bar" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <i
                      key={step}
                      className={step <= assessment[row.key] ? "is-on" : ""}
                    />
                  ))}
                </span>
                <strong>{assessment[row.key]}/5</strong>
              </div>
            ))}
            <div className="pf-ai-score">
              <span className="pf-ai-score-label">置信度</span>
              <strong>{Math.round(assessment.confidence * 100)}%</strong>
            </div>
          </div>

          <div className="pf-ai-verdict">
            <span>得分 {assessment.score.toFixed(2)} →</span>
            <FeedbackPriorityBadge priority={assessment.suggested_priority} />
            <span
              className={`pf-badge ${assessment.applied ? "pf-badge-green" : "pf-badge-gray"}`}
            >
              {feedbackAIApplyReasonLabel(assessment)}
            </span>
            {assessment.suggested_type !== feedback.feedback_type && (
              <span className="pf-badge pf-badge-amber">
                建议类型：{feedbackTypeLabel(assessment.suggested_type)}
              </span>
            )}
          </div>

          {assessment.summary && (
            <p className="pf-ai-summary">{assessment.summary}</p>
          )}
          {assessment.rationale && (
            <p className="pf-ai-rationale">{assessment.rationale}</p>
          )}
          {assessment.screenshot_findings && (
            <p className="pf-ai-rationale">
              <strong>截图发现：</strong>
              {assessment.screenshot_findings}
            </p>
          )}
          <p className="pf-ai-meta" title={FEEDBACK_AI_FORMULA_HINT}>
            AI 评估 ·{" "}
            {assessment.screenshot_used
              ? "\u5DF2\u770B\u622A\u56FE"
              : "\u4EC5\u6587\u672C"}{" "}
            · {formatFeedbackDateTime(assessment.assessed_at)} ·
            优先级由固定公式映射
          </p>
        </>
      )}
    </section>
  );
}
export { FeedbackAIAssessmentCard as default };
