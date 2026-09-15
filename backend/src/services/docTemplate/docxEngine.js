/**
 * 公文模板引擎（纯函数，无 IO）："样例即模板"
 *
 * 一个 .docx 就是 zip 里的一组 XML。老师上传的样板我们不重建，只做两件事：
 *  1. inspectDocx(buffer)：拆开 word/document.xml，把正文顶层块（段落 / 表格）列出来，
 *     每块附上解析后的对齐、首行缩进、字体、字号、加粗、颜色（run → 段落样式 → docDefaults 三级解析），
 *     再加页面设置（pgSz / pgMar）与页眉页脚文字，给老师贴角色用。
 *  2. fillDocx(buffer, roles, content)：按角色把新内容套进去——
 *     fixed 的块原样保留（红头、版记、页眉页脚、样式表、编号、主题全部沿用），
 *     每种角色第一次出现的那一块当"原型"：克隆它的段落属性（pPr）和第一个文字 run 的属性（rPr），
 *     换成新文字；同一角色后面的块（样板里的示例段）丢掉；delete 的块丢掉。
 *     正文（body）可以是多个块：段落 / 标题(h1-h3) / 列表 / 表格，标题用 h1-h3 角色的原型，
 *     没有就用正文原型加粗。
 *
 * guessRoles(blocks)：按公文的常见结构猜一版角色（红头在前、居中大字是标题、以冒号结尾的短行是主送机关、
 * 首行缩进的连续段落是正文、末尾日期、日期前的短行是落款、之后是版记），老师再改。
 *
 * 角色（ROLES）：fixed 固定保留 | title 标题 | recipient 主送机关 | body 正文 | h1/h2/h3 正文一/二/三级标题 |
 *              attachment 附件说明 | signer 落款（发文单位） | date 成文日期 | delete 删除
 */
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const ROLES = Object.freeze(['fixed', 'title', 'recipient', 'body', 'h1', 'h2', 'h3', 'attachment', 'signer', 'date', 'delete']);
/** 可以当"原型"的角色（要求是段落） */
const PROTO_ROLES = ['title', 'recipient', 'body', 'h1', 'h2', 'h3', 'attachment', 'signer', 'date'];
/** rPr 子元素在 OOXML 里的规定顺序，插入加粗/斜体时按它找位置（Word 对乱序有时会报"文件损坏"） */
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const SIZE_NAMES = { 84: '初号', 72: '小初', 52: '一号', 48: '小一', 44: '二号', 36: '小二', 32: '三号', 30: '小三', 28: '四号', 24: '小四', 21: '五号', 18: '小五', 15: '六号', 13: '小六' };
const DATE_RE = /^[\s　]*([0-9０-９]{4}|[〇零一二三四五六七八九○Ｏ]{4})[\s　]*年[\s　]*([0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})[\s　]*月[\s　]*([0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})[\s　]*日[\s　]*$/;
const H1_RE = /^[\s　]*[一二三四五六七八九十]{1,3}、/;
const H2_RE = /^[\s　]*[（(][一二三四五六七八九十]{1,3}[）)]/;
const H3_RE = /^[\s　]*[0-9０-９]{1,2}[．.、]/;

