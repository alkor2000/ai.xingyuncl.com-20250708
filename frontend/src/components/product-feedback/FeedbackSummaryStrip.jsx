import { FEEDBACK_STATUS_META, FEEDBACK_STATUS_ORDER } from "./feedbackLabels";
import "./product-feedback.css";
function FeedbackSummaryStrip({ stats, activeStatus, onSelect }) {
  if (!stats) return null;
  const aiPending =
    (stats.by_ai_state.pending ?? 0) + (stats.by_ai_state.running ?? 0);
  const aiFailed = stats.by_ai_state.failed ?? 0;
  return (
    <div className="pf-summary" role="tablist" aria-label="按状态筛选">
      <button
        type="button"
        role="tab"
        aria-selected={activeStatus === ""}
        className={`pf-summary-chip${activeStatus === "" ? " is-active" : ""}`}
        onClick={() => onSelect("")}
      >
        <span>全部</span>
        <strong>{stats.total}</strong>
      </button>
      {FEEDBACK_STATUS_ORDER.map((status) => {
        const count = stats.by_status[status] ?? 0;
        const meta = FEEDBACK_STATUS_META[status];
        return (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={activeStatus === status}
            className={`pf-summary-chip is-${meta.tone}${activeStatus === status ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
            onClick={() => onSelect(status)}
          >
            <span>{meta.label}</span>
            <strong>{count}</strong>
          </button>
        );
      })}
      {(aiPending > 0 || aiFailed > 0) && (
        <span className="pf-summary-ai">
          {aiPending > 0 && <span>AI 评估中 {aiPending}</span>}
          {aiFailed > 0 && (
            <span className="is-failed">AI 失败 {aiFailed}</span>
          )}
        </span>
      )}
    </div>
  );
}
export { FeedbackSummaryStrip as default };
