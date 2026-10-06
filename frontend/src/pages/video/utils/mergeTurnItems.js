/**
 * 把「本轮那几条」的状态从两个来源合出来：图库历史，和轮询留下的任务快照。
 *
 * 这件事看着简单，有三个坑，都踩过：
 *   1. **两个来源会给同一条不同的话**：历史可能是一页旧的（还写着"排队中"），
 *      快照来自那条轮询本身、是权威的。所以先定优先级，再落笔，
 *      不能先按历史覆盖一遍、再让快照盖回去——那样即使最后内容没变，也每次都生成新对象。
 *   2. **新对象 = 又一次渲染**：页面的 effect 依赖 turnItems，返回一个内容相同的新 Map
 *      会让它一直自己叫醒自己。所以**只有真的变了才换新 Map，否则原样返回 prev**。
 *   3. **晚到的旧历史不能把终态推回去**：已经 succeeded / failed 的，不接受
 *      再变回排队中或生成中。
 *
 * 纯函数，不碰 React、不发请求，好单独按反例来验。
 */

/* 只有这五个字段决定"这一条现在长什么样"，比较与覆盖都只看它们 */
const FIELDS = ['status', 'progress', 'local_path', 'thumbnail_path', 'error_message'];

/* 谁能盖谁：终态最大，生成中次之，排队/未知最小 */
const RANK = { pending: 0, submitted: 0, queued: 0, running: 1, processing: 1, succeeded: 2, failed: 2 };
const rank = status => (RANK[status] !== undefined ? RANK[status] : 0);

/* 来源权威度：轮询快照 > 图库历史 */
const SNAPSHOT = 2;
const HISTORY = 1;

function patchOf(source) {
  const patch = {};
  for (const field of FIELDS) {
    if (source[field] !== undefined) patch[field] = source[field];
  }
  return patch;
}

const same = (a, b) => FIELDS.every(field => a[field] === b[field]);

/**
 * @param {Map} prev            当前这几轮的快照（id -> 条目）
 * @param {Array} history       图库当前那页（可能根本不含本轮，也可能是旧的一页）
 * @param {Object} snapshots    store 里按 taskId 存的轮询快照
 * @returns {Map} 内容真的变了才是新 Map；没变返回传进来的 prev 本身
 */
export function mergeTurnItems(prev, history = [], snapshots = {}) {
  if (!prev || prev.size === 0) return prev;

  /* 第一步：每个 id 只挑一个最该信的来源，不做中间覆盖 */
  const chosen = new Map();
  const offer = (id, source, authority) => {
    if (id === undefined || id === null || !prev.has(id)) return;
    const current = chosen.get(id);
    if (!current
      || authority > current.authority
      || (authority === current.authority && rank(source.status) > rank(current.source.status))) {
      chosen.set(id, { source, authority });
    }
  };

  for (const row of history) {
    if (!row) continue;
    if (prev.has(row.id)) { offer(row.id, row, HISTORY); continue; }
    if (row.task_id) {
      for (const [id, known] of prev) {
        if (known.task_id && known.task_id === row.task_id) { offer(id, row, HISTORY); break; }
      }
    }
  }

  for (const snap of Object.values(snapshots || {})) {
    if (!snap) continue;
    if (snap.generationId !== undefined && prev.has(snap.generationId)) {
      offer(snap.generationId, snap, SNAPSHOT); continue;
    }
    for (const [id, known] of prev) {
      if (known.task_id && known.task_id === snap.taskId) { offer(id, snap, SNAPSHOT); break; }
    }
  }

  /* 第二步：落笔前先比最终形态；终态不许被推回去；没变就别造新 Map */
  let next = null;
  for (const [id, { source }] of chosen) {
    const known = prev.get(id);
    if (rank(known.status) > rank(source.status)) continue;      // 晚到的旧消息，丢掉
    const merged = { ...known, ...patchOf(source), id };
    if (same(known, merged)) continue;
    next = next || new Map(prev);
    next.set(id, merged);
  }
  return next || prev;
}

export default mergeTurnItems;
