import { useEffect, useState } from "react";
import {
  acceptProductFeedback,
  replyProductFeedback,
  runAdminProductFeedbackAction,
} from "../../api/productFeedback";
import {
  FeedbackPriorityBadge,
  FeedbackStatusBadge,
  FeedbackTypeTag,
} from "./FeedbackBadges";
import FeedbackEvidenceImage from "./FeedbackEvidenceImage";
import FeedbackPipeline from "./FeedbackPipeline";
import FeedbackAIAssessmentCard from "./FeedbackAIAssessmentCard";
import FeedbackTimeline from "./FeedbackTimeline";
import {
  FEEDBACK_PRIORITY_META,
  FEEDBACK_PRIORITY_ORDER,
  FEEDBACK_STATUS_META,
  adminActionsForStatus,
  formatFeedbackDateTime,
  reporterCanAccept,
  reporterCanReply,
} from "./feedbackLabels";
import "./product-feedback.css";
const CONTEXT_LABELS = {
  route: "\u8DEF\u7531",
  viewport: "\u89C6\u53E3",
  screen: "\u5C4F\u5E55",
  device_pixel_ratio: "DPR",
  user_agent: "UA",
  language: "\u8BED\u8A00",
  online: "\u5728\u7EBF",
  timezone: "\u65F6\u533A",
  captured_at: "\u91C7\u96C6\u65F6\u95F4",
};
function contextEntries(context) {
  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== void 0 && value !== "")
    .slice(0, 24)
    .map(([key, value]) => [
      CONTEXT_LABELS[key] ?? key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
}
function FeedbackDetailPanel({
  feedback,
  scope,
  onChanged,
  onReload,
  onNotify,
}) {
  const statusMeta = FEEDBACK_STATUS_META[feedback.status];
  return (
    <div className="pf-card pf-detail">
      <div className="pf-detail-header">
        <FeedbackTypeTag type={feedback.feedback_type} />
        <FeedbackStatusBadge status={feedback.status} />
        <FeedbackPriorityBadge priority={feedback.priority} />
        <span className="pf-detail-version">
          编号 {feedback.id.slice(0, 8)} · 版本 v{feedback.version}
        </span>
      </div>

      <FeedbackPipeline status={feedback.status} />

      {scope === "mine" && statusMeta && (
        <p className="pf-detail-hint">{statusMeta.reporterHint}</p>
      )}

      <p className="pf-detail-content">{feedback.content}</p>

      <div className="pf-section-title">页面信息</div>
      <dl className="pf-meta-grid">
        <div>
          <dt>页面</dt>
          <dd>
            {feedback.page_title && <span>{feedback.page_title} · </span>}
            <a href={feedback.page_url} target="_blank" rel="noreferrer">
              {feedback.page_url}
            </a>
          </dd>
        </div>
        <div>
          <dt>提交时间</dt>
          <dd>{formatFeedbackDateTime(feedback.submitted_at)}</dd>
        </div>
        {feedback.triaged_at && (
          <div>
            <dt>分类时间</dt>
            <dd>{formatFeedbackDateTime(feedback.triaged_at)}</dd>
          </div>
        )}
        {feedback.awaiting_acceptance_at && (
          <div>
            <dt>请求验收时间</dt>
            <dd>{formatFeedbackDateTime(feedback.awaiting_acceptance_at)}</dd>
          </div>
        )}
        {feedback.closed_at && (
          <div>
            <dt>关闭时间</dt>
            <dd>{formatFeedbackDateTime(feedback.closed_at)}</dd>
          </div>
        )}
        <div>
          <dt>来源平台</dt>
          <dd>
            {feedback.source_platform} / {feedback.source_instance_key}
          </dd>
        </div>
      </dl>

      {contextEntries(feedback.client_context).length > 0 && (
        <>
          <div className="pf-section-title">客户端环境</div>
          <dl className="pf-context-list">
            {contextEntries(feedback.client_context).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {feedback.evidence.length > 0 && (
        <>
          <div className="pf-section-title">截图</div>
          <div className="pf-evidence-grid">
            {feedback.evidence.map((item) => (
              <FeedbackEvidenceImage
                key={item.id}
                feedbackID={feedback.id}
                evidence={item}
                scope={scope}
              />
            ))}
          </div>
        </>
      )}

      <div className="pf-section-title">处理过程</div>
      <FeedbackTimeline events={feedback.events} />

      {scope === "mine" ? (
        <ReporterActions
          feedback={feedback}
          onChanged={onChanged}
          onReload={onReload}
          onNotify={onNotify}
        />
      ) : (
        <AdminActions
          feedback={feedback}
          onChanged={onChanged}
          onReload={onReload}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
function ReporterActions({ feedback, onChanged, onReload, onNotify }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  useEffect(() => {
    setBody("");
    setDecision(null);
  }, [feedback.id, feedback.version]);
  const run = async (task, successMessage) => {
    setBusy(true);
    try {
      const updated = await task();
      onChanged(updated);
      onNotify(successMessage);
    } catch (e) {
      onNotify(
        e instanceof Error ? e.message : "\u64CD\u4F5C\u5931\u8D25",
        true,
      );
      onReload();
    } finally {
      setBusy(false);
    }
  };
  if (feedback.status === "closed") {
    return (
      <div className="pf-actions">
        <h4>已关闭</h4>
        <p className="pf-notice">
          这条反馈已验收通过并关闭。如再次遇到问题，请重新提交一条反馈。
        </p>
      </div>
    );
  }
  if (reporterCanAccept(feedback.status)) {
    return (
      <div className="pf-actions">
        <h4>请确认问题是否已解决</h4>
        <p className="pf-notice">
          管理员已处理完成并请求你验收。通过即关闭；不通过会重新打开并回到开发。
        </p>
        {decision === "reject" && (
          <textarea
            className="pf-textarea"
            value={body}
            placeholder="请说明仍存在的问题（必填）"
            onChange={(event) => setBody(event.target.value)}
          />
        )}
        <div className="pf-actions-row">
          {decision !== "reject" ? (
            <>
              <button
                type="button"
                className="pf-btn pf-btn-success"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      acceptProductFeedback(
                        feedback.id,
                        true,
                        body.trim(),
                        feedback.version,
                      ),
                    "\u5DF2\u9A8C\u6536\u901A\u8FC7\uFF0C\u53CD\u9988\u5173\u95ED",
                  )
                }
              >
                验收通过
              </button>
              <button
                type="button"
                className="pf-btn pf-btn-danger"
                disabled={busy}
                onClick={() => setDecision("reject")}
              >
                验收不通过
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pf-btn pf-btn-danger"
                disabled={busy || body.trim().length === 0}
                onClick={() =>
                  run(
                    () =>
                      acceptProductFeedback(
                        feedback.id,
                        false,
                        body.trim(),
                        feedback.version,
                      ),
                    "\u5DF2\u63D0\u4EA4\u9A8C\u6536\u4E0D\u901A\u8FC7\uFF0C\u53CD\u9988\u91CD\u65B0\u6253\u5F00",
                  )
                }
              >
                确认不通过
              </button>
              <button
                type="button"
                className="pf-btn"
                disabled={busy}
                onClick={() => setDecision(null)}
              >
                返回
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  if (reporterCanReply(feedback.status)) {
    return (
      <div className="pf-actions">
        <h4>补充说明</h4>
        <textarea
          className="pf-textarea"
          value={body}
          placeholder="补充复现步骤、影响范围或新的发现…"
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="pf-actions-row">
          <button
            type="button"
            className="pf-btn pf-btn-primary"
            disabled={busy || body.trim().length === 0}
            onClick={() =>
              run(
                () =>
                  replyProductFeedback(
                    feedback.id,
                    body.trim(),
                    feedback.version,
                  ),
                "\u5DF2\u8865\u5145\u8BF4\u660E",
              )
            }
          >
            {busy ? "\u63D0\u4EA4\u4E2D\u2026" : "\u63D0\u4EA4\u8865\u5145"}
          </button>
        </div>
      </div>
    );
  }
  return null;
}
function AdminActions({ feedback, onChanged, onReload, onNotify }) {
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(
    feedback.priority === "unassigned" ? "p2" : feedback.priority,
  );
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    setBody("");
    setPriority(feedback.priority === "unassigned" ? "p2" : feedback.priority);
  }, [feedback.id, feedback.version, feedback.priority]);
  const options = adminActionsForStatus(feedback.status);
  const run = async (action, label) => {
    setBusy(action);
    try {
      const updated = await runAdminProductFeedbackAction(feedback.id, {
        action,
        priority: action === "set_priority" ? priority : void 0,
        body: body.trim(),
        expected_version: feedback.version,
      });
      onChanged(updated);
      onNotify(`\u5DF2${label}`);
    } catch (e) {
      onNotify(
        e instanceof Error ? e.message : "\u64CD\u4F5C\u5931\u8D25",
        true,
      );
      onReload();
    } finally {
      setBusy(null);
    }
  };
  const aiCard = (
    <FeedbackAIAssessmentCard
      feedback={feedback}
      busy={busy !== null}
      onReassess={() => run("reassess", "\u89E6\u53D1\u91CD\u65B0\u8BC4\u4F30")}
    />
  );
  if (feedback.status === "closed") {
    return (
      <>
        {aiCard}
        <div className="pf-actions">
          <h4>已关闭</h4>
          <p className="pf-notice">
            提交人已验收通过，本条反馈进入终态，不再接受任何动作。
          </p>
        </div>
      </>
    );
  }
  const advance = options.filter((option) => option.kind === "advance");
  const aux = options.filter((option) => option.kind === "aux");
  return (
    <>
      {aiCard}
      <div className="pf-actions">
        <h4>治理动作</h4>
        {advance.length > 0 ? (
          <p className="pf-actions-next">
            流程按步推进，当前只放行下一步：
            <strong>{advance.map((option) => option.label).join(" / ")}</strong>
            ；优先级与备注随时可加。
          </p>
        ) : feedback.status === "awaiting_acceptance" ? (
          <p className="pf-notice">
            已请求提交人验收；通过后自动关闭，不通过会回到「已重开」并可再次开始开发。此阶段只能添加备注。
          </p>
        ) : null}
        <textarea
          className="pf-textarea"
          value={body}
          placeholder="随本次动作记录的说明（备注为必填，其他动作可选）；提交人可见。"
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="pf-actions-row">
          {advance.map((option) => (
            <button
              key={option.action}
              type="button"
              className="pf-btn pf-btn-primary"
              disabled={busy !== null}
              onClick={() => run(option.action, option.label)}
            >
              {busy === option.action
                ? "\u5904\u7406\u4E2D\u2026"
                : `\u4E0B\u4E00\u6B65\uFF1A${option.label}`}
            </button>
          ))}
          {aux.map((option) =>
            option.needsPriority ? (
              <span
                key={option.action}
                className="pf-actions-row"
                style={{ marginTop: 0 }}
              >
                <select
                  className="pf-select"
                  style={{ width: "auto", height: 36 }}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  {FEEDBACK_PRIORITY_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {FEEDBACK_PRIORITY_META[value].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pf-btn"
                  disabled={busy !== null || priority === feedback.priority}
                  onClick={() => run(option.action, option.label)}
                >
                  {option.label}
                </button>
              </span>
            ) : (
              <button
                key={option.action}
                type="button"
                className="pf-btn"
                disabled={
                  busy !== null ||
                  (option.bodyRequired && body.trim().length === 0)
                }
                onClick={() => run(option.action, option.label)}
              >
                {option.label}
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );
}
export { FeedbackDetailPanel as default };
