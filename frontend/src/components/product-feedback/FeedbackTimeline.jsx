import {
  feedbackActorLabel,
  feedbackEventLabel,
  feedbackStatusLabel,
  formatFeedbackDateTime,
} from "./feedbackLabels";
import "./product-feedback.css";
function eventClassName(event) {
  if (
    event.event_type === "acceptance_rejected" ||
    event.event_type === "ai_assessment_failed"
  )
    return "is-rejected";
  if (event.event_type === "acceptance_approved") return "is-closed";
  if (event.actor_type === "reporter") return "is-reporter";
  if (event.actor_type === "system") return "is-system";
  return "";
}
function FeedbackTimeline({ events }) {
  if (events.length === 0) {
    return <div className="pf-empty">暂无事件</div>;
  }
  return (
    <ol className="pf-timeline">
      {events.map((event) => {
        const transition =
          event.previous_status &&
          event.next_status &&
          event.previous_status !== event.next_status
            ? `${feedbackStatusLabel(event.previous_status)} \u2192 ${feedbackStatusLabel(event.next_status)}`
            : "";
        return (
          <li key={event.id} className={eventClassName(event)}>
            <div className="pf-timeline-head">
              <strong>{feedbackEventLabel(event.event_type)}</strong>
              <span className="pf-timeline-actor">
                {feedbackActorLabel(event.actor_type)}
              </span>
              {transition && (
                <span className="pf-timeline-actor">{transition}</span>
              )}
              <time dateTime={event.created_at}>
                {formatFeedbackDateTime(event.created_at)}
              </time>
            </div>
            {event.body && event.event_type !== "submitted" && (
              <p className="pf-timeline-body">{event.body}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
export { FeedbackTimeline as default };
