/**
 * LaTeX 公式 → 可读的 Unicode 文本
 *
 * 课件/文档里模型偶尔会写
 *   $$\text{二氧化碳} + \text{水} \xrightarrow[\text{叶绿体}]{\text{光能}} \text{有机物} + \text{氧气}$$
 * 幻灯片预览、.pptx、.docx 都没有公式排版引擎（为此引入 KaTeX 要多带一套字体，
 * 而且 pptxgenjs/docx 也画不了），所以把常见命令折成 Unicode：
 *   \xrightarrow[下]{上} → ─上（下）→    H_2O → H₂O    x^{2} → x²    \frac{a}{b} → a/b
 *   \alpha → α    \times → ×    \ce{CO2 + H2O -> O2} → CO₂ + H₂O → O₂
 * 覆盖不到的命令去掉反斜杠保留参数文字，不会把公式整段丢掉。
 *
 * 两个入口：
 *   latexToText(latex)          单个公式体
 *   convertMathInMarkdown(md)   整段 Markdown：$$…$$ / \[…\] / $…$ / \(…\) 就地替换，跳过代码块与行内代码
 */

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', ' ': ' '
}
const SUBSCRIPT = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', ' ': ' '
}

/** 无参数命令 → 符号 */
const SYMBOLS = {
  rightarrow: '→', to: '→', longrightarrow: '⟶', leftarrow: '←', longleftarrow: '⟵', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', rightleftharpoons: '⇌', leftrightharpoons: '⇋',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '★', bullet: '•', circ: '°', degree: '°',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', propto: '∝',
  ll: '≪', gg: '≫', infty: '∞', sum: 'Σ', prod: '∏', int: '∫', iint: '∬', oint: '∮', partial: '∂', nabla: '∇',
  ldots: '…', cdots: '⋯', vdots: '⋮', dots: '…', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  neg: '¬', lnot: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', angle: '∠', perp: '⊥', parallel: '∥',
  triangle: '△', square: '□', Box: '□', diamond: '◇', checkmark: '✓', prime: '′', hbar: 'ℏ', ell: 'ℓ',
  Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', therefore: '∴', because: '∵', mid: '|', vert: '|', Vert: '‖',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω',
  quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '\\': '\n',
  '{': '{', '}': '}', '%': '%', '&': '&', $: '$', '#': '#', _: '_', '^': '^', '|': '‖'
}

/** 只是排版控制、原样忽略的命令（有些带一个参数也一起丢） */
const IGNORED = new Set([
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr',
  'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits', 'mathstrut', 'strut',
  'notag', 'nonumber', 'allowbreak', 'relax', 'smallskip', 'medskip', 'bigskip', 'noindent', 'centering', 'boldmath'
])
const IGNORED_WITH_ARG = new Set(['hspace', 'vspace', 'phantom', 'hphantom', 'vphantom', 'label', 'tag', 'color', 'begin', 'end', 'rule', 'kern', 'mkern'])

/** 带一个参数、输出即参数内容的命令 */
const WRAPPERS = new Set([
  'text', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'textnormal', 'mbox', 'hbox', 'ensuremath',
  'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathbb', 'mathfrak', 'mathscr', 'boldsymbol', 'bm',
  'operatorname', 'underline', 'overline', 'vec', 'hat', 'bar', 'dot', 'ddot', 'tilde', 'widehat', 'widetilde',
  'overrightarrow', 'overleftarrow', 'underbrace', 'overbrace', 'cancel', 'boxed', 'pmb', 'emph', 'textup', 'mathord'
])

/** 函数名：原样输出名字 */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'mod', 'bmod', 'pmod'
])

/** 读一个 {…} 组：返回 [内容, 结束后的下标]；不配平时读到结尾 */
const readGroup = (s, start) => {
  let depth = 0
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '\\') { i += 1; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return [s.slice(start + 1, i), i + 1]
    }
  }
  return [s.slice(start + 1), s.length]
}

