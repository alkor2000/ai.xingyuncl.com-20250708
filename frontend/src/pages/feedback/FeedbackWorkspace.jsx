import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Inbox,
  MessageSquarePlus,
  RefreshCw,
} from "../../components/product-feedback/icons";
import { useAuth } from "../../components/product-feedback/auth";
import PortalLogo from "../../components/product-feedback/PortalLogo";
import {
  getAdminProductFeedback,
  getAdminProductFeedbackStats,
  getMyProductFeedback,
  listAdminProductFeedback,
  listMyProductFeedback,
  runAdminProductFeedbackAction,
} from "../../api/productFeedback";
import FeedbackDetailPanel from "../../components/product-feedback/FeedbackDetailPanel";
import FeedbackDialog from "../../components/product-feedback/FeedbackDialog";
import FeedbackQueueItem from "../../components/product-feedback/FeedbackQueueItem";
import FeedbackSummaryStrip from "../../components/product-feedback/FeedbackSummaryStrip";
import {
  FEEDBACK_PRIORITY_META,
  FEEDBACK_PRIORITY_ORDER,
  FEEDBACK_STATUS_META,
  FEEDBACK_STATUS_ORDER,
  adminActionsForStatus,
  feedbackAIInProgress,
} from "../../components/product-feedback/feedbackLabels";
import "../../components/product-feedback/product-feedback.css";
const PAGE_SIZE = 20;
function FeedbackWorkspace({ scope }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id: selectedID } = useParams();
  const basePath = scope === "admin" ? "/feedback/hub" : "/feedback";
  const canOpenInHub = scope === "mine" && user?.role === "admin";
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [stats, setStats] = useState(null);
  const [selectedIDs, setSelectedIDs] = useState(
    () => /* @__PURE__ */ new Set(),
  );
  const [batchPriority, setBatchPriority] = useState("p2");
  const [batchBusy, setBatchBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const notify = useCallback((message, isError = false) => {
    setToast({ message, isError });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  const loadList = useCallback(async () => {
    const requestID = ++listRequest.current;
    setListLoading(true);
    const query = { status, priority, limit: PAGE_SIZE, offset };
    try {
      const data =
        scope === "admin"
          ? await listAdminProductFeedback(query)
          : await listMyProductFeedback(query);
      if (requestID !== listRequest.current) return;
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      if (requestID !== listRequest.current) return;
      notify(
        e instanceof Error
          ? e.message
          : "\u52A0\u8F7D\u53CD\u9988\u5217\u8868\u5931\u8D25",
        true,
      );
    } finally {
      if (requestID === listRequest.current) setListLoading(false);
    }
  }, [scope, status, priority, offset, notify]);
  const loadStats = useCallback(async () => {
    if (scope !== "admin") return;
    try {
      setStats(await getAdminProductFeedbackStats());
    } catch {}
  }, [scope]);
  const loadDetail = useCallback(async () => {
    if (!selectedID) {
      setDetail(null);
      setDetailError("");
      return;
    }
    const requestID = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const data =
        scope === "admin"
          ? await getAdminProductFeedback(selectedID)
          : await getMyProductFeedback(selectedID);
      if (requestID !== detailRequest.current) return;
      setDetail(data);
    } catch (e) {
      if (requestID !== detailRequest.current) return;
      setDetail(null);
      setDetailError(
        e instanceof Error
          ? e.message
          : "\u52A0\u8F7D\u53CD\u9988\u8BE6\u60C5\u5931\u8D25",
      );
    } finally {
      if (requestID === detailRequest.current) setDetailLoading(false);
    }
  }, [scope, selectedID]);
  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);
  useEffect(() => {
    loadStats();
  }, [loadStats, items]);
  const aiInProgress = Boolean(
    detail && feedbackAIInProgress(detail.ai_assessment_state),
  );
  useEffect(() => {
    if (!aiInProgress || !selectedID) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 60) {
        window.clearInterval(timer);
        return;
      }
      loadDetail();
    }, 3e3);
    return () => window.clearInterval(timer);
  }, [aiInProgress, selectedID, loadDetail]);
  useEffect(() => {
    if (!detail) return;
    setItems((current) =>
      current.map((item) =>
        item.id === detail.id ? { ...item, ...detail } : item,
      ),
    );
  }, [detail]);
  const applyChanged = (updated) => {
    setDetail((current) =>
      current && current.id === updated.id ? updated : current,
    );
    setItems((current) =>
      current.map((item) =>
        item.id === updated.id ? { ...item, ...updated } : item,
      ),
    );
  };
  const runInlineAction = async (item, action, priority2) => {
    try {
      const updated = await runAdminProductFeedbackAction(item.id, {
        action,
        priority: priority2,
        expected_version: item.version,
      });
      applyChanged(updated);
      notify(
        `\u5DF2${adminActionsForStatus(item.status).find((option) => option.action === action)?.label ?? "\u5904\u7406"}`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "\u64CD\u4F5C\u5931\u8D25", true);
      loadList();
    }
  };
  const toggleSelect = (id) => {
    setSelectedIDs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIDs(/* @__PURE__ */ new Set());
  const runBatch = async (action, priority2) => {
    const targets = items.filter((item) => selectedIDs.has(item.id));
    if (targets.length === 0) return;
    setBatchBusy(true);
    let done = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of targets) {
      const allowed = adminActionsForStatus(item.status).some(
        (option) => option.action === action,
      );
      if (
        !allowed ||
        (action === "set_priority" && item.priority === priority2)
      ) {
        skipped += 1;
        continue;
      }
      try {
        const updated = await runAdminProductFeedbackAction(item.id, {
          action,
          priority: priority2,
          expected_version: item.version,
        });
        applyChanged(updated);
        done += 1;
      } catch {
        failed += 1;
      }
    }
    setBatchBusy(false);
    clearSelection();
    const parts = [`\u5DF2\u5904\u7406 ${done} \u6761`];
    if (skipped > 0)
      parts.push(
        `\u8DF3\u8FC7 ${skipped} \u6761\uFF08\u72B6\u6001\u4E0D\u5141\u8BB8\u6216\u65E0\u53D8\u5316\uFF09`,
      );
    if (failed > 0) parts.push(`\u5931\u8D25 ${failed} \u6761`);
    notify(parts.join("\uFF0C"), failed > 0);
    if (failed > 0) loadList();
  };
  const selectedItems = items.filter((item) => selectedIDs.has(item.id));
  const batchActionAvailable = (action) =>
    selectedItems.some((item) =>
      adminActionsForStatus(item.status).some(
        (option) => option.action === action,
      ),
    );
  const onSubmitted = () => {
    setOffset(0);
    loadList();
  };
  const isAdmin = scope === "admin";
  const hasDetail = Boolean(selectedID);
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  return (
    <div className="pf-page">
      <div className="pf-shell">
        <header className="pf-page-header">
          <div className="pf-page-heading">
            <PortalLogo />
            <div>
              <div className="pf-page-eyebrow">AI 平台 · 功能反馈</div>
              <h1>
                {isAdmin
                  ? "\u53CD\u9988\u4E2D\u5FC3"
                  : "\u6211\u7684\u53CD\u9988"}
              </h1>
              <p>
                {isAdmin
                  ? "\u8DE8\u5E73\u53F0\u53CD\u9988\u7684\u4E2D\u592E\u961F\u5217\uFF1A\u5206\u7C7B\u3001\u6392\u671F\u3001\u5F00\u53D1\u3001\u8BF7\u6C42\u9A8C\u6536\uFF1B\u5173\u95ED\u53EA\u80FD\u7531\u63D0\u4EA4\u4EBA\u9A8C\u6536\u5B8C\u6210\u3002"
                  : "\u4F60\u63D0\u4EA4\u7684\u529F\u80FD\u53CD\u9988\u4E0E\u5904\u7406\u8FDB\u5EA6\uFF1B\u5904\u7406\u5B8C\u6210\u540E\u9700\u8981\u4F60\u786E\u8BA4\u9A8C\u6536\u3002"}
              </p>
            </div>
          </div>
          <div className="pf-page-actions">
            <button
              type="button"
              className="pf-btn"
              onClick={() => navigate("/")}
            >
              <ArrowLeft size={16} />
              返回入口
            </button>
            <button
              type="button"
              className="pf-btn"
              disabled={listLoading}
              onClick={() => {
                loadList();
                loadDetail();
              }}
            >
              <RefreshCw
                size={15}
                className={listLoading ? "is-spinning" : ""}
              />
              刷新
            </button>
            {!isAdmin && (
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                onClick={() => setDialogOpen(true)}
              >
                <MessageSquarePlus size={15} />
                提交反馈
              </button>
            )}
          </div>
        </header>

        {isAdmin && (
          <FeedbackSummaryStrip
            stats={stats}
            activeStatus={status}
            onSelect={(next) => {
              setStatus(next);
              setOffset(0);
              clearSelection();
            }}
          />
        )}

        <div
          className={`pf-workspace${hasDetail ? " has-detail" : " is-list-only"}`}
        >
          <section className="pf-card pf-list-column">
            <div className="pf-filters">
              <select
                className="pf-select"
                aria-label="按状态筛选"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部状态</option>
                {FEEDBACK_STATUS_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {FEEDBACK_STATUS_META[value].label}
                  </option>
                ))}
              </select>
              {isAdmin && (
                <select
                  className="pf-select"
                  aria-label="按优先级筛选"
                  value={priority}
                  onChange={(event) => {
                    setPriority(event.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">全部优先级</option>
                  <option value="unassigned">
                    {FEEDBACK_PRIORITY_META.unassigned.label}
                  </option>
                  {FEEDBACK_PRIORITY_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {FEEDBACK_PRIORITY_META[value].label}
                    </option>
                  ))}
                </select>
              )}
              {isAdmin && items.length > 0 && (
                <label className="pf-filters-selectall">
                  <input
                    type="checkbox"
                    className="pf-list-check"
                    checked={selectedItems.length === items.length}
                    onChange={(event) =>
                      setSelectedIDs(
                        event.target.checked
                          ? new Set(items.map((item) => item.id))
                          : /* @__PURE__ */ new Set(),
                      )
                    }
                  />
                  本页全选
                </label>
              )}
              <span className="pf-filters-count">
                {listLoading
                  ? "\u52A0\u8F7D\u4E2D\u2026"
                  : `\u5171 ${total} \u6761`}
              </span>
            </div>

            {isAdmin && selectedItems.length > 0 && (
              <div className="pf-batch-bar">
                <strong>已选 {selectedItems.length} 条</strong>
                {[
                  "triage",
                  "plan",
                  "start_development",
                  "request_acceptance",
                ].map((action) => {
                  const label = {
                    triage: "\u5B8C\u6210\u5206\u7C7B",
                    plan: "\u7EB3\u5165\u6392\u671F",
                    start_development: "\u5F00\u59CB\u5F00\u53D1",
                    request_acceptance: "\u8BF7\u6C42\u9A8C\u6536",
                  }[action];
                  return (
                    <button
                      key={action}
                      type="button"
                      className="pf-btn pf-btn-sm pf-btn-primary"
                      disabled={batchBusy || !batchActionAvailable(action)}
                      onClick={() => runBatch(action)}
                    >
                      {label}
                    </button>
                  );
                })}
                <select
                  className="pf-select pf-select-sm"
                  aria-label="批量设置优先级"
                  value={batchPriority}
                  disabled={batchBusy}
                  onChange={(event) => setBatchPriority(event.target.value)}
                >
                  {FEEDBACK_PRIORITY_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {FEEDBACK_PRIORITY_META[value].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pf-btn pf-btn-sm"
                  disabled={batchBusy || !batchActionAvailable("set_priority")}
                  onClick={() => runBatch("set_priority", batchPriority)}
                >
                  设为该优先级
                </button>
                <button
                  type="button"
                  className="pf-btn pf-btn-sm"
                  disabled={batchBusy}
                  onClick={clearSelection}
                >
                  取消选择
                </button>
              </div>
            )}

            <div className="pf-list">
              {!listLoading && items.length === 0 ? (
                <div className="pf-empty">
                  <strong>
                    {isAdmin
                      ? "\u961F\u5217\u4E3A\u7A7A"
                      : "\u8FD8\u6CA1\u6709\u53CD\u9988"}
                  </strong>
                  {isAdmin
                    ? "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u53CD\u9988\u3002"
                    : "\u9047\u5230\u95EE\u9898\u6216\u6709\u5EFA\u8BAE\uFF1F\u70B9\u53F3\u4E0A\u89D2\u300C\u63D0\u4EA4\u53CD\u9988\u300D\u3002"}
                </div>
              ) : (
                items.map((item) => (
                  <FeedbackQueueItem
                    key={item.id}
                    item={item}
                    active={item.id === selectedID}
                    admin={isAdmin}
                    selected={selectedIDs.has(item.id)}
                    busy={batchBusy}
                    onOpen={() => navigate(`${basePath}/${item.id}`)}
                    onToggleSelect={
                      isAdmin ? () => toggleSelect(item.id) : void 0
                    }
                    onAction={
                      isAdmin
                        ? (action, priority2) =>
                            runInlineAction(item, action, priority2)
                        : void 0
                    }
                  />
                ))
              )}
            </div>

            {total > PAGE_SIZE && (
              <div className="pf-pagination">
                <span>
                  {pageStart}–{pageEnd} / {total}
                </span>
                <span className="pf-page-actions">
                  <button
                    type="button"
                    className="pf-btn pf-btn-sm"
                    disabled={offset === 0 || listLoading}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn-sm"
                    disabled={pageEnd >= total || listLoading}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    下一页
                  </button>
                </span>
              </div>
            )}
          </section>

          {hasDetail && (
            <section>
              <div
                className="pf-actions-row"
                style={{ marginTop: 0, marginBottom: 10 }}
              >
                <button
                  type="button"
                  className="pf-btn pf-btn-sm"
                  onClick={() => navigate(basePath)}
                >
                  <ArrowLeft size={14} />
                  返回列表
                </button>
                {canOpenInHub && selectedID && (
                  <button
                    type="button"
                    className="pf-btn pf-btn-sm"
                    onClick={() => navigate(`/feedback/hub/${selectedID}`)}
                  >
                    <Inbox size={14} />
                    去反馈中心处理
                  </button>
                )}
              </div>
              {detailLoading && !detail ? (
                <div className="pf-card pf-loading">加载详情中…</div>
              ) : detailError ? (
                <div className="pf-card pf-empty">
                  <strong>无法打开这条反馈</strong>
                  {detailError}
                </div>
              ) : detail ? (
                <FeedbackDetailPanel
                  feedback={detail}
                  scope={scope}
                  onChanged={applyChanged}
                  onReload={loadDetail}
                  onNotify={notify}
                />
              ) : null}
            </section>
          )}
        </div>
      </div>

      {!isAdmin && (
        <FeedbackDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSubmitted={onSubmitted}
        />
      )}

      {toast && (
        <div
          className={`pf-toast${toast.isError ? " is-error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
export { FeedbackWorkspace as default };
