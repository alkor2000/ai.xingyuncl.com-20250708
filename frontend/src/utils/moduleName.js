/**
 * 模块显示名称 i18n 工具
 *
 * 背景：
 *   system_modules 表的 display_name 存的是"中文-英文"混合文案（如"AI对话-Chat"），
 *   数据库字段无法随界面语言切换。本工具提供统一的映射逻辑：
 *     1. 优先查 locale 中的 module.{name} 键（如 module.chat -> "AI对话" / "AI Chat"）
 *     2. locale 中没有对应键时（如管理员自建的外部模块），回退数据库 display_name
 *     3. display_name 也为空时兜底返回 name 标识
 *
 * 使用方（保持展示逻辑一致）：
 *   - pages/dashboard/Dashboard.jsx  功能模块网格卡片名称
 *   - layouts/BasicLayout/index.jsx  侧边栏/移动端抽屉菜单 label（悬停Tooltip同源）
 *
 * 注意：
 *   - 必须传入组件内 useTranslation() 得到的 t 和 i18n，本文件不自行 import i18n 实例，
 *     以保证语言切换时调用方组件能正常重渲染
 */

/**
 * 获取模块的本地化显示名称
 * @param {object} module - 模块对象，需含 name 和 display_name 字段
 * @param {function} t - react-i18next 的翻译函数
 * @param {object} i18n - react-i18next 的 i18n 实例（用于 exists 判断）
 * @returns {string} 本地化后的模块名称
 */
export const getModuleDisplayName = (module, t, i18n) => {
  if (!module) return ''

  const key = `module.${module.name}`

  // i18n.exists 判断当前语言资源中是否存在该键，避免 t() 返回裸键字符串
  if (module.name && i18n && typeof i18n.exists === 'function' && i18n.exists(key)) {
    return t(key)
  }

  // 回退：数据库 display_name -> name 标识
  return module.display_name || module.name || ''
}

export default getModuleDisplayName
