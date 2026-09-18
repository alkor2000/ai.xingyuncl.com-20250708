/** Shared presentation defaults. Existing saved colors remain authoritative. */
export const DEFAULT_THEME_COLORS = {
  primaryColor: '#8b1f35', successColor: '#52c41a', warningColor: '#faad14', errorColor: '#ff4d4f',
  bodyBg: '#f7f5f2', componentBg: '#fffdfb', headerBg: '#fffdfb', sidebarBg: '#fffdfb',
  textColor: '#272525', textColorSecondary: '#65615f', textColorTertiary: '#918b86',
  borderColor: '#e8e2dc', borderColorSplit: '#eee8e2', navHeaderBg: '#fffdfb', navHeaderText: '#272525',
  navHeaderBorder: '#e8e2dc', navLogoBg: '#8b1f35', navLogoText: '#ffffff',
  sidebarMenuBg: '#fffdfb', sidebarMenuText: '#65615f', sidebarMenuActiveBg: '#f7eaed',
  sidebarMenuActiveText: '#8b1f35', sidebarMenuHoverBg: '#f4f0ed', sidebarMenuHoverText: '#8b1f35', sidebarSubmenuBg: '#fffdfb',
  chatBg: '#f7f5f2', chatSidebarBg: '#fffdfb', userMessageBg: '#f7eaed', userMessageText: '#272525',
  aiMessageBg: '#fffdfb', aiMessageText: '#272525', inputBg: '#ffffff', inputBorder: '#e0d9d3',
  codeBlockBg: '#2d3748', codeBlockText: '#e2e8f0', codeBlockHeaderBg: '#f6f8fa'
}

export function brandForeground(color) {
  const value = String(color || '').trim()
  let hex = value.replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map(c => c + c).join('')
  let channels
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  } else {
    // The existing ColorPicker persists rgb()/rgba(), including optional alpha.
    const match = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
    if (!match) return '#ffffff'
    const alpha = match[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(match[4])))
    channels = match.slice(1, 4).map(c => Math.min(255, Math.max(0, Number(c))) / 255 * alpha + 1 - alpha)
  }
  const rgb = channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  return (luminance + .05) / .05 > 1.05 / (luminance + .05) ? '#171717' : '#ffffff'
}

export function applyThemeColors(colors = {}) {
  const palette = { ...DEFAULT_THEME_COLORS, ...colors }
  Object.entries(palette).forEach(([key, value]) => {
    const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    document.documentElement.style.setProperty(cssVarName, value)
  })
  document.documentElement.style.setProperty('--brand-on-primary', brandForeground(palette.primaryColor))
}