/* ------------------------------------------------------------------ */
/* XML 小工具                                                          */
/* ------------------------------------------------------------------ */
const isElement = (n) => n && n.nodeType === 1;
const children = (n) => Array.from(n.childNodes || []).filter(isElement);
const localName = (n) => n.localName || (n.nodeName || '').split(':').pop();
const isW = (n, name) => isElement(n) && localName(n) === name && (n.namespaceURI === W_NS || !n.namespaceURI);
const childW = (n, name) => (n ? children(n).find((c) => isW(c, name)) : null) || null;
const attrW = (n, name) => {
  if (!n) return null;
  const v = n.getAttributeNS ? n.getAttributeNS(W_NS, name) : null;
  if (v) return v;
  const v2 = n.getAttribute ? n.getAttribute(`w:${name}`) : null;
  return v2 || null;
};
const onOff = (el) => { if (!el) return null; const v = attrW(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };

/** 段落 / 单元格里的文字：w:t 拼接，tab → \t，br → \n；跳过 mc:Fallback（文本框内容会重复）与 w:del */
function textOf(node) {
  let out = '';
  const walk = (n) => {
    if (!isElement(n)) return;
    const ln = localName(n);
    if (ln === 'Fallback' || ln === 'del' || ln === 'delText') return;
    if (ln === 't' && n.namespaceURI === W_NS) { out += n.textContent || ''; return; }
    if (ln === 'tab' && n.namespaceURI === W_NS && localName(n.parentNode) === 'r') { out += '\t'; return; }
    if (ln === 'br' && n.namespaceURI === W_NS) { out += '\n'; return; }
    children(n).forEach(walk);
  };
  walk(node);
  return out;
}
const hasDrawing = (node) => {
  let found = false;
  const walk = (n) => { if (found || !isElement(n)) return; const ln = localName(n); if (ln === 'drawing' || ln === 'pict' || ln === 'object') { found = true; return; } children(n).forEach(walk); };
  walk(node);
  return found;
};
const firstTextRun = (p) => {
  let hit = null;
  const walk = (n) => { if (hit || !isElement(n)) return; if (isW(n, 'r') && children(n).some((c) => isW(c, 't'))) { hit = n; return; } if (localName(n) === 'Fallback') return; children(n).forEach(walk); };
  walk(p);
  return hit;
};

/* ------------------------------------------------------------------ */
/* 样式解析（只用于展示与猜角色，不参与生成）                          */
/* ------------------------------------------------------------------ */
function parseStyles(stylesXml) {
  const map = { byId: {}, defaults: { rPr: null, pPr: null } };
  if (!stylesXml) return map;
  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
  const root = doc.documentElement;
  const dd = childW(root, 'docDefaults');
  if (dd) {
    map.defaults.rPr = childW(childW(dd, 'rPrDefault'), 'rPr');
    map.defaults.pPr = childW(childW(dd, 'pPrDefault'), 'pPr');
  }
  children(root).filter((s) => isW(s, 'style')).forEach((s) => {
    const id = attrW(s, 'styleId');
    if (!id) return;
    map.byId[id] = { id, type: attrW(s, 'type'), name: attrW(childW(s, 'name'), 'val') || id, basedOn: attrW(childW(s, 'basedOn'), 'val'), pPr: childW(s, 'pPr'), rPr: childW(s, 'rPr'), isDefault: attrW(s, 'default') === '1' };
  });
  return map;
}
/** 沿 basedOn 链找第一个能取到值的属性 */
function styleChain(styles, styleId) {
  const out = [];
  let id = styleId; let guard = 0;
  while (id && styles.byId[id] && guard < 12) { out.push(styles.byId[id]); id = styles.byId[id].basedOn; guard += 1; }
  if (!out.length) { const def = Object.values(styles.byId).find((s) => s.type === 'paragraph' && s.isDefault); if (def) out.push(def); }
  return out;
}
const rPrFacts = (rPr) => {
  if (!rPr) return {};
  const fonts = childW(rPr, 'rFonts');
  const sz = childW(rPr, 'sz');
  const b = childW(rPr, 'b');
  const color = childW(rPr, 'color');
  const out = {};
  if (fonts) out.font = attrW(fonts, 'eastAsia') || attrW(fonts, 'ascii') || (attrW(fonts, 'eastAsiaTheme') ? '主题字体' : null);
  if (sz) out.size = Number(attrW(sz, 'val')) || null;
  if (b) out.bold = onOff(b);
  if (color && attrW(color, 'val') && attrW(color, 'val') !== 'auto') out.color = attrW(color, 'val');
  return out;
};
const pPrFacts = (pPr) => {
  if (!pPr) return {};
  const out = {};
  const jc = childW(pPr, 'jc'); if (jc) out.align = attrW(jc, 'val');
  const ind = childW(pPr, 'ind');
  if (ind) {
    const flc = attrW(ind, 'firstLineChars'); const fl = attrW(ind, 'firstLine');
    if (flc) out.firstLineChars = Number(flc) / 100; else if (fl) out.firstLineTwips = Number(fl);
    else if (attrW(ind, 'hanging') || attrW(ind, 'hangingChars')) out.firstLineChars = 0;
  }
  const spacing = childW(pPr, 'spacing'); if (spacing && attrW(spacing, 'line')) out.line = Number(attrW(spacing, 'line'));
  return out;
};
function resolveFormat(p, styles) {
  const pPr = childW(p, 'pPr');
  const styleId = attrW(childW(pPr, 'pStyle'), 'val');
  const chain = styleChain(styles, styleId);
  const run = firstTextRun(p);
  const layers = [rPrFacts(run ? childW(run, 'rPr') : null), rPrFacts(childW(pPr, 'rPr')), ...chain.map((s) => rPrFacts(s.rPr)), rPrFacts(styles.defaults.rPr)];
  const pl = [pPrFacts(pPr), ...chain.map((s) => pPrFacts(s.pPr)), pPrFacts(styles.defaults.pPr)];
  const pick = (arr, key) => { for (const l of arr) if (l[key] !== undefined && l[key] !== null) return l[key]; return null; };
  const size = pick(layers, 'size');
  return {
    style: chain[0] ? chain[0].name : null,
    font: pick(layers, 'font'),
    size: size ? size / 2 : null,
    sizeName: size ? (SIZE_NAMES[size] || null) : null,
    bold: pick(layers, 'bold') === true,
    color: pick(layers, 'color'),
    align: pick(pl, 'align') || 'left',
    firstLine: pick(pl, 'firstLineChars') !== null ? pick(pl, 'firstLineChars') : (pick(pl, 'firstLineTwips') ? Math.round(pick(pl, 'firstLineTwips') / (Math.max(size || 24, 1) * 10)) : 0)
  };
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */
async function openDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile || !zip.file('[Content_Types].xml')) throw new Error('NOT_DOCX');
  const xml = await docFile.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = childW(doc.documentElement, 'body');
  if (!body) throw new Error('NOT_DOCX');
  return { zip, doc, body };
}
/** 正文顶层块：段落与表格计入序号，其他元素（书签、sdt、sectPr）不计 */
function bodyBlocks(body) {
  const out = [];
  let index = 0;
  children(body).forEach((n) => {
    if (isW(n, 'p') || isW(n, 'tbl')) { out.push({ node: n, index, kind: isW(n, 'p') ? 'p' : 'tbl' }); index += 1; } else out.push({ node: n, index: null, kind: isW(n, 'sectPr') ? 'sectPr' : 'other' });
  });
  return out;
}
const twipsToCm = (v) => (Number.isFinite(Number(v)) ? Math.round((Number(v) / 567) * 100) / 100 : null);

