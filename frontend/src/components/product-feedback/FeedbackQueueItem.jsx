import { useState } from "react";
import {
  FeedbackPriorityBadge,
  FeedbackStatusBadge,
  FeedbackTypeTag,
} from "./FeedbackBadges";
import {
  FEEDBACK_PRIORITY_META,
  FEEDBACK_PRIORITY_ORDER,
  adminActionsForStatus,
  feedbackAIInProgress,
  feedbackAIStateLabel,
  feedbackPriorityLabel,
  feedbackSummary,
  formatFeedbackRelative,
} from "./feedbackLabels";
import "./product-feedback.css";
function FeedbackQueueItem({
  item,
  active,
  admin,
  selected = false,
  busy = false,
  onOpen,
  onToggleSelect,
  onAction,
}) {
  const [running, setRunning] = useState(false);
  const advance = admin
    ? adminActionsForStatus(item.status).filter(
        (option) => option.kind === "advance",
      )
    : [];
  const canSetPriority =
    admin &&
    adminActionsForStatus(item.status).some(
      (option) => option.action === "set_priority",
    );
  const aiSummary = item.ai_assessment?.summary;
  const aiSuggestion =
    item.ai_suggested_priority && item.ai_suggested_priority !== item.priority
      ? item.ai_suggested_priority
      : "";
  const disabled = busy || running;
  const run = async (action, priority) => {
    if (!onAction) return;
    setRunning(true);
    try {
      await onAction(action, priority);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={`pf-list-item${active ? " is-active" : ""}${selected ? " is-selected" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="pf-list-item-top">
        {admin && onToggleSelect && (
          <input
            type="checkbox"
            className="pf-list-check"
            checked={selected}
            aria-label="选择此反馈"
            onClick={(event) => event.stopPropagation()}
            onChange={onToggleSelect}
          />
        )}
        <FeedbackTypeTag type={item.feedback_type} />
        <FeedbackStatusBadge status={item.status} />
        {(admin || item.priority !== "unassigned") && (
          <FeedbackPriorityBadge priority={item.priority} />
        )}
        {admin && aiSuggestion && (
          <span
            className="pf-badge pf-badge-indigo"
            title="AI 建议但未自动应用"
          >
            AI 建议 {feedbackPriorityLabel(aiSuggestion).split(" ")[0]}
          </span>
        )}
        {admin &&
          (feedbackAIInProgress(item.ai_assessment_state) ||
            item.ai_assessment_state === "failed") && (
            <span
              className={`pf-badge ${item.ai_assessment_state === "failed" ? "pf-badge-rose" : "pf-badge-gray"}`}
            >
              {feedbackAIStateLabel(item.ai_assessment_state)}
            </span>
          )}
      </div>

      <div className="pf-list-item-summary">{feedbackSummary(item)}</div>
      {admin && aiSummary && (
        <div className="pf-list-item-ai">AI：{aiSummary}</div>
      )}

      <div className="pf-list-item-meta">
        {item.page_title && <span>{item.page_title}</span>}
        <span>更新于 {formatFeedbackRelative(item.updated_at)}</span>
      </div>

      {admin &&
        (advance.length > 0 || canSetPriority) &&
        item.status !== "closed" && (
          <div
            className="pf-list-item-actions"
            onClick={(event) => event.stopPropagation()}
          >
            {advance.map((option) => (
              <button
                key={option.action}
                type="button"
                className="pf-btn pf-btn-sm pf-btn-primary"
                disabled={disabled}
                onClick={() => run(option.action)}
              >
                {running ? "\u5904\u7406\u4E2D\u2026" : option.label}
              </button>
            ))}
            {canSetPriority && (
              <select
                className="pf-select pf-select-sm"
                value={item.priority}
                disabled={disabled}
                aria-label="设置优先级"
                onChange={(event) => {
                  const next = event.target.value;
                  if (next !== "unassigned" && next !== item.priority)
                    run("set_priority", next);
                }}
              >
                <option value="unassigned" disabled>
                  {FEEDBACK_PRIORITY_META.unassigned.label}
                </option>
                {FEEDBACK_PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {FEEDBACK_PRIORITY_META[value].label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
    </div>
  );
}
export { FeedbackQueueItem as default };
