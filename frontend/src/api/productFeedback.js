import apiClient from "./feedbackTransport";
function unwrap(resp) {
  return resp?.data?.data;
}
function normalizeFeedback(item) {
  return {
    ...item,
    evidence: item.evidence ?? [],
    events: item.events ?? [],
    client_context: item.client_context ?? {},
    ai_assessment_state: item.ai_assessment_state ?? "skipped",
    ai_assessment: item.ai_assessment ?? null,
    ai_suggested_priority: item.ai_suggested_priority ?? "",
  };
}
function buildListParams(query) {
  const params = {
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
  };
  if (query.status) params.status = query.status;
  if (query.priority) params.priority = query.priority;
  return params;
}
function normalizeList(data, query) {
  return {
    items: (data?.items ?? []).map(normalizeFeedback),
    total: data?.total ?? 0,
    limit: data?.limit ?? query.limit ?? 20,
    offset: data?.offset ?? query.offset ?? 0,
  };
}
async function createProductFeedback(input) {
  const form = new FormData();
  form.append(
    "payload",
    JSON.stringify({
      feedback_type: input.feedback_type,
      content: input.content,
      page_url: input.page_url,
      page_title: input.page_title,
      client_context: input.client_context,
    }),
  );
  for (const screenshot of (input.screenshots ?? (input.screenshot ? [input.screenshot] : []))) {
    form.append('screenshot', screenshot, screenshot.name)
  }
  const resp = await apiClient.post("/product-feedback", form);
  const data = unwrap(resp);
  if (!data)
    throw new Error(
      "\u63D0\u4EA4\u6210\u529F\u4F46\u672A\u8FD4\u56DE\u53CD\u9988\u6570\u636E",
    );
  return normalizeFeedback(data);
}
async function listMyProductFeedback(query = {}) {
  const resp = await apiClient.get("/product-feedback", {
    params: buildListParams(query),
  });
  return normalizeList(unwrap(resp), query);
}
async function getMyProductFeedback(id) {
  const resp = await apiClient.get(
    "/product-feedback/" + encodeURIComponent(id),
  );
  const data = unwrap(resp);
  if (!data) throw new Error("\u53CD\u9988\u4E0D\u5B58\u5728");
  return normalizeFeedback(data);
}
async function replyProductFeedback(id, body, expectedVersion) {
  const resp = await apiClient.post(
    "/product-feedback/" + encodeURIComponent(id) + "/reply",
    {
      body,
      expected_version: expectedVersion,
    },
  );
  const data = unwrap(resp);
  if (!data) throw new Error("\u8865\u5145\u8BF4\u660E\u5931\u8D25");
  return normalizeFeedback(data);
}
async function acceptProductFeedback(id, approved, body, expectedVersion) {
  const resp = await apiClient.post(
    "/product-feedback/" + encodeURIComponent(id) + "/acceptance",
    {
      approved,
      body,
      expected_version: expectedVersion,
    },
  );
  const data = unwrap(resp);
  if (!data) throw new Error("\u9A8C\u6536\u63D0\u4EA4\u5931\u8D25");
  return normalizeFeedback(data);
}
async function listAdminProductFeedback(query = {}) {
  const resp = await apiClient.get("/admin/product-feedback", {
    params: buildListParams(query),
  });
  return normalizeList(unwrap(resp), query);
}
async function getAdminProductFeedback(id) {
  const resp = await apiClient.get(
    "/admin/product-feedback/" + encodeURIComponent(id),
  );
  const data = unwrap(resp);
  if (!data) throw new Error("\u53CD\u9988\u4E0D\u5B58\u5728");
  return normalizeFeedback(data);
}
async function getAdminProductFeedbackStats() {
  const resp = await apiClient.get("/admin/product-feedback/stats");
  const data = unwrap(resp);
  return {
    total: data?.total ?? 0,
    open: data?.open ?? 0,
    by_status: data?.by_status ?? {},
    by_priority: data?.by_priority ?? {},
    by_ai_state: data?.by_ai_state ?? {},
  };
}
async function runAdminProductFeedbackAction(id, input) {
  const resp = await apiClient.post(
    "/admin/product-feedback/" + encodeURIComponent(id) + "/actions",
    {
      action: input.action,
      priority: input.priority ?? "",
      body: input.body ?? "",
      expected_version: input.expected_version,
    },
  );
  const data = unwrap(resp);
  if (!data) throw new Error("\u6CBB\u7406\u52A8\u4F5C\u5931\u8D25");
  return normalizeFeedback(data);
}
async function fetchProductFeedbackEvidenceBlob(feedbackID, evidenceID, scope) {
  const prefix =
    scope === "admin" ? "/admin/product-feedback/" : "/product-feedback/";
  const resp = await apiClient.get(
    prefix +
      encodeURIComponent(feedbackID) +
      "/evidence/" +
      encodeURIComponent(evidenceID),
    { responseType: "blob" },
  );
  return resp.data;
}
export {
  acceptProductFeedback,
  createProductFeedback,
  fetchProductFeedbackEvidenceBlob,
  getAdminProductFeedback,
  getAdminProductFeedbackStats,
  getMyProductFeedback,
  listAdminProductFeedback,
  listMyProductFeedback,
  replyProductFeedback,
  runAdminProductFeedbackAction,
};

export async function listFeedbackNotifications(admin = false) {
  const resp = await apiClient.get(
    (admin ? "/admin" : "") + "/product-feedback/notifications",
  );
  return resp.data.data;
}
export async function readFeedbackNotification(id, admin = false) {
  await apiClient.post(
    (admin ? "/admin" : "") +
      "/product-feedback/notifications/" +
      encodeURIComponent(id) +
      "/read",
    {},
  );
}
