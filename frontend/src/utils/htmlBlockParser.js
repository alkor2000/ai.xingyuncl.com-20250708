/**
 * Markdown 围栏代码块解析工具（CommonMark 兼容）
 * ============================================================================
 *
 * 【为什么需要这个文件】
 *
 * 此前 HtmlCanvasPanel / Chat 使用如下正则提取 HTML 代码块：
 *     /```(?:html|HTML)\s*\n([\s\S]*?)```/g
 *
 * 该正则是「非贪婪」匹配，它不理解 Markdown 围栏（fence）语法，只要遇到
 * 下一个出现的 ``` 就认为代码块结束。当 AI 生成的 HTML 内部的 JavaScript
 * 代码里出现反引号字符串字面量时（这在处理 AI 返回的 Markdown 时非常常见）：
 *
 *     if (jsonStr.startsWith('```json')) {
 *         jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
 *     }
 *
 * 正则会在这里提前"闭合"代码块，导致：
 *   1) iframe 拿到的是残缺 HTML（script 未闭合、缺 </html>），预览渲染失败
 *   2) 画布工具栏的"复制代码"复制到的也是被截断的内容
 *
 * 而 Markdown 正文里的代码块显示却是完整的 —— 因为 remark 严格遵循
 * CommonMark 规范：闭合围栏必须同时满足三个条件
 *   (a) 行首缩进不超过 3 个空格
 *   (b) 连续反引号数量 >= 开启围栏的反引号数量
 *   (c) 该围栏行反引号之后不能有任何非空白字符
 * 上面那几行缩进 12~16 个空格、且反引号不在行首，因此 remark 正确地
 * 没有把它们当作闭合围栏。
 *
 * 【本文件的做法】
 *
 * 用「逐行扫描 + 严格 CommonMark 围栏判定」替代正则，从根上消除误闭合。
 * 同时提供一层针对 HTML 完整文档的启发式兜底修复，用于防御 AI 输出中
 * 极端情况下出现的「行首裸 ``` 」（例如 HTML 里演示 Markdown 语法）。
 *
 * 【统一口径】
 *
 * HtmlCanvasPanel（实际渲染/复制）与 Chat（判断是否弹出画布、统计块数量）
 * 必须使用同一套解析逻辑，否则会出现「有块却不弹画布」或「计数错乱导致
 * 关闭后又被自动弹出」等不一致问题，因此两处统一 import 本文件。
 *
 * ============================================================================
 * 【v1.1 修复：CRLF / CR 换行导致围栏识别失败】
 *
 * 问题：v1.0 直接使用 content.split('\n') 拆行。若文本使用 Windows 的
 *      \r\n（CRLF）换行，拆分后每行末尾会残留一个 \r 字符，从而引发两处失效：
 *
 *   (1) 闭合围栏识别失败
 *       闭合正则要求围栏标记之后只能是 [ \t]* 直到行尾（$），
 *       而残留的 \r 既不是空格也不是制表符，导致 "```\r" 匹配不上，
 *       整个代码块被判定为「未闭合」→ 画布因 requireClosed 过滤而不渲染。
 *
 *   (2) 语言标识识别失败
 *       开启行 "```html\r" 解析出的 info string 为 "html\r"，
 *       parseLangFromInfo 得到 "html\r"，无法命中 HTML_LANG_SET，
 *       该块直接被当作非 HTML 块丢弃。
 *
 * 触发场景：用户粘贴 Windows 环境的文本、部分模型/中转代理返回 CRLF、
 *          知识库文档原文含 CRLF 等。当前主流 SSE 流式输出为 \n 所以尚未暴露，
 *          但属确定性缺陷，需在解析入口一次性根治。
 *
 * 修复方式：解析入口先做换行规范化 —— 将 \r\n 与孤立 \r（老式 Mac 换行）
 *          统一替换为 \n，再进行逐行扫描。这样开启行、闭合行、语言识别
 *          三处同时得到修复，无需在各个正则上零散地打 \r? 补丁。
 *
 * 副作用说明：提取出的代码内容换行统一为 \n（LF）。这对 iframe 的 srcDoc
 *            渲染、剪贴板复制、HTML 语义均无任何影响，且结果更规范。
 * ============================================================================
 *
 * 对外导出：
 *   - parseFencedBlocks(content, options)  解析全部围栏代码块（通用）
 *   - extractHtmlBlocks(content, options)  提取 HTML 代码块内容数组
 *   - countHtmlBlocks(content)             统计 HTML 代码块数量
 *   - hasHtmlBlock(content)                是否存在 HTML 代码块
 *   - collectHtmlFromMessages(messages)    从消息列表收集 HTML 块（含元信息）
 */

