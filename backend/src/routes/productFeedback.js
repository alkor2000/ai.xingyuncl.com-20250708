"use strict";
const express = require("express");
const crypto = require("node:crypto");
const bridge = require("../services/productFeedback/bridge");
const { authenticate } = require("../middleware/authMiddleware");
const rateLimit = require("express-rate-limit");
function mount(app) {
  for (const admin of [false, true]) {
    const prefix = admin
      ? "/api/admin/product-feedback"
      : "/api/product-feedback";
    const router = express.Router();
    router.use((req, res, next) => {
      res.set("X-Request-ID", crypto.randomUUID());
      const json = res.json.bind(res);
      res.json = (body) => {
        if (body && typeof body === "object") {
          body.schema_version = 1;
          body.request_id = res.getHeader("X-Request-ID");
          if (res.statusCode >= 400)
            body.error = {
              code: "feedback_adapter_error",
              message: body.message || "反馈请求失败",
              retryable: res.statusCode >= 500,
            };
        }
        return json(body);
      };
      res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      if (!req.headers.authorization?.startsWith("Bearer "))
        return res.status(401).json({ code: 401, message: "请先登录" });
      next();
    });
    router.use(authenticate);
    router.use(
      rateLimit({
        windowMs: 60000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => String(req.user.id),
      }),
    );
    router.use(express.raw({ type: () => true, limit: "6mb" }));
    router.use(async (req, res) => {
      const requestID = res.getHeader("X-Request-ID");
      res.set("X-Request-ID", requestID);
      if (admin && req.user.role !== "super_admin")
        return res
          .status(403)
          .json({
            code: 403,
            message: "没有反馈管理权限",
            request_id: requestID,
          });
      try {
        const config = bridge.configuration(),
          parsed = new URL(req.url, "http://localhost");
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const result = await bridge.forward({
          config,
          userID: req.user.id,
          admin,
          method: req.method,
          suffix: parsed.pathname === "/" ? "" : parsed.pathname,
          query: parsed.search.slice(1),
          contentType: req.headers["content-type"] || "",
          body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          key: req.headers["idempotency-key"] || "",
          signal: controller.signal,
        });
        for (const name of [
          "content-type",
          "content-disposition",
          "x-request-id",
          "retry-after",
        ])
          if (result.headers[name]) res.set(name, result.headers[name]);
        // Hub service authentication failures must not log the browser out of its source platform.
        if (result.status === 401)
          return res
            .status(503)
            .json({
              code: 503,
              message: "反馈服务连接暂不可用，请稍后重试",
              request_id: requestID,
            });
        res.status(result.status).send(result.body);
      } catch (error) {
        res
          .status(error.status || 503)
          .json({
            code: error.status || 503,
            message:
              error.status === 400
                ? "反馈请求格式无效"
                : "反馈服务暂不可用，请稍后重试",
            request_id: requestID,
          });
      }
    });
    router.use((err, req, res, next) =>
      res
        .status(err.type === "entity.too.large" ? 413 : 400)
        .json({
          code: err.type === "entity.too.large" ? 413 : 400,
          message: "反馈内容过大或格式无效",
        }),
    );
    app.use(prefix, router);
  }
}
module.exports = { mount };
