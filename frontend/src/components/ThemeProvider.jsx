/**
 * 主题Provider组件
 * 负责在应用加载时从系统配置中获取主题并应用
 */

import { useEffect } from 'react'
import useSystemConfigStore from '../stores/systemConfigStore'

const ThemeProvider = ({ children }) => {
  const { systemConfig } = useSystemConfigStore()

  useEffect(() => {
    // 应用主题
    if (systemConfig?.theme?.colors) {
      applyTheme(systemConfig.theme.colors)
    }
  }, [systemConfig])

  const applyTheme = (colors) => {
    const root = document.documentElement
    
    // 确保colors是一个对象
    if (typeof colors === 'object' && colors !== null) {
      Object.entries(colors).forEach(([key, value]) => {
        // 将驼峰命名转换为 kebab-case
        const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
        root.style.setProperty(cssVarName, value)
      })
    }
  }

  return children
}

export default ThemeProvider