// ============================================================================
// 常量与正则定义
// ============================================================================

/**
 * 开启围栏行匹配
 * 分组1 = 围栏标记（连续的 ``` 或 ~~~，可多于 3 个）
 * 分组2 = info string（语言标识及其后内容）
 * 说明：行首允许 0~3 个空白缩进（CommonMark 规定最多 3 个空格）
 */
const OPEN_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

/**
 * 闭合围栏行匹配
 * 要求：行首缩进 <= 3、围栏标记之后只允许空白字符（CommonMark 硬性规则）
 * 正是这条规则让「  if (s.startsWith('```json')) {」不会被误判为闭合围栏
 *
 * 注意：本正则依赖调用方已完成换行规范化（见 normalizeLineEndings），
 *      行尾不得残留 \r，否则无法匹配。
 */
const CLOSE_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/

/** 被视为 HTML 的语言标识集合 */
const HTML_LANG_SET = new Set(['html', 'htm', 'xhtml'])

/** 判断代码内容是否为「完整 HTML 文档」的起始 */
const HTML_DOC_START_RE = /^\s*(<!doctype\s+html|<html[\s>])/i

/** 判断代码内容中是否存在 </html> 结束标签 */
const HTML_DOC_END_RE = /<\/html\s*>/i

/** 启发式修复时最多向后尝试的候选闭合围栏个数（防止无限扩张吞掉正文） */
const MAX_REPAIR_ATTEMPTS = 8

/** HTML 代码块最小有效长度（过滤掉无意义的空块） */
const DEFAULT_MIN_LENGTH = 10

/**
 * 换行符规范化正则
 * 匹配 \r\n（Windows CRLF）以及单独出现的 \r（老式 Mac CR）
 * 统一替换为 \n（LF）
 */
const LINE_ENDING_RE = /\r\n?/g

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * v1.1: 规范化文本换行符为 \n
 *
 * 必须在逐行扫描之前调用。否则 CRLF 文本按 '\n' 拆分后每行残留 \r，
 * 会同时破坏「闭合围栏识别」与「语言标识识别」（详见文件头 v1.1 说明）。
 *
 * @param {string} content - 原始文本
 * @returns {string} 换行统一为 \n 的文本
 */
const normalizeLineEndings = (content) => {
  return content.replace(LINE_ENDING_RE, '\n')
}

/**
 * 检查指定行区间内是否存在「带语言标识的开启围栏」
 *
 * 用途：启发式修复时，如果扩展区间内出现了新的 ```lang 开启围栏，
 *      说明已经进入了另一个独立代码块，必须停止扩展，
 *      否则会把后续正文错误地吞进当前 HTML 块。
 *
 * @param {string[]} lines - 全部行（已规范化换行）
 * @param {number} fromExclusive - 起始行号（不含）
 * @param {number} toExclusive - 结束行号（不含）
 * @param {string} fenceChar - 当前围栏字符（` 或 ~）
 * @returns {boolean} 区间内是否存在带语言标识的开启围栏
 */
const hasLabeledFenceBetween = (lines, fromExclusive, toExclusive, fenceChar) => {
  for (let idx = fromExclusive + 1; idx < toExclusive; idx += 1) {
    const openMatch = OPEN_FENCE_RE.exec(lines[idx])
    if (!openMatch) continue

    const marker = openMatch[1]
    // 只关心同类型围栏字符
    if (marker[0] !== fenceChar) continue

    const info = (openMatch[2] || '').trim()
    // info string 非空 => 这是一个新的「带语言标识」的开启围栏
    if (info.length > 0) return true
  }
  return false
}

