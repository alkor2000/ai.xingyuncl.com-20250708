/**
 * 幻灯片主题：预览（CSS 变量）与 .pptx 导出（pptxgenjs 颜色）共用同一份色值，
 * 保证"看到的"和"下载的"是同一套配色。颜色一律不带 # 的六位十六进制。
 *
 * 字段：
 *   bg        内容页背景          surface  代码块/表格条纹等浅色面
 *   title     内容页标题色        text     正文色          muted 页脚/次要文字
 *   accent    强调色（标题下划线、表头、封面装饰条） accentText 强调色上的文字
 *   coverBg   封面/章节页背景     coverFg  封面文字
 */

export const SLIDE_THEMES = Object.freeze({
  classic: {
    key: 'classic',
    bg: 'FFFFFF', surface: 'F3F6FB',
    title: '1F3B73', text: '2B2F36', muted: '8A919C',
    accent: '2F6FED', accentText: 'FFFFFF',
    coverBg: '1F3B73', coverFg: 'FFFFFF'
  },
  dark: {
    key: 'dark',
    bg: '1E2430', surface: '2A3140',
    title: 'FFFFFF', text: 'E6E8EC', muted: '9AA1AD',
    accent: '4FC3F7', accentText: '0B1220',
    coverBg: '121721', coverFg: 'FFFFFF'
  },
  warm: {
    key: 'warm',
    bg: 'FFFBF5', surface: 'FFF1E0',
    title: '8A3B12', text: '3A2A1E', muted: '9A8877',
    accent: 'E8711A', accentText: 'FFFFFF',
    coverBg: 'E8711A', coverFg: 'FFFFFF'
  },
  nature: {
    key: 'nature',
    bg: 'F7FBF7', surface: 'E9F5EA',
    title: '1E5A3A', text: '26332B', muted: '7D8C82',
    accent: '2E9E5B', accentText: 'FFFFFF',
    coverBg: '1E5A3A', coverFg: 'FFFFFF'
  }
})

export const DEFAULT_SLIDE_THEME = 'classic'

/** 中文优先的字体；PowerPoint / 浏览器缺字体时会自动回退 */
export const SLIDE_FONT_FACE = 'Microsoft YaHei'
export const SLIDE_CODE_FONT_FACE = 'Consolas'

/** 预览用 CSS 字体栈（与 SLIDE_FONT_FACE 同源，追加常见回退） */
export const SLIDE_FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Segoe UI", Roboto, Arial, sans-serif'

export const getSlideTheme = (key) => SLIDE_THEMES[key] || SLIDE_THEMES[DEFAULT_SLIDE_THEME]

/** 主题 → 预览组件根节点的 CSS 变量 */
export const slideThemeToCssVars = (theme) => ({
  '--slide-bg': `#${theme.bg}`,
  '--slide-surface': `#${theme.surface}`,
  '--slide-title': `#${theme.title}`,
  '--slide-text': `#${theme.text}`,
  '--slide-muted': `#${theme.muted}`,
  '--slide-accent': `#${theme.accent}`,
  '--slide-accent-text': `#${theme.accentText}`,
  '--slide-cover-bg': `#${theme.coverBg}`,
  '--slide-cover-fg': `#${theme.coverFg}`,
  '--slide-font': SLIDE_FONT_STACK
})
