/** Apply the existing saved theme to both CSS chrome and Ant Design controls. */
import { useEffect, useMemo } from 'react'
import { ConfigProvider } from 'antd'
import useSystemConfigStore from '../stores/systemConfigStore'
import { applyThemeColors, brandForeground, DEFAULT_THEME_COLORS } from '../styles/platform-theme'

const ThemeProvider = ({ children }) => {
  const { systemConfig } = useSystemConfigStore()
  const colors = systemConfig?.theme?.colors
  const theme = useMemo(() => {
    const palette = { ...DEFAULT_THEME_COLORS, ...colors }
    return { token: {
      colorPrimary: palette.primaryColor,
      colorInfo: palette.primaryColor,
      colorSuccess: palette.successColor,
      colorWarning: palette.warningColor,
      colorError: palette.errorColor,
      colorText: palette.textColor,
      colorTextSecondary: palette.textColorSecondary,
      colorBgLayout: palette.bodyBg,
      colorBgContainer: palette.componentBg,
      colorBorder: palette.borderColor,
      colorBorderSecondary: palette.borderColorSplit,
      colorTextLightSolid: brandForeground(palette.primaryColor),
      borderRadius: 9,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    } }
  }, [colors])
  useEffect(() => { applyThemeColors(colors) }, [colors])
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>
}
export default ThemeProvider
