'use strict';

// 图像新能力（「帮我写提示词」）的试点资格：只读、可注入、**默认不装配即拒绝**。
//
// 这里刻意**不判断**"这个人属于哪所学校"和"现在是哪一批"。那两件事的主责不在本仓库：
// 学校身份归 edu / Identity 的校籍链，批次归 M0 的发布批次判定。本仓库既没有可信的学校字段，
// 也没有批次概念——C05 会话里的 school_ref 只说明"这个学生会话是从哪所学校的入口来的"，
// 是来源证据，不是实时校籍，更不是新能力的授权；组名、uuid_source、实例名同样都不替代学校。
// 所以这一层只定义两件事：**去问谁**，以及**问不到就拒绝**。
//
// 也刻意不做这些：不新建表、不读任何 env、不碰任何凭据、不写库、不缓存判定结果、
// 不从别的业务（C04 本人校籍 / E09 作品资格 / P03 实例权利）挪用权限或借它们的 secret。
// 没有人被默认放进来：没装配提供方时接口存在但一律拒绝，和 P09 的 eligibility 一个路子。
const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 2000;

// 能问的能力只有这几个，名字由本仓库定，不接受调用方随便传
const CAPABILITIES = Object.freeze(['image_studio', 'video_studio']);
const DEFAULT_CAPABILITY = 'image_studio';

/**
 * 只有图像这一个能力保留老契约：provider 不写 capability 时，按图像的答案算。
 * 那是图像候选先落地时就有的形状，**有意保留并有用例守着**。
 *
 * 除此以外的能力（现在是 video_studio）**必须拿到点名的放行**：
 * 答案里没写 capability，或写的是别的能力，一律当"这个能力没被批准"。
 * 只让 provider 可选回显是不够的——一个只认识图像的老 provider 会把视频一起放出去。
 */
const LEGACY_IMPLICIT_CAPABILITY = 'image_studio';
const CAPABILITY_NOT_GRANTED = 'pilot_capability_not_granted';

// 本地这一层自己能得出的两个结论
const NOT_INSTALLED = 'pilot_provider_not_installed';
const UNAVAILABLE = 'pilot_provider_unavailable';

// 提供方可以回的理由。列表之外的一律按"就是不够资格"回，不把对端的原话往外抄。
const REASONS = Object.freeze(new Set([
  'school_not_in_pilot', 'identity_expired', 'not_registered', 'suspended', 'batch_changed',
  'not_eligible'
]));

const refuse = (reason, { retryable = false } = {}) =>
  Object.freeze({ available: false, reason, retryable, batchRef: null });

/**
 * 到点就不再等了。注意这**只是停止等待**：底层请求没有被取消（没有 AbortSignal），
 * provider.check 也是先被求值的，它要是同步阻塞，这 2 秒根本管不着。
 * 将来接真实 provider 时，有界与释放 I/O 是**它自己**的责任，不能靠这层包装。
 */
function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => { if (timer) clearTimeout(timer); }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('pilot_eligibility_timeout')), ms); })
  ]);
}

/**
 * 装配契约（部署方自己实现并放进 app.locals.imagePilotEligibility）：
 *
 *   { check({ capability, userId, groupId, role })
 *       -> { eligible: boolean, reason?: string, batch_ref?: string, capability?: string } }
 *
 * capability 是"在问哪一个能力"（image_studio / video_studio）。**一个能力一个答案**：
 * 图像放行不代表视频放行。除图像外的能力，放行的答案里**必须**写明 capability 且与所问一致；
 * 只有图像保留"不写就算图像"的老契约。
 * 判定输入只给它已经在本平台里的既有身份，不多给。放行的回答必须带上 batch_ref
 * （这次是按哪一批放的），否则算装配没写完——一次 admin 确认一整批，事后要能说清是哪一批。
 * batch_ref 的取值与"当前是哪一批"由装配方从 M0 那边拿，本文件不猜、不填、不校验语义。
 */
async function decide(app, user, { timeoutMs = DEFAULT_TIMEOUT_MS, capability = DEFAULT_CAPABILITY } = {}) {
  if (!CAPABILITIES.includes(capability)) return refuse('not_eligible');
  const provider = app && app.locals ? app.locals.imagePilotEligibility : null;
  if (!provider || typeof provider.check !== 'function') return refuse(NOT_INSTALLED);
  if (!user || user.id === undefined || user.id === null) return refuse('not_eligible');

  let verdict;
  try {
    verdict = await withTimeout(provider.check({
      capability, userId: user.id, groupId: user.group_id ?? null, role: user.role ?? null
    }), timeoutMs);
  } catch {
    // 问不到就是拒绝，绝不因为"对端没答上来"而放行
    return refuse(UNAVAILABLE, { retryable: true });
  }

  // 只认严格布尔。{}、[]、eligible:'true' 这些都是**装配错了**，不是"这个人没资格"——
  // 报成没资格会让人以为是学生的问题，还丢掉可重试这层口径。
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
    return refuse(UNAVAILABLE, { retryable: true });
  }
  if (typeof verdict.eligible !== 'boolean') return refuse(UNAVAILABLE, { retryable: true });
  if (verdict.eligible === false) {
    const reason = typeof verdict.reason === 'string' && REASONS.has(verdict.reason)
      ? verdict.reason : 'not_eligible';
    return refuse(reason);
  }
  const batchRef = typeof verdict.batch_ref === 'string' ? verdict.batch_ref.trim() : '';
  if (!batchRef || !REF.test(batchRef)) return refuse(UNAVAILABLE, { retryable: true });
  // 放行必须点名到能力：老契约只在图像上继续成立，别的能力没点名就是没批准
  const answered = typeof verdict.capability === 'string' ? verdict.capability : null;
  if (answered === null) {
    if (capability !== LEGACY_IMPLICIT_CAPABILITY) return refuse(CAPABILITY_NOT_GRANTED);
  } else if (answered !== capability) {
    return refuse(CAPABILITY_NOT_GRANTED);
  }
  return Object.freeze({ available: true, reason: null, retryable: false, batchRef, capability });
}

module.exports = { decide, REASONS, NOT_INSTALLED, UNAVAILABLE, CAPABILITY_NOT_GRANTED,
  DEFAULT_TIMEOUT_MS, CAPABILITIES, DEFAULT_CAPABILITY, LEGACY_IMPLICIT_CAPABILITY };