/** 读一个参数：{组} / \命令 / 单字符 */
const readArg = (s, start) => {
  let i = start
  while (i < s.length && s[i] === ' ') i += 1
  if (i >= s.length) return ['', i]
  if (s[i] === '{') return readGroup(s, i)
  if (s[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
    return [m ? m[0] : '\\', i + (m ? m[0].length : 1)]
  }
  return [s[i], i + 1]
}

/** 读可选参数 [ … ]（紧跟着才算） */
const readOptional = (s, start) => {
  let i = start
  while (i < s.length && s[i] === ' ') i += 1
  if (s[i] !== '[') return [null, start]
  const end = s.indexOf(']', i)
  if (end < 0) return [null, start]
  return [s.slice(i + 1, end), end + 1]
}

/** 上/下标：能整段映射就用 Unicode 上下标，否则加括号 */
const toScript = (text, superscript) => {
  const table = superscript ? SUPERSCRIPT : SUBSCRIPT
  const chars = [...text]
  if (chars.length > 0 && chars.every(ch => table[ch] !== undefined)) return chars.map(ch => table[ch]).join('')
  if (!text) return ''
  return superscript ? `^(${text})` : text
}

/** 分数：简单的两边直接 a/b，复杂的加括号 */
const simpleOperand = (text) => /^[\w一-龥²³¹⁰-⁹₀-₉αβγδεθλμπσωΔ]+$/.test(text) && text.length <= 6
const toFraction = (num, den) => {
  const n = simpleOperand(num) ? num : `(${num})`
  const d = simpleOperand(den) ? den : `(${den})`
  return `${n}/${d}`
}

/** 化学方程式 \ce{…}：字母后的数字是下标，-> / <=> 是箭头，^ 后是电荷 */
const convertChem = (src) => {
  let s = src.replace(/<=>/g, ' ⇌ ').replace(/<->/g, ' ↔ ').replace(/->/g, ' → ').replace(/<-/g, ' ← ')
  s = s.replace(/([A-Za-z)\]])(\d+)/g, (_, lead, digits) => lead + [...digits].map(d => SUBSCRIPT[d]).join(''))
  s = s.replace(/\^\{?(\d*[+-])\}?/g, (_, charge) => toScript(charge, true))
  s = s.replace(/_\{?(\d+)\}?/g, (_, digits) => toScript(digits, false))
  return s.replace(/\s+/g, ' ').trim()
}

