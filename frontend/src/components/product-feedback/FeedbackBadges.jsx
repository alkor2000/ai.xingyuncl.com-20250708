import {
  FEEDBACK_PRIORITY_META,
  FEEDBACK_STATUS_META,
  feedbackTypeLabel,
} from "./feedbackLabels";
import "./product-feedback.css";
function FeedbackStatusBadge({ status }) {
  const meta = FEEDBACK_STATUS_META[status];
  if (!meta) return <span className="pf-badge pf-badge-gray">{status}</span>;
  return <span className={`pf-badge pf-badge-${meta.tone}`}>{meta.label}</span>;
}
function FeedbackPriorityBadge({ priority }) {
  const meta = FEEDBACK_PRIORITY_META[priority];
  if (!meta) return <span className="pf-badge pf-badge-gray">{priority}</span>;
  return <span className={`pf-badge pf-badge-${meta.tone}`}>{meta.label}</span>;
}
function FeedbackTypeTag({ type }) {
  return <span className="pf-type-tag">{feedbackTypeLabel(type)}</span>;
}
export { FeedbackPriorityBadge, FeedbackStatusBadge, FeedbackTypeTag };
