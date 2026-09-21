# 产品反馈中央池接入 v1

用户于 2026-09-20 确认中央池方案。反馈、证据、事件、AI 结果主源为 TE-DNA。EDU/AI 是登录身份与本地管理资格的主源。此协议为独立新增通道，不复用 C06/C08、Identity 或模型网关凭据。

## 服务身份

每个平台实例配置独立客户端 ID 和至少 32 字节随机 HMAC 密钥，中央注册表绑定 `platform`（edu/ai）、`instance`、`allow_admin`。客户端不选择来源身份。

本地主体只在源平台使用。源后端用独立、持久的 subject secret 对本地用户 ID 做 HMAC-SHA256，得到 64 位十六进制不透明主体；中央只存 `platform:instance:subject:<digest>`，不保存外站原始用户 ID 或 global_person_id。变更 subject secret 会改变归属，须备份并保持稳定，不能随服务签名密钥轮换。

## 请求

中央入口 `/api/v1/integrations/product-feedback/mine` 与 `/admin`，子路径与既有反馈 API 的 detail/reply/acceptance/actions/evidence/stats 对应。新增 `notifications` 列表和 `notifications/:event_id/read` 已读。源平台向浏览器暴露 `/api/product-feedback` 与 `/api/admin/product-feedback`，所有请求须本地 JWT 验证。EDU 管理员仅 super_admin；AI 仅 super_admin（普通 admin 是组管理员，不能获得全站权限）。中央 TE-DNA 保留原管理员治理权限。

请求头 `X-PF-Version: 1` 为 schema_version；`X-PF-Client`、`X-PF-Subject`、`X-PF-Admin`（0/1）、`X-PF-Time`（Unix 秒）、`X-PF-Nonce`（UUID）、`Idempotency-Key`（POST 必填 UUID）、`X-PF-Signature`（小写十六进制 HMAC-SHA256）。签名内容按以下字段用 LF 拼接、无末尾 LF：

```
1
client
subject
admin
unix_time
nonce
METHOD
原始路径及query
Content-Type
Idempotency-Key（GET 空字符串）
SHA256(原始请求体)
```

窗口 ±300 秒；nonce 在中央数据库唯一登记防跨进程重放，过期自动清理。POST 不带 query。JSON 恰好一个对象并拒绝未知字段；multipart 只允许 payload JSON 和一个可选 screenshot。截图按既有真实签名验证，≤5MiB；整请求 ≤6MiB，JSON ≤128KiB（对通用16KiB规则的明确例外）。浏览器不能指定可信身份；源后端覆盖所有服务身份头且仅转发允许的反馈路径、方法和查询字段。服务 URL 只由后端配置，禁跟随重定向；生产只用 HTTPS，本机联测允许显式回环 HTTP。

## 幂等与隔离

写入幂等键按客户端/主体/键哈希命名空间隔离；同键不同语义请求返回409。所有反馈写入与结果收据在同一中央事务提交，失败全部回滚。保留结果至少24小时。每次重试重新签名/nonce、同一个 Idempotency-Key；失败最多3次。AI 异步触发及通知只能在事务提交后执行。

本人接口仅本主体。源平台管理员只管理注册的本平台实例；普通请求不能提升管理员身份；管理员也不能替提交人验收。中央管理员可按平台/实例筛选全部队列。scope在服务端、SQL与对象访问处约束，不依赖前端隐藏。

## 响应和通知

保留既有 `{code,message,data}` 反馈响应，中央接入边界添加 `schema_version:1`、`request_id`、`replayed`；错误另带 `{error:{code,message,retryable}}`。截图以独立鉴权二进制响应返回。所有响应 no-store、no-referrer、nosniff；错误不含原始输入或内部异常。

源平台反馈入口轮询中央持久事件形成通知列表/未读数，已读记录绑定不透明主体。排期、待验收通知提交人；拒收重开和AI P0通知本实例管理员。通知点击原平台反馈详情；无需跨域回调、迁移用户账号或本地复制反馈。服务不可用时显示可重试失败，不回报假成功。

## 不变量

- TE-DNA 唯一反馈事实源；原平台未提交代码和生产数据不被本工作区修改。
- 外部平台本地用户ID、JWT、密钥、nonce/幂等键正文、签名及完整请求正文不写中央日志。
- 事件不可覆盖；状态投影、截图、幂等响应一起原子提交；版本冲突409。
- AI 保持固定定级公式、人工优先级保护、无提交人计费；外站反馈不能借用本地学校授权，使用平台保守模型策略。
- 不自动触发开发/部署任务，用户验收才关闭。

## 契约测试

正常提交与截图；未知字段；多个JSON/未知multipart字段；签名错/过期/nonce重复；同幂等键重试与内容冲突；跨主体/平台/实例拒绝；管理员越界；状态闭环、409、拒收原因；读通知/标记已读隔离；提供方503及有限重试；重定向与非HTTPS配置拒绝；桌面/窄屏/横屏/键盘高度下真实滚动与末项操作。

## 本仓接入

Express路由在通用请求日志/解析前装配，独立有界raw body与本地JWT认证。原生React反馈路由 `/feedback`、`/feedback/:id`、`/feedback/hub`、`/feedback/hub/:id` 位于既有登录布局；仅super_admin管理实例反馈，普通组admin不可越界。

后端配置 `PRODUCT_FEEDBACK_HUB_URL`（HTTPS origin）、`PRODUCT_FEEDBACK_CLIENT_ID`、`PRODUCT_FEEDBACK_CLIENT_SECRET`、`PRODUCT_FEEDBACK_SUBJECT_SECRET`。subject secret与服务签名密钥独立且持久，不随签名密钥轮换。两个域名是否为同实例须据实际部署核对；独立实例分别登记client/instance与密钥。先部署中央迁移及注册配置，再发布本平台。不新增本地数据库表。

测试：根目录 `node --test backend/tests/product-feedback-*.test.cjs`；frontend下 `npm run build`。全流程/响应式浏览器证据保存在独立 `feedback-sync-ws` 的 output/browser。生产登录联验与真机软键盘仍在发布验收阶段。