const convertNodes = (s) => {
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]

    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
      if (!m) { i += 1; continue }
      const name = m[1]
      i += m[0].length

      if (WRAPPERS.has(name)) {
        const [arg, next] = readArg(s, i); i = next
        out += convertNodes(arg)
      } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const [num, n1] = readArg(s, i)
        const [den, n2] = readArg(s, n1); i = n2
        out += toFraction(convertNodes(num), convertNodes(den))
      } else if (name === 'sqrt') {
        const [index, n1] = readOptional(s, i)
        const [arg, n2] = readArg(s, n1); i = n2
        const body = convertNodes(arg)
        const radicand = simpleOperand(body) ? body : `(${body})`
        out += (index ? toScript(convertNodes(index), true) : '') + '√' + radicand
      } else if (/^x(?:right|left|Right|Left)arrow$/.test(name) || name === 'xrightleftharpoons') {
        const [below, n1] = readOptional(s, i)
        const [above, n2] = readArg(s, n1); i = n2
        const head = /left/i.test(name) ? '←' : name === 'xrightleftharpoons' ? '⇌' : '→'
        const top = convertNodes(above).trim()
        const bottom = below ? convertNodes(below).trim() : ''
        const label = top && bottom ? `${top}（${bottom}）` : (top || bottom)
        out += label ? ` ─${label}${head} ` : ` ${head} `
      } else if (name === 'overset' || name === 'underset' || name === 'stackrel') {
        const [note, n1] = readArg(s, i)
        const [base, n2] = readArg(s, n1); i = n2
        out += `${convertNodes(base)}(${convertNodes(note)})`
      } else if (name === 'textcolor' || name === 'colorbox') {
        const [, n1] = readArg(s, i)
        const [body, n2] = readArg(s, n1); i = n2
        out += convertNodes(body)
      } else if (name === 'ce' || name === 'cf') {
        const [arg, next] = readArg(s, i); i = next
        out += convertChem(arg)
      } else if (IGNORED_WITH_ARG.has(name)) {
        const [, next] = readArg(s, i); i = next
      } else if (IGNORED.has(name)) {
        // 纯排版控制，跳过
      } else if (FUNCTIONS.has(name)) {
        out += name
      } else if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name]
      } else {
        // 未知命令：有参数就保留参数文字，否则保留命令名
        const [maybeArg, next] = /^\s*\{/.test(s.slice(i)) ? readArg(s, i) : [null, i]
        i = next
        out += maybeArg !== null ? convertNodes(maybeArg) : name
      }
      continue
    }

    if (ch === '{') {
      const [inner, next] = readGroup(s, i); i = next
      out += convertNodes(inner)
      continue
    }
    if (ch === '}') { i += 1; continue }
    if (ch === '^' || ch === '_') {
      const [arg, next] = readArg(s, i + 1); i = next
      out += toScript(convertNodes(arg), ch === '^')
      continue
    }
    if (ch === '~') { out += ' '; i += 1; continue }
    if (ch === '&') { out += ' '; i += 1; continue }
    out += ch
    i += 1
  }
  return out
}

/**
 * 单个公式体 → 可读文本
 * @param {string} latex - 不含 $ 定界符的公式
 * @returns {string}
 */
export const latexToText = (latex) => convertNodes(String(latex || ''))
  .replace(/[ \t]+/g, ' ')
  .replace(/\s+([,，.。])/g, '$1')
  .replace(/\n\s*/g, '\n')
  .trim()

// ---------------------------------------------------------------------------
// Markdown 级替换
// ---------------------------------------------------------------------------

const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g
// 行内 $…$：开头紧跟非空白、结尾前非空白、后面不接数字（避免把 "$5 和 $10" 当公式）
const INLINE_MATH_RE = /(?<![\\$\w])\$(?=\S)((?:[^$\n\\]|\\.)+?)(?<=\S)\$(?![\d$])|\\\(([\s\S]+?)\\\)/g

const convertMathInText = (text) => text
  .replace(DISPLAY_MATH_RE, (_, a, b) => latexToText(a ?? b))
  .replace(INLINE_MATH_RE, (_, a, b) => latexToText(a ?? b))

/** 是否像公式：含反斜杠命令、上下标或希腊字母等，避免把普通 "$a$" 之类误转 */
export const hasMath = (text) => /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$\w])\$(?=\S)(?:[^$\n\\]|\\.)+?(?<=\S)\$(?![\d$])/.test(text)

/**
 * 整段 Markdown 里的公式就地替换成可读文本；围栏代码块和行内代码原样保留
 * @param {string} markdown
 * @returns {string}
 */
export const convertMathInMarkdown = (markdown) => {
  const src = String(markdown || '')
  if (!src.includes('$') && !src.includes('\\(') && !src.includes('\\[')) return src
  const lines = src.split('\n')
  const out = []
  let fence = null
  let buffer = []
  const flush = () => {
    if (buffer.length === 0) return
    const text = buffer.join('\n')
    // 行内代码原样保留
    const parts = text.split(/(`+[^`]*`+)/)
    out.push(parts.map((part, idx) => (idx % 2 === 1 ? part : convertMathInText(part))).join(''))
    buffer = []
  }
  for (const line of lines) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null
      continue
    }
    if (open) {
      flush()
      fence = open[1]
      out.push(line)
      continue
    }
    buffer.push(line)
  }
  flush()
  return out.join('\n')
}

export default { latexToText, convertMathInMarkdown, hasMath }
