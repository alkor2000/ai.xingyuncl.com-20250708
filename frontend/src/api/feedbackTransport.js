import apiClient from "../utils/api";
const pending = new Map();
async function fingerprint(url, data) {
  if (!(data instanceof FormData)) return url + ":" + JSON.stringify(data);
  const parts = [];
  for (const [key, value] of data.entries()) {
    if (value instanceof File) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await value.arrayBuffer(),
      );
      parts.push([
        key,
        value.name,
        Array.from(new Uint8Array(digest), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join(""),
      ]);
    } else parts.push([key, value]);
  }
  return url + ":" + JSON.stringify(parts);
}
async function request(method, url, data, config = {}) {
  let key, identity;
  if (method === "post") {
    identity = await fingerprint(url, data);
    key = pending.get(identity) || crypto.randomUUID();
    pending.set(identity, key);
    if (pending.size > 32) pending.delete(pending.keys().next().value);
  }
  try {
    const response = await apiClient.request({
      ...config,
      method,
      url,
      data,
      skipDebugLogging: true,
      headers: {
        ...config.headers,
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(data instanceof FormData ? { "Content-Type": undefined } : {}),
      },
    });
    if (key) pending.delete(identity);
    return response;
  } catch (error) {
    if (key && error.response?.status < 500) pending.delete(identity);
    let payload = error.response?.data;
    if (payload instanceof Blob) {
      try {
        payload = JSON.parse(await payload.text());
      } catch {
        payload = null;
      }
    }
    throw Object.assign(
      new Error(
        payload?.error?.message ||
          payload?.message ||
          "反馈服务暂不可用，请稍后重试",
      ),
      { status: error.response?.status },
    );
  }
}
export default {
  get: (url, config) => request("get", url, undefined, config),
  post: (url, data, config) => request("post", url, data, config),
};
