const FEEDBACK_TYPE_OPTIONS = [
  {
    value: "bug",
    label: "\u529F\u80FD\u6545\u969C",
    hint: "\u62A5\u9519\u3001\u65E0\u54CD\u5E94\u3001\u7ED3\u679C\u4E0D\u5BF9",
  },
  {
    value: "platform_feature",
    label: "\u5E73\u53F0\u529F\u80FD\u5EFA\u8BAE",
    hint: "\u5E0C\u671B\u65B0\u589E\u6216\u8C03\u6574\u67D0\u9879\u529F\u80FD",
  },
  {
    value: "ai_performance",
    label: "AI \u8868\u73B0",
    hint: "\u751F\u6210\u8D28\u91CF\u3001\u901F\u5EA6\u3001\u7406\u89E3\u504F\u5DEE",
  },
  {
    value: "experience",
    label: "\u4F7F\u7528\u4F53\u9A8C",
    hint: "\u64CD\u4F5C\u4E0D\u987A\u624B\u3001\u754C\u9762\u4E0D\u6E05\u6670",
  },
  {
    value: "other",
    label: "\u5176\u4ED6",
    hint: "\u4EE5\u4E0A\u90FD\u4E0D\u662F",
  },
];
function feedbackTypeLabel(type) {
  return (
    FEEDBACK_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
  );
}
const FEEDBACK_STATUS_META = {
  submitted: {
    label: "\u5DF2\u63D0\u4EA4",
    reporterHint:
      "\u5DF2\u6536\u5230\uFF0C\u7B49\u5F85\u7BA1\u7406\u5458\u5206\u7C7B",
    tone: "blue",
  },
  triaged: {
    label: "\u5DF2\u5206\u7C7B",
    reporterHint:
      "\u7BA1\u7406\u5458\u5DF2\u786E\u8BA4\u95EE\u9898\u5F52\u5C5E",
    tone: "indigo",
  },
  planned: {
    label: "\u5DF2\u6392\u671F",
    reporterHint: "\u5DF2\u7EB3\u5165\u5F00\u53D1\u8BA1\u5212",
    tone: "violet",
  },
  developing: {
    label: "\u5F00\u53D1\u4E2D",
    reporterHint:
      "\u6B63\u5728\u5904\u7406\uFF0C\u53EF\u968F\u65F6\u8865\u5145\u4FE1\u606F",
    tone: "amber",
  },
  awaiting_acceptance: {
    label: "\u5F85\u9A8C\u6536",
    reporterHint:
      "\u5DF2\u5904\u7406\u5B8C\u6210\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u89E3\u51B3",
    tone: "teal",
  },
  reopened: {
    label: "\u5DF2\u91CD\u5F00",
    reporterHint:
      "\u9A8C\u6536\u672A\u901A\u8FC7\uFF0C\u7B49\u5F85\u518D\u6B21\u5904\u7406",
    tone: "rose",
  },
  closed: {
    label: "\u5DF2\u5173\u95ED",
    reporterHint:
      "\u5DF2\u9A8C\u6536\u901A\u8FC7\uFF0C\u611F\u8C22\u53CD\u9988",
    tone: "green",
  },
};
const FEEDBACK_STATUS_ORDER = [
  "submitted",
  "triaged",
  "planned",
  "developing",
  "awaiting_acceptance",
  "reopened",
  "closed",
];
function feedbackStatusLabel(status) {
  return FEEDBACK_STATUS_META[status]?.label ?? status;
}
const FEEDBACK_PRIORITY_META = {
  unassigned: { label: "\u672A\u5B9A\u7EA7", tone: "gray" },
  p0: { label: "P0 \u7D27\u6025", tone: "red" },
  p1: { label: "P1 \u9AD8", tone: "orange" },
  p2: { label: "P2 \u4E2D", tone: "amber" },
  p3: { label: "P3 \u4F4E", tone: "slate" },
};
const FEEDBACK_PRIORITY_ORDER = ["p0", "p1", "p2", "p3"];
function feedbackPriorityLabel(priority) {
  return FEEDBACK_PRIORITY_META[priority]?.label ?? priority;
}
const FEEDBACK_EVENT_LABELS = {
  submitted: "\u63D0\u4EA4\u53CD\u9988",
  reporter_replied: "\u8865\u5145\u8BF4\u660E",
  triaged: "\u5B8C\u6210\u5206\u7C7B",
  priority_changed: "\u8C03\u6574\u4F18\u5148\u7EA7",
  planned: "\u7EB3\u5165\u6392\u671F",
  development_started: "\u5F00\u59CB\u5F00\u53D1",
  acceptance_requested: "\u8BF7\u6C42\u9A8C\u6536",
  acceptance_rejected: "\u9A8C\u6536\u4E0D\u901A\u8FC7",
  acceptance_approved: "\u9A8C\u6536\u901A\u8FC7",
  admin_note: "\u7BA1\u7406\u5458\u5907\u6CE8",
  ai_assessed: "AI \u8BC4\u4F30",
  ai_assessment_failed: "AI \u8BC4\u4F30\u5931\u8D25",
};
const FEEDBACK_AI_STATE_LABELS = {
  pending: "AI \u8BC4\u4F30\u6392\u961F\u4E2D",
  running: "AI \u8BC4\u4F30\u4E2D",
  completed: "AI \u5DF2\u8BC4\u4F30",
  failed: "AI \u8BC4\u4F30\u5931\u8D25",
  skipped: "\u672A\u542F\u7528 AI \u8BC4\u4F30",
};
function feedbackAIStateLabel(state) {
  return FEEDBACK_AI_STATE_LABELS[state] ?? state;
}
function feedbackAIApplyReasonLabel(assessment) {
  switch (assessment.apply_reason) {
    case "auto_applied":
      return "\u5DF2\u81EA\u52A8\u5B9A\u7EA7";
    case "administrator_priority_kept":
      return "\u7BA1\u7406\u5458\u5DF2\u624B\u52A8\u5B9A\u7EA7\uFF0CAI \u4EC5\u4F5C\u5EFA\u8BAE";
    case "low_confidence":
      return "\u7F6E\u4FE1\u5EA6\u4E0D\u8DB3\uFF0C\u4EC5\u4F5C\u5EFA\u8BAE";
    case "status_not_allowed":
      return "\u5F53\u524D\u9636\u6BB5\u4E0D\u518D\u6539\u4F18\u5148\u7EA7\uFF0C\u4EC5\u4F5C\u5EFA\u8BAE";
    case "unchanged":
      return "\u4E0E\u5F53\u524D\u4F18\u5148\u7EA7\u4E00\u81F4";
    case "auto_apply_disabled":
      return "\u81EA\u52A8\u5B9A\u7EA7\u5DF2\u5173\u95ED\uFF0C\u4EC5\u4F5C\u5EFA\u8BAE";
    default:
      return assessment.applied
        ? "\u5DF2\u5E94\u7528"
        : "\u4EC5\u4F5C\u5EFA\u8BAE";
  }
}
function feedbackAIInProgress(state) {
  return state === "pending" || state === "running";
}
function feedbackEventLabel(type) {
  return FEEDBACK_EVENT_LABELS[type] ?? type;
}
function feedbackActorLabel(actorType) {
  switch (actorType) {
    case "reporter":
      return "\u63D0\u4EA4\u4EBA";
    case "administrator":
      return "\u7BA1\u7406\u5458";
    case "system":
      return "\u7CFB\u7EDF";
    default:
      return actorType;
  }
}
function reporterCanReply(status) {
  return ["submitted", "triaged", "planned", "developing", "reopened"].includes(
    status,
  );
}
function reporterCanAccept(status) {
  return status === "awaiting_acceptance";
}
function adminActionsForStatus(status) {
  const advance = [];
  switch (status) {
    case "submitted":
      advance.push({
        action: "triage",
        label: "\u5B8C\u6210\u5206\u7C7B",
        kind: "advance",
      });
      break;
    case "triaged":
      advance.push({
        action: "plan",
        label: "\u7EB3\u5165\u6392\u671F",
        kind: "advance",
      });
      break;
    case "planned":
    case "reopened":
      advance.push({
        action: "start_development",
        label: "\u5F00\u59CB\u5F00\u53D1",
        kind: "advance",
      });
      break;
    case "developing":
      advance.push({
        action: "request_acceptance",
        label: "\u8BF7\u6C42\u7528\u6237\u9A8C\u6536",
        kind: "advance",
      });
      break;
    default:
      break;
  }
  const aux = [];
  if (
    ["submitted", "triaged", "planned", "developing", "reopened"].includes(
      status,
    )
  ) {
    aux.push({
      action: "set_priority",
      label: "\u8BBE\u7F6E\u4F18\u5148\u7EA7",
      kind: "aux",
      needsPriority: true,
    });
  }
  if (status !== "closed") {
    aux.push({
      action: "note",
      label: "\u6DFB\u52A0\u5907\u6CE8",
      kind: "aux",
      bodyRequired: true,
    });
  }
  return [...advance, ...aux];
}
const FEEDBACK_AI_FORMULA_HINT =
  "\u4F18\u5148\u7EA7\u5F97\u5206 = 0.55\xD7\u91CD\u8981\u5EA6 + 0.45\xD7\u5F71\u54CD\u9762 \u2212 0.3\xD7(\u96BE\u5EA6\u22123)\uFF1B\u22654.4\u2192P0\uFF0C\u22653.5\u2192P1\uFF0C\u22652.5\u2192P2\uFF0C\u5176\u4F59 P3\uFF1B\u529F\u80FD\u6545\u969C\u4E14\u5F71\u54CD\u9762\u22654 \u81F3\u5C11 P1\u3002";
