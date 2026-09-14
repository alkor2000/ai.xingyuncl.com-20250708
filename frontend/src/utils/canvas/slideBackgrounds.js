/**
 * 用户自备的幻灯片背景图
 *
 * 把图片按文件名放进 frontend/src/assets/slide-backgrounds/ 即自动生效（重新构建后）：
 *   <主题key>-cover.(jpg|jpeg|png|webp)    封面背景，覆盖 slideArt 程序生成的图
 *   <主题key>-content.(jpg|jpeg|png|webp)  内容页背景（很淡的纹理/光斑，正文区会盖一层半透明底保证可读）
 * 主题 key 见 slideThemes.js（classic / business / tech / minimal / academic / education / ink / split / dark / warm / nature）。
 *
 * 用 Vite 的 import.meta.glob 在构建期收集，得到带 hash 的静态 URL；没有文件时对应项为空，
 * 预览与导出都会退回程序生成图/纯色，不会报错。生图提示词与尺寸要求见该目录的 README.md。
 */

const files = import.meta.glob('../../assets/slide-backgrounds/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
  query: '?url'
})

const byName = {}
for (const [path, url] of Object.entries(files)) {
  const name = path.split('/').pop().replace(/\.(jpg|jpeg|png|webp)$/i, '')
  byName[name] = url
}

/**
 * @param {string} themeKey
 * @returns {{ cover: string|null, content: string|null }}
 */
export const getThemeBackgrounds = (themeKey) => ({
  cover: byName[`${themeKey}-cover`] || null,
  content: byName[`${themeKey}-content`] || null
})

/** 有任何自备图的主题 key 列表（选择器里可标注"自定义图"） */
export const customBackgroundThemes = () =>
  Object.keys(byName).map(n => n.replace(/-(cover|content)$/, '')).filter((v, i, a) => a.indexOf(v) === i)

export default { getThemeBackgrounds, customBackgroundThemes }