/**
 * 从 info string 中提取语言标识
 * CommonMark 规定 info string 的第一个单词即为语言
 *
 * 注意：调用前文本已完成换行规范化，因此不会出现 "html\r" 这类污染值
 *
 * @param {string} infoString
 * @returns {string} 小写语言标识，无则返回空字符串
 */
const parseLangFromInfo = (infoString) => {
  const trimmed = (infoString || '').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/\s+/)[0]
  return (first || '').toLowerCase()
}

// ============================================================================
// 核心解析器
// ============================================================================

/**
 * 解析 Markdown 文本中的所有围栏代码块（严格 CommonMark 逐行扫描）
 *
 * 相比正则方案的关键差异：
 *   - 闭合围栏必须独占一行（后面只能跟空白），彻底避免被代码内部的
 *     反引号字符串字面量误闭合
 *   - 支持超过 3 个反引号的围栏（```` 包裹含 ``` 的内容）
 *   - 支持 ~~~ 波浪线围栏
 *   - 闭合围栏的反引号数量必须 >= 开启围栏数量
 *
 * v1.1: 入口新增换行规范化，兼容 CRLF / CR 文本
 *
 * @param {string} content - Markdown 文本
 * @param {Object} [options]
 * @param {boolean} [options.repairHtmlDocument=true] - 是否启用 HTML 文档完整性启发式修复
 * @returns {Array<{lang: string, code: string, closed: boolean, startLine: number, endLine: number}>}
 */
export const parseFencedBlocks = (content, options = {}) => {
  const { repairHtmlDocument = true } = options

  if (!content || typeof content !== 'string') return []

  // v1.1: 先统一换行符，再逐行扫描（关键修复点）
  const lines = normalizeLineEndings(content).split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const openMatch = OPEN_FENCE_RE.exec(lines[i])
    if (!openMatch) {
      i += 1
      continue
    }

    const marker = openMatch[1]
    const fenceChar = marker[0]
    const fenceLength = marker.length
    const infoString = openMatch[2] || ''

    // CommonMark 规则：反引号围栏的 info string 内不允许出现反引号
    // 例如 "```a```b" 不构成围栏，跳过该行
    if (fenceChar === '`' && infoString.includes('`')) {
      i += 1
      continue
    }

    const lang = parseLangFromInfo(infoString)

    // ------------------------------------------------------------------
    // 收集从开启围栏之后开始的所有「候选闭合围栏」行号
    // 正常情况只用第一个；启发式修复时才会尝试后续候选
    // ------------------------------------------------------------------
    const candidates = []
    for (let j = i + 1; j < lines.length; j += 1) {
      const closeMatch = CLOSE_FENCE_RE.exec(lines[j])
      if (!closeMatch) continue

      const closeMarker = closeMatch[1]
      // 围栏字符必须相同（``` 不能被 ~~~ 闭合）
      if (closeMarker[0] !== fenceChar) continue
      // 闭合围栏长度必须 >= 开启围栏长度
      if (closeMarker.length < fenceLength) continue

      candidates.push(j)
      // 候选数量足够即可停止收集，避免长文档全量扫描
      if (candidates.length > MAX_REPAIR_ATTEMPTS) break
    }

    // 默认采用第一个候选作为闭合围栏（严格 CommonMark 行为）
    let closeLine = candidates.length > 0 ? candidates[0] : -1
    let code = closeLine >= 0
      ? lines.slice(i + 1, closeLine).join('\n')
      : lines.slice(i + 1).join('\n')   // 未闭合（流式输出进行中）

    // ------------------------------------------------------------------
    // 启发式兜底：HTML 完整文档修复
    //
    // 触发条件：代码块语言是 html 且内容以 <!DOCTYPE html> / <html> 开头，
    //          但缺少 </html> 结束标签 —— 说明该块很可能被块内某个
    //          「行首裸 ``` 」提前闭合了（AI 输出不规范时可能出现）。
    // 处理方式：依次尝试后续候选闭合围栏，取第一个能让文档出现 </html> 的；
    //          若扩展区间内出现新的带语言标识开启围栏，则立即停止扩展，
    //          避免把后续正文吞进 HTML 块。
    // 安全性：只在「后续确实存在闭合围栏」时修复，不会把未闭合的流式内容
    //        误判为已完成。
    // ------------------------------------------------------------------
    if (
      repairHtmlDocument
      && closeLine >= 0
      && HTML_LANG_SET.has(lang)
      && HTML_DOC_START_RE.test(code)
      && !HTML_DOC_END_RE.test(code)
    ) {
      for (let k = 1; k < candidates.length; k += 1) {
        const nextClose = candidates[k]

        // 扩展区间内出现新代码块的开启围栏 => 停止，防止吞掉正文
        if (hasLabeledFenceBetween(lines, candidates[k - 1], nextClose, fenceChar)) {
          break
        }

        const extendedCode = lines.slice(i + 1, nextClose).join('\n')
        if (HTML_DOC_END_RE.test(extendedCode)) {
          closeLine = nextClose
          code = extendedCode
          break
        }
      }
    }

    blocks.push({
      lang,
      code,
      closed: closeLine >= 0,
      startLine: i,
      endLine: closeLine >= 0 ? closeLine : lines.length - 1
    })

    // 推进扫描位置到闭合围栏之后（未闭合则直接结束循环）
    i = (closeLine >= 0 ? closeLine : lines.length - 1) + 1
  }

  return blocks
}

