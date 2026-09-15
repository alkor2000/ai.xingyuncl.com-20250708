/**
 * 产物流守卫 —— 模型写完产物代码块之后又开始"方式二：Python 脚本"时，掐断上游生成
 *
 * 背景：
 *   输出格式模式（pptx/docx/html/pdf）约定模型只输出一个产物代码块，平台负责
 *   渲染和生成文件。但不少模型的训练惯性很强：写完 ```pptx 之后还要附赠一份
 *   几百行的 python-pptx 脚本、安装步骤、"方式二"……这部分对用户毫无用处，
 *   却占了整次回复 2/3 的输出 token 和等待时间。系统提示词与用户轮提醒能压掉
 *   大部分，这里是最后一道硬保险：一旦发现产物块闭合之后又开了一个"多余的"
 *   代码块，就把回复截到产物块末尾并停止读取上游流。
 *
 * 判定规则（按行、CommonMark 围栏语义，只看完整的行）：
 *   - 产物块：语言标识属于前端 ARTIFACT_LANG_MAP（pptx/ppt/slides/marp/docx/
 *     doc/word/html/htm/xhtml/pdf）的围栏块；只认第一个。
 *   - 多余块：产物块闭合之后，任何**带语言标识且不是产物语言**的围栏块。
 *     裸 ``` 不算——模型把 ``` 写进课件内部时，从外面看产物块会"提前闭合"，
 *     后面的裸 ``` 其实是课件的一部分，前端解析器有专门的找回逻辑。
 *   - 触发停止：多余块的第一行是生成脚本的签名（from pptx import / pip install
 *     python-docx / require('pptxgenjs') …），或者多余块超过 EXTRA_BLOCK_MAX_LINES
 *     行还没闭合。短小的多余块（"用法：~~~bash open index.html~~~"）不触发。
 *   - 截断位置：触发之前最后一个"非多余块"（产物块或裸块）的闭合围栏行末尾。
 *     这样课件内部混了裸 ``` 的情况也能保住整份课件；"方式二"标题、
 *     pip install 这些夹在中间的文字一并丢掉。
 *
 * 用法：
 *   const guard = new ArtifactStreamGuard();
 *   for (const delta of stream) {
 *     if (guard.push(delta).stop) { content = guard.cutContent(content); break; }
 *   }
 *   非流式：guard.push(content); guard.end(); if (guard.triggered) …
 *
 * 纯函数式状态机，不依赖任何 IO；偏移量以字符计，与逐段拼接的 fullContent 对齐。
 */

const ARTIFACT_LANGS = new Set([
  'html', 'htm', 'xhtml', 'pdf',
  'pptx', 'ppt', 'slides', 'marp',
  'docx', 'doc', 'word'
]);

/** 多余块超过这么多行还没闭合就认定为附赠脚本（课件里的代码页远小于此） */
const EXTRA_BLOCK_MAX_LINES = 20;

/** 多余块第一行就能认出来的"生成脚本"签名 */
const SCRIPT_SIGNATURE_RE = new RegExp([
  String.raw`^\s*from\s+(?:pptx|docx|reportlab|fpdf|openpyxl|python_pptx)\b`,
  String.raw`^\s*import\s+(?:pptx|docx|reportlab|fpdf)\b`,
  String.raw`^\s*(?:pip3?|python3?\s+-m\s+pip|conda|npm|pnpm|yarn)\s+(?:install|add|i)\b.*\b(?:python-pptx|python-docx|pptxgenjs|docx|reportlab|fpdf)\b`,
  String.raw`require\(\s*['"](?:pptxgenjs|docx|officegen)['"]\s*\)`,
  String.raw`^\s*import\s+.*\s+from\s+['"](?:pptxgenjs|docx|officegen)['"]`
].join('|'));

const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;

class ArtifactStreamGuard {
  constructor(options = {}) {
    this.maxExtraLines = options.maxExtraLines || EXTRA_BLOCK_MAX_LINES;
    this.offset = 0;          // 已按整行处理到的字符偏移
    this.pending = '';        // 尚未凑成整行的尾巴
    this.fence = null;        // 当前打开的围栏 {ch, len, lang, isArtifact, isExtra, lines}
    this.artifactClosed = false;
    this.lastKeepEnd = 0;     // 最后一个非多余块闭合行的末尾偏移
    this.triggered = false;
    this.cutOffset = 0;
    this.reason = null;
  }

  /**
   * 喂入一段新文本
   * @param {string} text - 增量文本（与 fullContent 的拼接顺序一致）
   * @returns {{stop: boolean}} stop 为 true 表示应截断并停止上游
   */
  push(text) {
    if (this.triggered || typeof text !== 'string' || !text) return { stop: this.triggered };
    this.pending += text;
    let nl;
    while (!this.triggered && (nl = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, nl + 1);
      this.pending = this.pending.slice(nl + 1);
      this._consumeLine(line);
    }
    return { stop: this.triggered };
  }

  /** 非流式场景：把最后一个不带换行的尾行也当整行处理 */
  end() {
    if (!this.triggered && this.pending) {
      const line = this.pending + '\n';
      this.pending = '';
      this._consumeLine(line);
    }
    return { stop: this.triggered };
  }

  /**
   * 截断后的内容（去掉末尾空白）
   * @param {string} fullContent - 与 push 顺序一致的完整内容
   */
  cutContent(fullContent) {
    if (!this.triggered) return fullContent;
    return fullContent.slice(0, this.cutOffset).replace(/\s+$/, '');
  }

  _consumeLine(line) {
    const lineStart = this.offset;
    this.offset += line.length;
    const body = line.replace(/\r?\n$/, '');

    if (!this.fence) {
      const m = body.match(OPEN_FENCE_RE);
      if (!m) return;
      const info = m[2].trim();
      // CommonMark：反引号围栏的 info string 里不能再有反引号（否则是行内代码）
      if (m[1][0] === '`' && info.includes('`')) return;
      const lang = (info.split(/\s+/)[0] || '').toLowerCase();
      const isArtifact = !this.artifactClosed && ARTIFACT_LANGS.has(lang);
      const isExtra = this.artifactClosed && !!lang && !ARTIFACT_LANGS.has(lang);
      this.fence = { ch: m[1][0], len: m[1].length, lang, isArtifact, isExtra, lines: 0, startOffset: lineStart };
      return;
    }

    const c = body.match(CLOSE_FENCE_RE);
    if (c && c[1][0] === this.fence.ch && c[1].length >= this.fence.len) {
      if (this.fence.isArtifact) this.artifactClosed = true;
      if (!this.fence.isExtra) this.lastKeepEnd = this.offset;
      this.fence = null;
      return;
    }

    this.fence.lines += 1;
    if (!this.fence.isExtra) return;
    if (this.fence.lines === 1 && SCRIPT_SIGNATURE_RE.test(body)) {
      this._trigger('script_signature');
    } else if (this.fence.lines > this.maxExtraLines) {
      this._trigger('extra_block_too_long');
    }
  }

  _trigger(reason) {
    if (this.lastKeepEnd <= 0) return; // 没有可保留的产物，不动
    this.triggered = true;
    this.reason = reason;
    this.cutOffset = this.lastKeepEnd;
  }
}

module.exports = { ArtifactStreamGuard, ARTIFACT_LANGS, EXTRA_BLOCK_MAX_LINES, SCRIPT_SIGNATURE_RE };
