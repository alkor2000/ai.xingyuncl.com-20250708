import { FEEDBACK_STATUS_META } from "./feedbackLabels";
import "./product-feedback.css";
const PIPELINE = [
  "submitted",
  "triaged",
  "planned",
  "developing",
  "awaiting_acceptance",
  "closed",
];
function pipelinePosition(status) {
  if (status === "reopened") return PIPELINE.indexOf("developing");
  return PIPELINE.indexOf(status);
}
function FeedbackPipeline({ status }) {
  const position = pipelinePosition(status);
  return (
    <ol className="pf-pipeline" aria-label="处理流程">
      {PIPELINE.map((step, index) => {
        const state =
          index < position
            ? "done"
            : index === position
              ? "current"
              : "pending";
        const label =
          step === "developing" && status === "reopened"
            ? "\u5DF2\u91CD\u5F00 \xB7 \u5F85\u518D\u6B21\u5F00\u53D1"
            : FEEDBACK_STATUS_META[step].label;
        return (
          <li key={step} className={`pf-pipeline-step is-${state}`}>
            <span className="pf-pipeline-dot">
              {state === "done" ? "\u2713" : index + 1}
            </span>
            <span className="pf-pipeline-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
export { FeedbackPipeline as default };