async function readHeadersFooters(zip, body) {
  const relsFile = zip.file('word/_rels/document.xml.rels');
  const rels = {};
  if (relsFile) {
    const rdoc = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
    children(rdoc.documentElement).forEach((r) => { if (localName(r) === 'Relationship') rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
  }
  const sectPr = childW(body, 'sectPr');
  const list = [];
  if (!sectPr) return list;
  for (const ref of children(sectPr).filter((c) => isW(c, 'headerReference') || isW(c, 'footerReference'))) {
    const id = ref.getAttributeNS(R_NS, 'id') || ref.getAttribute('r:id');
    const target = rels[id];
    if (!target) continue;
    const f = zip.file(`word/${target.replace(/^\/?word\//, '')}`);
    if (!f) continue;
    const hdoc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const text = children(hdoc.documentElement).map((p) => textOf(p).trim()).filter(Boolean).join(' / ');
    list.push({ kind: isW(ref, 'headerReference') ? 'header' : 'footer', type: attrW(ref, 'type') || 'default', text: text.slice(0, 120), hasImage: hasDrawing(hdoc.documentElement) });
  }
  return list;
}

/**
 * @returns {{blocks:Array, page:Object, headers:Array, footers:Array, block_count:number}}
 */
async function inspectDocx(buffer) {
  const { zip, doc, body } = await openDocx(buffer);
  const stylesFile = zip.file('word/styles.xml');
  const styles = parseStyles(stylesFile ? await stylesFile.async('string') : null);
  const blocks = bodyBlocks(body).filter((b) => b.index !== null).map((b) => {
    if (b.kind === 'tbl') {
      const rows = children(b.node).filter((c) => isW(c, 'tr'));
      const firstRow = rows[0] ? children(rows[0]).filter((c) => isW(c, 'tc')).map((tc) => textOf(tc).trim()).join(' | ') : '';
      return { index: b.index, kind: 'tbl', text: firstRow.slice(0, 80), rows: rows.length, empty: rows.length === 0 };
    }
    const text = textOf(b.node);
    return { index: b.index, kind: 'p', text: text.slice(0, 200), length: text.trim().length, empty: text.trim().length === 0, hasDrawing: hasDrawing(b.node), format: resolveFormat(b.node, styles) };
  });
  const sectPr = childW(body, 'sectPr');
  const pgSz = childW(sectPr, 'pgSz'); const pgMar = childW(sectPr, 'pgMar');
  const page = {
    width_cm: twipsToCm(attrW(pgSz, 'w')), height_cm: twipsToCm(attrW(pgSz, 'h')), orientation: attrW(pgSz, 'orient') || 'portrait',
    margins_cm: pgMar ? { top: twipsToCm(attrW(pgMar, 'top')), right: twipsToCm(attrW(pgMar, 'right')), bottom: twipsToCm(attrW(pgMar, 'bottom')), left: twipsToCm(attrW(pgMar, 'left')) } : null
  };
  const hf = await readHeadersFooters(zip, body);
  void doc;
  return { blocks, page, headers: hf.filter((h) => h.kind === 'header'), footers: hf.filter((h) => h.kind === 'footer'), block_count: blocks.length };
}

/* ------------------------------------------------------------------ */
/* 猜角色                                                              */
/* ------------------------------------------------------------------ */
function guessRoles(blocks) {
  const roles = blocks.map((b) => ({ index: b.index, role: 'fixed' }));
  const set = (i, role) => { roles[i].role = role; };
  const ps = blocks;
  const isBodyLike = (b) => b.kind === 'p' && !b.empty && !b.hasDrawing && (b.format.align === 'both' || b.format.align === 'left' || b.format.align === 'start') && (b.format.firstLine > 0 || b.length >= 20);
  const isHeading = (b) => b.kind === 'p' && !b.empty && b.length <= 40 && (H1_RE.test(b.text) || H2_RE.test(b.text) || H3_RE.test(b.text));
  /* 1. 正文区：最长的一段"连续的正文/标题/空行"区 */
  let best = null; let cur = null;
  ps.forEach((b, i) => {
    const ok = isBodyLike(b) || isHeading(b) || (cur && b.kind === 'p' && b.empty);
    if (ok) { if (!cur) cur = { start: i, end: i, count: 0 }; cur.end = i; if (!b.empty) cur.count += 1; } else { if (cur && (!best || cur.count > best.count)) best = cur; cur = null; }
  });
  if (cur && (!best || cur.count > best.count)) best = cur;
  if (!best) return roles;
  while (best.end > best.start && ps[best.end].empty) best.end -= 1;
  for (let i = best.start; i <= best.end; i += 1) {
    const b = ps[i];
    if (b.empty) set(i, 'delete');
    else if (isHeading(b)) set(i, H1_RE.test(b.text) ? 'h1' : H2_RE.test(b.text) ? 'h2' : 'h3');
    else if (/^[\s　]*附件[:：\s　]/.test(b.text)) set(i, 'attachment');
    else set(i, 'body');
  }
  /* 2. 正文前：紧邻的以冒号结尾短行是主送机关，再往前最近的居中大字段是标题 */
  let i = best.start - 1;
  while (i >= 0 && ps[i].kind === 'p' && ps[i].empty) i -= 1;
  if (i >= 0 && ps[i].kind === 'p' && ps[i].length <= 40 && /[：:]$/.test(ps[i].text.trim())) { set(i, 'recipient'); i -= 1; }
  while (i >= 0 && ps[i].kind === 'p' && ps[i].empty) i -= 1;
  const bodySize = ps.slice(best.start, best.end + 1).find((b) => !b.empty)?.format?.size || 16;
  for (let j = i; j >= 0 && j >= i - 3; j -= 1) {
    const b = ps[j];
    if (b.kind === 'p' && !b.empty && b.format.align === 'center' && (b.format.size >= bodySize || b.format.bold)) { set(j, 'title'); break; }
  }
  /* 3. 正文后：附件说明、落款、日期（之后的都是版记，保持 fixed） */
  const tail = [];
  for (let j = best.end + 1; j < ps.length; j += 1) { if (ps[j].kind !== 'p') break; if (ps[j].empty) continue; tail.push(j); if (tail.length >= 8) break; }
  const dateAt = tail.find((j) => DATE_RE.test(ps[j].text));
  if (dateAt !== undefined) {
    set(dateAt, 'date');
    const before = tail.filter((j) => j < dateAt);
    before.forEach((j) => { const t = ps[j].text.trim(); if (/^附件/.test(t)) set(j, 'attachment'); else if (ps[j].length <= 30 && !/[。；;]$/.test(t)) set(j, 'signer'); });
  } else {
    tail.slice(0, 3).forEach((j) => { if (/^附件/.test(ps[j].text.trim())) set(j, 'attachment'); });
  }
  return roles;
}

/* ------------------------------------------------------------------ */
/* 生成                                                                */
/* ------------------------------------------------------------------ */
function insertOrdered(rPr, el) {
  const name = localName(el);
  const rank = RPR_ORDER.indexOf(name);
  const existing = children(rPr).find((c) => localName(c) === name);
  if (existing) return;
  const after = children(rPr).find((c) => RPR_ORDER.indexOf(localName(c)) > rank);
  if (after) rPr.insertBefore(el, after); else rPr.appendChild(el);
}
const mk = (doc, name, attrs = {}) => { const el = doc.createElementNS(W_NS, `w:${name}`); Object.entries(attrs).forEach(([k, v]) => el.setAttributeNS(W_NS, `w:${k}`, String(v))); return el; };

function makeRun(doc, protoRPr, run) {
  const r = mk(doc, 'r');
  const rPr = protoRPr ? protoRPr.cloneNode(true) : mk(doc, 'rPr');
  if (run.bold) { insertOrdered(rPr, mk(doc, 'b')); insertOrdered(rPr, mk(doc, 'bCs')); }
  if (run.italic) { insertOrdered(rPr, mk(doc, 'i')); insertOrdered(rPr, mk(doc, 'iCs')); }
  if (run.strike) insertOrdered(rPr, mk(doc, 'strike'));
  if (run.underline) insertOrdered(rPr, mk(doc, 'u', { val: 'single' }));
  if (children(rPr).length) r.appendChild(rPr);
  const text = String(run.text ?? '');
  const parts = text.split(/(\n|\t)/);
  parts.forEach((part) => {
    if (part === '\n') r.appendChild(mk(doc, 'br'));
    else if (part === '\t') r.appendChild(mk(doc, 'tab'));
    else if (part) { const t = mk(doc, 't'); t.setAttribute('xml:space', 'preserve'); t.appendChild(doc.createTextNode(part)); r.appendChild(t); }
  });
  return r;
}
/** 用原型段落的 pPr / 首个 run 的 rPr 造一段新文字 */
function makeParagraph(doc, proto, runs, opts = {}) {
  const p = mk(doc, 'p');
  const pPr = childW(proto, 'pPr');
  if (pPr) {
    const clone = pPr.cloneNode(true);
    /* 分节符只能出现一次，克隆的段落不带 */
    children(clone).filter((c) => isW(c, 'sectPr')).forEach((c) => clone.removeChild(c));
    if (opts.noIndent) children(clone).filter((c) => isW(c, 'ind')).forEach((c) => clone.removeChild(c));
    if (opts.align) { children(clone).filter((c) => isW(c, 'jc')).forEach((c) => clone.removeChild(c)); const jc = mk(doc, 'jc', { val: opts.align }); const rPrMark = childW(clone, 'rPr'); if (rPrMark) clone.insertBefore(jc, rPrMark); else clone.appendChild(jc); }
    p.appendChild(clone);
  }
  const run = firstTextRun(proto);
  const protoRPr = run ? childW(run, 'rPr') : childW(childW(proto, 'pPr'), 'rPr');
  const list = runs && runs.length ? runs : [{ text: '' }];
  list.forEach((r) => p.appendChild(makeRun(doc, protoRPr, { ...r, bold: r.bold || opts.bold })));
  return p;
}
const runsOf = (v) => (Array.isArray(v) ? v : [{ text: String(v ?? '') }]);
const linesOf = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : String(v ?? '').split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);

function makeTable(doc, protoP, rows, contentWidth) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const colW = Math.floor(contentWidth / cols);
  const tbl = mk(doc, 'tbl');
  const tblPr = mk(doc, 'tblPr');
  tblPr.appendChild(mk(doc, 'tblW', { w: 0, type: 'auto' }));
  tblPr.appendChild(mk(doc, 'jc', { val: 'center' }));
  const borders = mk(doc, 'tblBorders');
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach((side) => borders.appendChild(mk(doc, side, { val: 'single', sz: 4, space: 0, color: 'auto' })));
  tblPr.appendChild(borders);
  tbl.appendChild(tblPr);
  const grid = mk(doc, 'tblGrid');
  for (let c = 0; c < cols; c += 1) grid.appendChild(mk(doc, 'gridCol', { w: colW }));
  tbl.appendChild(grid);
  rows.forEach((row, ri) => {
    const tr = mk(doc, 'tr');
    for (let c = 0; c < cols; c += 1) {
      const tc = mk(doc, 'tc');
      const tcPr = mk(doc, 'tcPr'); tcPr.appendChild(mk(doc, 'tcW', { w: colW, type: 'dxa' })); tc.appendChild(tcPr);
      tc.appendChild(makeParagraph(doc, protoP, runsOf(row[c] || ''), { noIndent: true, align: 'center', bold: ri === 0 }));
      tr.appendChild(tc);
    }
    tbl.appendChild(tr);
  });
  return tbl;
}

