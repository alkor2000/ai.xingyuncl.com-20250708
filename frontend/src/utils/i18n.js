/**
 * i18n国际化配置
 * 
 * 功能说明：
 * 1. 支持中英文切换
 * 2. 支持从系统配置获取默认语言
 * 3. 用户选择的语言保存在localStorage
 * 4. 优先级：用户选择 > 系统默认 > fallback(zh-CN)
 * 
 * 版本更新：
 * - v1.1.0 (2025-01-07): 添加系统默认语言支持
 * - v1.2.0 (2026-01-29): 修复无痕浏览器默认语言不生效问题
 *   - 移除 navigator 检测，避免自动使用浏览器语言
 *   - setSystemDefaultLanguage 改为异步函数，确保语言切换完成
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入语言文件
import zhCN from '../locales/zh-CN'
import enUS from '../locales/en-US'

// 语言资源配置
const resources = {
  'zh-CN': {
    translation: zhCN
  },
  'en-US': {
    translation: enUS
  }
}

// localStorage中保存语言偏好的键名
const LANGUAGE_STORAGE_KEY = 'i18nextLng'

// 系统默认语言标记的键名（用于区分用户主动选择和系统默认）
const USER_SELECTED_LANGUAGE_KEY = 'userSelectedLanguage'

/**
 * 检查用户是否主动选择过语言
 * @returns {boolean}
 */
export const hasUserSelectedLanguage = () => {
  return localStorage.getItem(USER_SELECTED_LANGUAGE_KEY) === 'true'
}

/**
 * 标记用户已主动选择语言
 */
export const markUserSelectedLanguage = () => {
  localStorage.setItem(USER_SELECTED_LANGUAGE_KEY, 'true')
}

/**
 * 设置系统默认语言（仅当用户未主动选择时生效）
 * 
 * v1.2.0 修复：改为异步函数，等待 i18n.changeLanguage 完成
 * 
 * @param {string} language - 语言代码，如 'zh-CN' 或 'en-US'
 * @returns {Promise<boolean>} - 是否成功应用
 */
export const setSystemDefaultLanguage = async (language) => {
  // 只有用户没有主动选择过语言时，才应用系统默认语言
  if (!hasUserSelectedLanguage() && language) {
    // 验证语言代码是否有效
    if (language === 'zh-CN' || language === 'en-US') {
      console.log('🌐 准备应用系统默认语言:', language)
      
      // v1.2.0 关键修复：await 等待语言切换完成
      await i18n.changeLanguage(language)
      
      console.log('✅ 系统默认语言已应用:', language, '当前语言:', i18n.language)
      
      // 不标记为用户选择，这样管理员更改默认语言后，新用户仍会使用新的默认语言
      return true
    }
  }
  return false
}

/**
 * 切换语言（用户主动切换时调用）
 * @param {string} language - 语言代码
 * @returns {Promise<void>}
 */
export const changeLanguage = async (language) => {
  if (language === 'zh-CN' || language === 'en-US') {
    markUserSelectedLanguage() // 标记为用户主动选择
    await i18n.changeLanguage(language)
    console.log('🌐 用户切换语言:', language)
  }
}

/**
 * 获取当前语言
 * @returns {string}
 */
export const getCurrentLanguage = () => {
  return i18n.language || 'zh-CN'
}

/**
 * 获取支持的语言列表
 * @returns {Array}
 */
export const getSupportedLanguages = () => {
  return [
    { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
    { code: 'en-US', name: 'English', flag: '🇺🇸' }
  ]
}

/**
 * 初始化i18n
 * 
 * v1.2.0 修复：
 * - detection.order 移除 'navigator'，不自动检测浏览器语言
 * - 这样无痕浏览器首次访问时，会使用 fallbackLng
 * - 然后由 App.jsx 从 API 获取系统默认语言并应用
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN', // 默认回退语言
    debug: false,
    
    interpolation: {
      escapeValue: false // React已经安全处理了XSS
    },
    
    detection: {
      // v1.2.0 修复：移除 'navigator'，不检测浏览器语言
      // 只从 localStorage 读取用户之前选择的语言
      // 如果没有，则使用 fallbackLng，然后等待 App.jsx 从 API 获取系统默认语言
      order: ['localStorage', 'htmlTag'],
      // 缓存到localStorage
      caches: ['localStorage'],
      // localStorage中的键名
      lookupLocalStorage: LANGUAGE_STORAGE_KEY
    }
  })

export default i18n
