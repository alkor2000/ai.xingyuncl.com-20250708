/**
 * 幻灯片主题定义完整性：每个模板的版式开关都在白名单内、颜色是六位 hex、
 * 预览类名/CSS 变量与 pptx 导出读的是同一份字段。
 */
import { describe, it, expect } from 'vitest'
import { SLIDE_THEMES, DEFAULT_SLIDE_THEME, getSlideTheme, slideThemeToCssVars, slideThemeClassNames } from '../../../utils/canvas/slideThemes'
import { renderCoverArt, renderBandArt } from '../../../utils/canvas/slideArt'
import { getThemeBackgrounds } from '../../../utils/canvas/slideBackgrounds'

const HEX = /^[0-9A-F]{6}$/
const COLOR_FIELDS = ['bg', 'surface', 'title', 'text', 'muted', 'accent', 'accent2', 'accentText', 'coverBg', 'coverBg2', 'coverFg']

describe('SLIDE_THEMES', () => {
  it('至少 11 个模板，默认模板存在', () => {
    expect(Object.keys(SLIDE_THEMES).length).toBeGreaterThanOrEqual(11)
    expect(SLIDE_THEMES[DEFAULT_SLIDE_THEME]).toBeDefined()
    expect(getSlideTheme('no-such-theme').key).toBe(DEFAULT_SLIDE_THEME)
  })

  it('每个模板字段完整、枚举值合法、颜色为六位 hex', () => {
    for (const [key, theme] of Object.entries(SLIDE_THEMES)) {
      expect(theme.key).toBe(key)
      expect(['solid', 'gradient', 'split']).toContain(theme.cover)
      expect(['none', 'circles', 'lines']).toContain(theme.decor)
      expect(['accent-bar', 'title-band', 'side-stripe', 'minimal', 'card']).toContain(theme.content)
      expect(['none', 'blobs', 'rings', 'diagonal', 'dots']).toContain(theme.art)
      expect(typeof theme.titleFont).toBe('string')
      expect(typeof theme.bodyFont).toBe('string')
      for (const f of COLOR_FIELDS) expect(theme[f], `${key}.${f}`).toMatch(HEX)
    }
  })

  it('CSS 变量与版式类名从同一份定义派生', () => {
    const theme = SLIDE_THEMES.business
    const vars = slideThemeToCssVars(theme)
    expect(vars['--slide-accent']).toBe('#C9A227')
    expect(vars['--slide-cover-bg2']).toBe('#1F3B73')
    expect(slideThemeClassNames(theme)).toBe('cover-gradient decor-lines layout-title-band')
    expect(slideThemeClassNames(SLIDE_THEMES.academic)).toContain('serif-title')
  })

  it('没有 canvas 的环境下背景图生成返回 null，不抛错；自备图缺省为空', () => {
    expect(renderCoverArt('tech')).toBeNull()
    expect(renderBandArt('business')).toBeNull()
    expect(getThemeBackgrounds('tech')).toEqual({ cover: null, content: null })
  })
})
