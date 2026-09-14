/**
 * 幻灯片主题（模板）：预览（CSS 变量 + 版式类名）与 .pptx 导出（pptxgenjs）共用同一份定义，
 * 保证"看到的"和"下载的"是同一套配色与版式。颜色一律不带 # 的六位十六进制。
 *
 * 一个主题 = 配色 + 字体 + 三个版式开关：
 *   cover    封面样式   solid 纯色 | gradient 对角渐变 | split 左色块右标题
 *   decor    封面装饰   none | circles 半透明大圆 | lines 标题上下细线
 *   content  内容页版式 accent-bar 标题下短强调条 | title-band 顶部色带白字标题 |
 *            side-stripe 左侧竖条 | minimal 全宽细线 | card 正文装在圆角卡片里
 *   art      封面背景图案（slideArt.js 程序生成）none | blobs 光斑 | rings 圆环 | diagonal 斜色带 | dots 点阵
 * 用户自备背景图：把 <key>-cover.jpg / <key>-content.jpg 放进 src/assets/slide-backgrounds/
 * 即覆盖程序生成的图（见 slideBackgrounds.js 与该目录 README）。
 *
 * 颜色字段：
 *   bg 内容页背景  surface 卡片/表格条纹/代码块底色  title 内容页标题色  text 正文  muted 页脚/次要
 *   accent 强调色（强调条、表头、封面装饰）  accent2 第二强调色（侧边条/装饰用，可与 accent 相同）
 *   accentText 强调色上的文字  coverBg 封面主色  coverBg2 封面渐变终点色  coverFg 封面文字
 * 字体：titleFont / bodyFont 给 pptx；预览用 SLIDE_FONT_STACK / SERIF_FONT_STACK 对应回退。
 */

export const SLIDE_FONT_FACE = 'Microsoft YaHei'
export const SLIDE_SERIF_FONT_FACE = 'SimSun'
export const SLIDE_CODE_FONT_FACE = 'Consolas'

/** 预览用 CSS 字体栈（与 pptx 的 fontFace 同源，追加常见回退） */
export const SLIDE_FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Segoe UI", Roboto, Arial, sans-serif'
export const SLIDE_SERIF_FONT_STACK = '"Songti SC", SimSun, "Noto Serif CJK SC", "Source Han Serif SC", Georgia, "Times New Roman", serif'

const sans = { titleFont: SLIDE_FONT_FACE, bodyFont: SLIDE_FONT_FACE, serif: false }
const serif = { titleFont: SLIDE_SERIF_FONT_FACE, bodyFont: SLIDE_FONT_FACE, serif: true }