function formatFeedbackDateTime(iso) {
  if (!iso) return "\u2014";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "\u2014";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatFeedbackRelative(iso) {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diffMinutes = Math.floor((Date.now() - time) / 6e4);
  if (diffMinutes < 1) return "\u521A\u521A";
  if (diffMinutes < 60) return `${diffMinutes} \u5206\u949F\u524D`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} \u5929\u524D`;
  return formatFeedbackDateTime(iso);
}
function feedbackSummary(feedback, maxChars = 90) {
  const text = feedback.content.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\u2026";
}
function formatFeedbackBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function collectFeedbackClientContext() {
  if (typeof window === "undefined") return {};
  const context = {
    route: window.location.pathname,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    device_pixel_ratio: window.devicePixelRatio ?? 1,
    user_agent: navigator.userAgent,
    language: navigator.language,
    online: navigator.onLine,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    captured_at: /* @__PURE__ */ new Date().toISOString(),
  };
  return context;
}
const FEEDBACK_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const FEEDBACK_SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/webp";
const FEEDBACK_CONTENT_MAX_CHARS = 1e4;
export {
  FEEDBACK_AI_FORMULA_HINT,
  FEEDBACK_AI_STATE_LABELS,
  FEEDBACK_CONTENT_MAX_CHARS,
  FEEDBACK_EVENT_LABELS,
  FEEDBACK_PRIORITY_META,
  FEEDBACK_PRIORITY_ORDER,
  FEEDBACK_SCREENSHOT_ACCEPT,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_STATUS_META,
  FEEDBACK_STATUS_ORDER,
  FEEDBACK_TYPE_OPTIONS,
  adminActionsForStatus,
  collectFeedbackClientContext,
  feedbackAIApplyReasonLabel,
  feedbackAIInProgress,
  feedbackAIStateLabel,
  feedbackActorLabel,
  feedbackEventLabel,
  feedbackPriorityLabel,
  feedbackStatusLabel,
  feedbackSummary,
  feedbackTypeLabel,
  formatFeedbackBytes,
  formatFeedbackDateTime,
  formatFeedbackRelative,
  reporterCanAccept,
  reporterCanReply,
};