/**
 * @param {Buffer} buffer 样板
 * @param {Array<{index:number, role:string}>} roles
 * @param {{title?, recipient?, blocks?:Array, attachments?:Array, signer?, date?}} content
 * @returns {Promise<Buffer>}
 */
async function fillDocx(buffer, roles, content = {}) {
  const { zip, doc, body } = await openDocx(buffer);
  const roleOf = new Map((roles || []).map((r) => [Number(r.index), ROLES.includes(r.role) ? r.role : 'fixed']));
  const entries = bodyBlocks(body);
  const proto = {};
  entries.forEach((e) => { if (e.index === null) return; const role = roleOf.get(e.index) || 'fixed'; if (PROTO_ROLES.includes(role) && e.kind === 'p' && !proto[role]) proto[role] = e.node; });
  const sectPr = childW(body, 'sectPr');
  const pgSz = childW(sectPr, 'pgSz'); const pgMar = childW(sectPr, 'pgMar');
  const contentWidth = Math.max(4000, (Number(attrW(pgSz, 'w')) || 11906) - (Number(attrW(pgMar, 'left')) || 1440) - (Number(attrW(pgMar, 'right')) || 1440));
  const bodyProto = proto.body || proto.attachment || proto.recipient || proto.title;
  if (!bodyProto) throw new Error('NO_BODY_PROTOTYPE');
  const headingProto = (level) => proto[`h${level}`] || null;

  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  const emitBody = () => {
    const out = [];
    let ordinal = 0;
    blocks.forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'heading') {
        const level = Math.min(3, Math.max(1, Number(b.level) || 1));
        const hp = headingProto(level);
        out.push(hp ? makeParagraph(doc, hp, runsOf(b.runs ?? b.text)) : makeParagraph(doc, bodyProto, runsOf(b.runs ?? b.text), { bold: true }));
      } else if (b.type === 'list') {
        (b.items || []).forEach((item, i) => {
          const prefix = b.ordered ? `${i + 1}. ` : '• ';
          const runs = runsOf(item.runs ?? item.text ?? item);
          out.push(makeParagraph(doc, bodyProto, [{ text: prefix }, ...runs]));
        });
      } else if (b.type === 'table') {
        const rows = (b.rows || []).map((row) => (row || []).map((cell) => runsOf(cell.runs ?? cell.text ?? cell)));
        if (rows.length) out.push(makeTable(doc, bodyProto, rows, contentWidth));
      } else {
        const runs = runsOf(b.runs ?? b.text);
        if (runs.some((r) => String(r.text || '').trim())) out.push(makeParagraph(doc, bodyProto, runs));
      }
      ordinal += 1;
    });
    void ordinal;
    return out;
  };
  const emitLines = (role, value, fallbackOpts) => {
    const p = proto[role];
    const lines = linesOf(value);
    if (!lines.length) return [];
    return lines.map((line) => (p ? makeParagraph(doc, p, [{ text: line }]) : makeParagraph(doc, bodyProto, [{ text: line }], fallbackOpts)));
  };
  const generated = {
    title: () => emitLines('title', content.title, { align: 'center', bold: true, noIndent: true }),
    recipient: () => emitLines('recipient', content.recipient, { noIndent: true }),
    body: emitBody,
    attachment: () => emitLines('attachment', content.attachments, { noIndent: true }),
    signer: () => emitLines('signer', content.signer, { align: 'right', noIndent: true }),
    date: () => emitLines('date', content.date, { align: 'right', noIndent: true }),
    h1: () => [], h2: () => [], h3: () => []
  };
  /* 角色的内容如果样板里没有对应原型，挂在正文后面（标题/主送挂在正文前） */
  const emittedRole = new Set();
  const newChildren = [];
  const beforeBody = ['title', 'recipient'].filter((r) => !proto[r]);
  const afterBody = ['attachment', 'signer', 'date'].filter((r) => !proto[r]);
  entries.forEach((e) => {
    if (e.index === null) { newChildren.push(e.node); return; }
    const role = roleOf.get(e.index) || 'fixed';
    if (role === 'fixed') { newChildren.push(e.node); return; }
    if (role === 'delete') return;
    if (emittedRole.has(role)) return;
    emittedRole.add(role);
    if (role === 'body') beforeBody.forEach((r) => { if (!emittedRole.has(r)) { emittedRole.add(r); newChildren.push(...generated[r]()); } });
    newChildren.push(...generated[role]());
    if (role === 'body') afterBody.forEach((r) => { if (!emittedRole.has(r)) { emittedRole.add(r); newChildren.push(...generated[r]()); } });
  });
  /* 重建 body：先清空再按新顺序放回（sectPr 已包含在 entries 里且仍在最后） */
  children(body).forEach((c) => body.removeChild(c));
  newChildren.forEach((n) => body.appendChild(n));
  /* 克隆段落带来的重复 paraId 去掉（可选属性，Word 会自己补） */
  children(body).forEach((n) => { ['w14:paraId', 'w14:textId'].forEach((a) => { if (n.hasAttribute && n.hasAttribute(a)) n.removeAttribute(a); }); });

  const xml = new XMLSerializer().serializeToString(doc);
  zip.file('word/document.xml', xml);
  const core = zip.file('docProps/core.xml');
  if (core && content.title) {
    const coreXml = await core.async('string');
    const esc = String(content.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    zip.file('docProps/core.xml', coreXml.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${esc}</dc:title>`));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/* ------------------------------------------------------------------ */
/* 从老师的草稿 .docx 里取内容（不要它的格式）                         */
/* ------------------------------------------------------------------ */
/**
 * 把草稿的段落按公文结构分成字段与正文块：第一段居中/加粗/大字是标题；标题后以冒号结尾的短行是主送机关；
 * 末尾日期；日期前的短行是落款；"附件："行是附件说明；其余是正文（一/（一）/1. 开头的短行当标题）。
 */
async function extractDraft(buffer) {
  const inspected = await inspectDocx(buffer);
  const content = { title: '', recipient: '', blocks: [], attachments: [], signer: [], date: '' };
  /* 草稿如果本身就是一份完整公文（带红头、版记），按样板的猜法拆：红头/版记属于模板，不带进内容 */
  const roles = guessRoles(inspected.blocks);
  if (roles.some((r) => r.role === 'body')) {
    inspected.blocks.forEach((b, i) => {
      const role = roles[i].role;
      const t = (b.text || '').trim();
      if (b.kind !== 'p' || !t) return;
      if (role === 'title') content.title = content.title ? `${content.title}\n${t}` : t;
      else if (role === 'recipient') content.recipient = t;
      else if (role === 'date') content.date = t;
      else if (role === 'signer') content.signer.push(t);
      else if (role === 'attachment') content.attachments.push(t);
      else if (role === 'h1' || role === 'h2' || role === 'h3') content.blocks.push({ type: 'heading', level: Number(role[1]), runs: [{ text: t }] });
      else if (role === 'body') content.blocks.push({ type: 'paragraph', runs: [{ text: t }] });
    });
    return content;
  }
  const ps = inspected.blocks.filter((b) => b.kind === 'p' && !b.empty);
  let start = 0; let end = ps.length - 1;
  if (ps.length && (ps[0].format.align === 'center' || ps[0].format.bold || (ps[0].format.size || 0) >= 16) && ps[0].length <= 60) { content.title = ps[0].text.trim(); start = 1; }
  if (start < ps.length && ps[start].length <= 40 && /[：:]$/.test(ps[start].text.trim())) { content.recipient = ps[start].text.trim(); start += 1; }
  if (end >= start && DATE_RE.test(ps[end].text)) { content.date = ps[end].text.trim(); end -= 1; }
  while (end >= start && content.date && ps[end].length <= 30 && !/[。；;]$/.test(ps[end].text.trim()) && content.signer.length < 3 && !/^附件/.test(ps[end].text.trim())) { content.signer.unshift(ps[end].text.trim()); end -= 1; }
  for (let i = start; i <= end; i += 1) {
    const t = ps[i].text.trim();
    if (/^附件[:：]/.test(t) || (content.attachments.length && /^[0-9０-９]{1,2}[．.、]/.test(t) && ps[i].length <= 60 && i >= end - 4)) { content.attachments.push(t); continue; }
    if (ps[i].length <= 40 && H1_RE.test(t)) content.blocks.push({ type: 'heading', level: 1, runs: [{ text: t }] });
    else if (ps[i].length <= 40 && H2_RE.test(t)) content.blocks.push({ type: 'heading', level: 2, runs: [{ text: t }] });
    else if (ps[i].length <= 40 && H3_RE.test(t) && ps[i].format.bold) content.blocks.push({ type: 'heading', level: 3, runs: [{ text: t }] });
    else content.blocks.push({ type: 'paragraph', runs: [{ text: t }] });
  }
  return content;
}

/** 老师直接粘贴的纯文本 → 内容（每行一段；# 开头当标题） */
function contentFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocks = lines.map((l) => {
    const m = l.match(/^(#{1,3})\s+(.*)$/);
    if (m) return { type: 'heading', level: m[1].length, runs: [{ text: m[2] }] };
    return { type: 'paragraph', runs: [{ text: l }] };
  });
  return { blocks };
}

module.exports = { ROLES, PROTO_ROLES, DATE_RE, inspectDocx, guessRoles, fillDocx, extractDraft, contentFromText, textOf };