/** 主题顺序即选择器里的顺序：前四个是首版，后面是版式模板 */
export const SLIDE_THEMES = Object.freeze({
  classic: {
    key: 'classic', ...sans,
    cover: 'solid', decor: 'none', content: 'accent-bar', art: 'diagonal',
    bg: 'FFFFFF', surface: 'F3F6FB',
    title: '1F3B73', text: '2B2F36', muted: '8A919C',
    accent: '2F6FED', accent2: '2F6FED', accentText: 'FFFFFF',
    coverBg: '1F3B73', coverBg2: '1F3B73', coverFg: 'FFFFFF'
  },
  business: {
    key: 'business', ...sans,
    cover: 'gradient', decor: 'lines', content: 'title-band', art: 'rings',
    bg: 'FFFFFF', surface: 'F4F6FA',
    title: '14213D', text: '2B2D42', muted: '8D99AE',
    accent: 'C9A227', accent2: 'C9A227', accentText: '14213D',
    coverBg: '0B1D3A', coverBg2: '1F3B73', coverFg: 'FFFFFF'
  },
  tech: {
    key: 'tech', ...sans,
    cover: 'gradient', decor: 'circles', content: 'side-stripe', art: 'blobs',
    bg: 'FFFFFF', surface: 'F3F0FF',
    title: '3B2F8F', text: '2B2B2B', muted: '8A8A9A',
    accent: '6C5CE7', accent2: '00B4D8', accentText: 'FFFFFF',
    coverBg: '4A3AFF', coverBg2: '00C2FF', coverFg: 'FFFFFF'
  },
  minimal: {
    key: 'minimal', ...sans,
    cover: 'solid', decor: 'lines', content: 'minimal', art: 'none',
    bg: 'FFFFFF', surface: 'F5F5F5',
    title: '111111', text: '333333', muted: '9A9A9A',
    accent: '111111', accent2: '111111', accentText: 'FFFFFF',
    coverBg: 'FFFFFF', coverBg2: 'FFFFFF', coverFg: '111111'
  },
  academic: {
    key: 'academic', ...serif,
    cover: 'solid', decor: 'lines', content: 'minimal', art: 'none',
    bg: 'FDFCF8', surface: 'F2EFE6',
    title: '5A1E1E', text: '2B2B2B', muted: '8B8378',
    accent: '8C2F2F', accent2: '8C2F2F', accentText: 'FFFFFF',
    coverBg: 'F7F3E8', coverBg2: 'F7F3E8', coverFg: '3A1F1F'
  },
  education: {
    key: 'education', ...sans,
    cover: 'gradient', decor: 'circles', content: 'card', art: 'dots',
    bg: 'FFFFFF', surface: 'E8F7F5',
    title: '0F766E', text: '233433', muted: '7A9A96',
    accent: '14B8A6', accent2: 'FBBF24', accentText: 'FFFFFF',
    coverBg: '0F766E', coverBg2: '14B8A6', coverFg: 'FFFFFF'
  },
  ink: {
    key: 'ink', ...sans,
    cover: 'gradient', decor: 'circles', content: 'side-stripe', art: 'blobs',
    bg: '0F172A', surface: '1E293B',
    title: 'F8FAFC', text: 'CBD5E1', muted: '94A3B8',
    accent: '38BDF8', accent2: 'A78BFA', accentText: '0B1120',
    coverBg: '0B1120', coverBg2: '1E3A8A', coverFg: 'FFFFFF'
  },
  split: {
    key: 'split', ...sans,
    cover: 'split', decor: 'none', content: 'title-band', art: 'none',
    bg: 'FFFFFF', surface: 'FFF4EC',
    title: '7C2D12', text: '2B2B2B', muted: '9A8A80',
    accent: 'EA580C', accent2: 'F59E0B', accentText: 'FFFFFF',
    coverBg: 'EA580C', coverBg2: 'F59E0B', coverFg: 'FFFFFF'
  },
  dark: {
    key: 'dark', ...sans,
    cover: 'solid', decor: 'none', content: 'accent-bar', art: 'rings',
    bg: '1E2430', surface: '2A3140',
    title: 'FFFFFF', text: 'E6E8EC', muted: '9AA1AD',
    accent: '4FC3F7', accent2: '4FC3F7', accentText: '0B1220',
    coverBg: '121721', coverBg2: '121721', coverFg: 'FFFFFF'
  },
  warm: {
    key: 'warm', ...sans,
    cover: 'solid', decor: 'none', content: 'accent-bar', art: 'diagonal',
    bg: 'FFFBF5', surface: 'FFF1E0',
    title: '8A3B12', text: '3A2A1E', muted: '9A8877',
    accent: 'E8711A', accent2: 'E8711A', accentText: 'FFFFFF',
    coverBg: 'E8711A', coverBg2: 'E8711A', coverFg: 'FFFFFF'
  },
  nature: {
    key: 'nature', ...sans,
    cover: 'solid', decor: 'none', content: 'accent-bar', art: 'blobs',
    bg: 'F7FBF7', surface: 'E9F5EA',
    title: '1E5A3A', text: '26332B', muted: '7D8C82',
    accent: '2E9E5B', accent2: '2E9E5B', accentText: 'FFFFFF',
    coverBg: '1E5A3A', coverBg2: '1E5A3A', coverFg: 'FFFFFF'
  }
})

export const DEFAULT_SLIDE_THEME = 'classic'

export const getSlideTheme = (key) => SLIDE_THEMES[key] || SLIDE_THEMES[DEFAULT_SLIDE_THEME]

/** 主题 → 预览组件根节点的 CSS 变量 */
export const slideThemeToCssVars = (theme) => ({
  '--slide-bg': `#${theme.bg}`,
  '--slide-surface': `#${theme.surface}`,
  '--slide-title': `#${theme.title}`,
  '--slide-text': `#${theme.text}`,
  '--slide-muted': `#${theme.muted}`,
  '--slide-accent': `#${theme.accent}`,
  '--slide-accent2': `#${theme.accent2}`,
  '--slide-accent-text': `#${theme.accentText}`,
  '--slide-cover-bg': `#${theme.coverBg}`,
  '--slide-cover-bg2': `#${theme.coverBg2}`,
  '--slide-cover-fg': `#${theme.coverFg}`,
  '--slide-font': SLIDE_FONT_STACK,
  '--slide-title-font': theme.serif ? SLIDE_SERIF_FONT_STACK : SLIDE_FONT_STACK
})

/** 主题 → 幻灯片根节点的版式类名（预览用） */
export const slideThemeClassNames = (theme) =>
  `cover-${theme.cover} decor-${theme.decor} layout-${theme.content}${theme.serif ? ' serif-title' : ''}`
