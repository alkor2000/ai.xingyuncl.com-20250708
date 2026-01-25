/**
 * i18n国际化配置
 * 
 * 功能说明：
 * 1. 支持中英文切换
 * 2. 支持从系统配置获取默认语言
 * 3. 用户选择的语言保存在localStorage
 * 4. 优先级：用户选择 > 系统默认 > 浏览器语言 > fallback(zh-CN)
 * 
 * 版本更新：
 * - v1.1.0 (2025-01-07): 添加系统默认语言支持
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
 * @param {string} language - 语言代码，如 'zh-CN' 或 'en-US'
 */
export const setSystemDefaultLanguage = (language) => {
  // 只有用户没有主动选择过语言时，才应用系统默认语言
  if (!hasUserSelectedLanguage() && language) {
    // 验证语言代码是否有效
    if (language === 'zh-CN' || language === 'en-US') {
      console.log('🌐 应用系统默认语言:', language)
      i18n.changeLanguage(language)
      // 不标记为用户选择，这样管理员更改默认语言后，新用户仍会使用新的默认语言
    }
  }
}

/**
 * 切换语言（用户主动切换时调用）
 * @param {string} language - 语言代码
 */
export const changeLanguage = (language) => {
  if (language === 'zh-CN' || language === 'en-US') {
    markUserSelectedLanguage() // 标记为用户主动选择
    i18n.changeLanguage(language)
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

// 初始化i18n
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
      // 检测顺序：localStorage > 浏览器语言 > HTML标签
      order: ['localStorage', 'navigator', 'htmlTag'],
      // 缓存到localStorage
      caches: ['localStorage'],
      // localStorage中的键名
      lookupLocalStorage: LANGUAGE_STORAGE_KEY
    }
  })

export default i18n