// ============================================================================
// 对外便捷方法
// ============================================================================

/**
 * 提取文本中所有 HTML 代码块的内容
 *
 * @param {string} content - Markdown 文本
 * @param {Object} [options]
 * @param {number} [options.minLength=10] - 最小有效长度，过滤空壳块
 * @param {boolean} [options.requireClosed=true] - 是否只要已闭合的块
 *        （画布渲染必须为 true，避免流式输出中渲染半截 HTML）
 * @returns {string[]} HTML 代码字符串数组
 */
export const extractHtmlBlocks = (content, options = {}) => {
  const {
    minLength = DEFAULT_MIN_LENGTH,
    requireClosed = true
  } = options

  const blocks = parseFencedBlocks(content)
  const result = []

  for (const block of blocks) {
    // 流式输出中未闭合的块不参与渲染
    if (requireClosed && !block.closed) continue
    // 只要 html / htm / xhtml 语言标识的块
    if (!HTML_LANG_SET.has(block.lang)) continue

    const code = block.code.trim()
    if (!code || code.length < minLength) continue
    // 至少包含一个 HTML 标签才认为是有效 HTML
    if (!/<[a-zA-Z]/.test(code)) continue

    result.push(code)
  }

  return result
}

/**
 * 统计文本中 HTML 代码块的数量
 * @param {string} content
 * @returns {number}
 */
export const countHtmlBlocks = (content) => {
  return extractHtmlBlocks(content).length
}

/**
 * 判断文本中是否存在有效的 HTML 代码块
 * @param {string} content
 * @returns {boolean}
 */
export const hasHtmlBlock = (content) => {
  return extractHtmlBlocks(content).length > 0
}

/**
 * 从消息列表中收集所有 HTML 代码块（仅 AI 助手消息）
 *
 * 返回带元信息的数组，供画布面板做块切换与来源定位。
 * Chat 页面判断「是否弹出画布」「块数量是否增加」也使用本函数，
 * 保证与实际渲染的提取口径完全一致。
 *
 * @param {Array} messages - 消息列表
 * @returns {Array<{html: string, messageId: string, index: number, blockIndex: number, messageIndex: number, label: string}>}
 */
export const collectHtmlFromMessages = (messages) => {
  if (!messages || messages.length === 0) return []

  const allBlocks = []

  messages.forEach((msg, msgIndex) => {
    // 只从 AI 助手的消息中提取 HTML（用户输入不渲染）
    if (!msg || msg.role !== 'assistant') return

    const blocks = extractHtmlBlocks(msg.content)
    blocks.forEach((html, blockIndex) => {
      allBlocks.push({
        html,
        messageId: msg.id,
        index: allBlocks.length,   // 全局索引
        blockIndex,                // 在该条消息中的索引
        messageIndex: msgIndex,    // 消息在列表中的索引
        label: `HTML #${allBlocks.length + 1}`
      })
    })
  })

  return allBlocks
}

export default {
  parseFencedBlocks,
  extractHtmlBlocks,
  countHtmlBlocks,
  hasHtmlBlock,
  collectHtmlFromMessages
}
