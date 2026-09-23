# E09 HTTP 资格适配的认知索引条目（source-bound 候选）

正式 AOCI 绑定主工作副本的限制仍然有效（`aoci_overview` 的 `runtime_repository_root` 是
`/home/hanying/ai-platform`，接口上没有指向别的仓库根的参数），所以本包**不写主副本**、
不为了 aligned 去改正式索引。下面是完整的 source-bound 候选。

## 新增与受影响对象

| 仓内路径 | source_sha256 | 状态 |
|---|---|---|
| backend/src/services/websiteArtifact/eligibility.js | 5b1cd5af0ba89ce6826ad31250306b8fcd0d899b3459e9b07d696897be96ed51 | 受影响（新增 mode: 'http'） |
| backend/src/services/websiteArtifact/runtime.js | c3224fd18dbed1298e2b26a0f8a26b3a865247b8a9601553115aece775764e76 | 受影响（新增部署形态配置来源） |
| backend/src/__tests__/unit/services/websiteArtifactEligibility.test.js | 2a7868f0969e32181e946b71773ad0f10f5d81892170cbf8ddea87321bcfc3c4 | 新增（测试目录只 observe） |
| dev/e09-lab/check.py | a65426559e8d7ac46f8dd801b29f2adf6509c83db3608df86d8df3a7fc6d430e | 新增 |
| dev/e09-lab/stub.cjs | 8ab1a614a40503e5b41f2b01d4243c0fdbe1f9d80ae644dafc99fbe6846bcfd1 | 新增 |
| docs/integrations/e09-http-eligibility.md | fd732cd9da124e09b11c49902a670d534aed08b02c58049913d2bedb9c0bf0d7 | 新增 |
| docs/integrations/JOINT-ENTRY-TEST.md | 2efbaf9127320ec0d535e355306a9260c2000d103c27aa756c1ac159a2a3ec2e | 受影响（新增第十节：在 edu 里打开已提交作品） |

```
eligibility.js[AI6S]: F:I·评阅资格提供方：absent 一律拒绝、static 实验替身(仅 dev/test)、**http 每次访问向 edu 真问一次** | R:code:backend/src/services/websiteArtifact/service.js,code:backend/src/services/websiteArtifact/runtime.js,code:docs/integrations/e09-http-eligibility.md | A:createEligibilityProvider,absentProvider,reviewerHash,signEligibility,REASONS | S:签名构造与 edu signRequest 逐字一致并已对过 edu 自己发布的向量；请求字段按 edu 固定源码 d2f54c9e 的 EligibilityRequest(schema_version/source_instance/school_ref/assignment_ref/reviewer_ref/student_uuid/purpose)，edu 用 DisallowUnknownFields，多一个字段就是 400，**其结构里没有 audience_ref**；拒绝是 403+error 信封且 reason 在 error.message，不是 {eligible:false}；只有 200+schema_version===1+eligible===true(严格布尔)才算通过，字符串"true"/空壳/HTML 错误页都不是答案；400/401/5xx/超时/TLS/重定向/超长一律 eligibility_unavailable——意思是"这次问不到"，不是"这位老师不能看"、更不是"学生没做"；绝不回退 static、绝不复用上次成功；只去部署配置的那一个固定 https 端点、不跟随重定向、校验证书与主机名、超时与响应体都有界、不记录密钥与正文；本仓只保存 sha256(issuer\n reviewer_ref)，edu 的 teaches() 要的是数字用户 id，故 reviewer_ref 有 audience_hash(默认，今天会被 edu 拒) 与 mapping(逐个登记，不适合生产) 两种明确形态，差异写在交付文档 §3.1
check.py[TQ5M]: F:I·E09 资格适配的联合验证：真实后端/前端/浏览器/一次性库 + 真实 HTTPS 资格端点，验本班可读、撤资格下一次字节即拒、他班/非本作业/学生离班按名拒、提供方离线/畸形/错签名/错CA/无提供方一律 unavailable、部署形态可装配 | R:code:dev/c05-p09-lab/check.py,code:dev/e09-lab/stub.cjs,code:backend/src/services/websiteArtifact/eligibility.js,code:docs/integrations/e09-http-eligibility.md | A:python3 dev/e09-lab/check.py | S:edu 端在本轮是 stub.cjs 扮演(线形与签名构造真实，判定与名单是替身)，**edu 真实 Go handler 未执行**——驱动已写好且编译通过，但在本机构建/运行 edu 仓库代码被权限分类器拒绝，故不得写成"真实双端已接通"；cache_ms=0 时每次字节都真的问，非零时撤资格的可见边界就是该会话最多再撑 cacheMs
stub.cjs[TQ4S]: F:I·edu 资格端点的线形替身：按 edu 固定源码的状态码与信封回答，用 edu Verifier 同一套构造校验签名(5分钟窗口、nonce 不重放、常量时间)，名单来自可写 JSON | R:code:dev/e09-lab/check.py,code:docs/integrations/e09-http-eligibility.md | A:- | S:**不是 edu 的产品代码**，替代的是名单库而不是判定代码；任何由它得到的结论都必须写成"线形与失败路径已验、edu 真实判定未执行"
e09-http-eligibility.md[SI6M]: F:I·HTTP 资格适配交付文档：配置形态与安全边界、签名构造与两条固定向量、与适配说明不一致的三处(没有 audience_ref 而要 reviewer_ref 数字 id、拒绝是 403+error 信封、reason 词汇更长)、答案严格读法、缓存实际以 session.id 为键而非四元组、验到与未验到 | R:code:backend/src/services/websiteArtifact/eligibility.js,code:backend/src/services/websiteArtifact/service.js,code:dev/e09-lab/check.py | A:- | S:以 edu 固定源码 d2f54c9e 为准而非说明；最小差异建议放在 edu 侧(先按 sha256("edu\n"+id) 比对一次)，在那之前 mapping 是唯一能跑通的过渡形态且不适合生产；真实 edu 联调与真人验收都未做
```
