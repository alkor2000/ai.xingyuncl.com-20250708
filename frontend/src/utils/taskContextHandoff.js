/**
 * 一次学校登录之后，把作业上下文交到本站编辑器手里——只在这一个标签页的内存里。
 *
 * 为什么需要它：学生从 edu 点一次进来，先走 C05 的一次性登录落地页，那一页为了不让 handoff 留在
 * 地址栏，会把整段 URL 换掉，片段里的 `#p09_task=…` 也一起没了；于是学生登录成功却没有作业上下文，
 * 只能回 edu 再点第二个入口。这个模块就是那一跳的中转：落地页在清理凭据**之前**取走它，
 * 等编辑器挂载时来拿。
 *
 * 它是凭据，所以边界写死在这里：
 * 1. 只认规范的 `p09_task`（edu 签的那种 `p09g.<载荷>.<签名>`）；重复、畸形、以及片段里其它任何
 *    参数都当没有，不猜、不转发；
 * 2. 只存在内存，进程内、当前标签页；不写 localStorage / sessionStorage / cookie，不打日志；
 * 3. 不进查询串、不进登录请求体、不当登录身份——它证明的是"哪次作业"，不是"你是谁"；
 * 4. 落点永远由服务端返回的 entry 决定，这个模块不解析也不接受任何 URL；
 * 5. 一次新的登录先 reset：上一次登录留下的上下文不能接着用。
 *
 * 真正的校验（签名、学校、学生、作业、时效、一次性）全在后端，这里只做形状检查，不假装能验签。
 */

const KEY = 'p09_task'

// 后端 taskGrant 的线形：p09g.<base64url 载荷>.<base64url 签名>，整体有字节上限。
const CANONICAL = /^p09g\.[A-Za-z0-9_-]{1,3000}\.[A-Za-z0-9_-]{1,200}$/
const MAX_LENGTH = 4096

export function isCanonicalTaskContext(value) {
  return typeof value === 'string' && value.length <= MAX_LENGTH && CANONICAL.test(value)
}

/**
 * 从 URL 片段里读那**一个**规范上下文。
 * 片段里出现两个 p09_task 就是畸形（不知道该信哪个），其它键一律不看、也不带走。
 */
export function readTaskContextFromHash(hash) {
  try {
    const raw = String(hash || '').replace(/^#/, '')
    if (!raw) return null
    const found = new URLSearchParams(raw).getAll(KEY)
    if (found.length !== 1) return null
    return isCanonicalTaskContext(found[0]) ? found[0] : null
  } catch {
    return null                      // 恶意 URL 不该让登录或编辑器崩掉
  }
}

// 登录落地页捡起来、等编辑器来取的那一个。
let carried = null
// 编辑器当前正在用的那一个（关联请求的请求头从这里取）。
let current = null
// 这个文档里已经开始过几次学校登录。整页打开时是 0，站内再登录一次才加一。
let loginRounds = 0
// 这一趟到达是哪份作业——服务端验签后给的作业名，或者 'unavailable'（问不到）。
//
// 它**不是凭据**：授权是一次性的，学生一关联就用掉了，绝不保留、绝不重用；但"这一趟进来的是哪份作业"
// 必须活得比那张授权长一点，否则关联完 B 再切回旧项目 A，面板就又变回那个能按的「交作业」了。
let arrivalTargetRef = null

/** 登录成功、且服务端 entry 正是本站编辑器时才调用；其它任何情况都不要调用。 */
export function carryTaskContext(value) {
  carried = isCanonicalTaskContext(value) ? value : null
}

/** 编辑器挂载时取走，取一次就没了：它不是缓存，是一次交接。 */
export function takeCarriedTaskContext() {
  const value = carried
  carried = null
  return value
}

/**
 * 一次学校登录开始。返回**这一次到达**可以带的那个上下文，其余一律清掉。
 *
 * 判断"这一次到达"只有两种依据，没有第三种：
 * 1. 这次到达的地址里就有（站内跳到落地页时，片段还在路由地址上）；
 * 2. 这是本文档的第一次登录，那么应用启动时寄存的那个就是这次到达带来的。
 * 本文档里的第二次登录还想拿上一次寄存的，那就是拿旧作业接着用——这里直接拒绝。
 */
/** 记住这一趟的作业名（或 'unavailable'）。只存名字，不存授权。 */
export function rememberArrivalTarget(value) {
  arrivalTargetRef = value === 'unavailable' || (typeof value === 'string' && value) ? value : null
}

export function arrivalTarget() {
  return arrivalTargetRef
}

export function beginSchoolLogin(fromArrivalUrl) {
  const arrival = isCanonicalTaskContext(fromArrivalUrl)
    ? fromArrivalUrl
    : (loginRounds === 0 ? carried : null)
  loginRounds += 1
  carried = null
  current = null
  arrivalTargetRef = null            // 上一趟的作业名不能跟到这一趟来
  return arrival
}

/** 测试与热更新用的整体复位：连"这个文档登录过几次"一起归零。 */
export function resetTaskContexts() {
  carried = null
  current = null
  arrivalTargetRef = null
  loginRounds = 0
}

export function adoptTaskContext(value) {
  current = isCanonicalTaskContext(value) ? value : null
}

export function currentTaskContext() {
  return current
}
