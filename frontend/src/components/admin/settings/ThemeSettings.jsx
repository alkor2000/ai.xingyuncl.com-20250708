/**
 * 主题设置组件 - 支持自定义全站配色方案
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Form,
  Row,
  Col,
  Select,
  ColorPicker,
  Button,
  Space,
  Divider,
  Typography,
  Alert,
  Tag,
  Switch,
  message,
  Tooltip
} from 'antd'
import {
  BgColorsOutlined,
  SaveOutlined,
  ReloadOutlined,
  EyeOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import useAdminStore from '../../../stores/adminStore'
import useSystemConfigStore from '../../../stores/systemConfigStore'

const { Title, Text } = Typography

// 预设主题配置 - 只保留默认主题
const PRESET_THEMES = {
  default: {
    name: '默认主题',
    description: '系统默认配色方案',
    colors: {
      // 基础颜色
      primaryColor: '#1677ff',
      successColor: '#52c41a',
      warningColor: '#faad14',
      errorColor: '#ff4d4f',
      
      // 背景颜色
      bodyBg: '#f5f5f5',
      componentBg: '#ffffff',
      headerBg: '#ffffff',
      sidebarBg: '#ffffff',
      
      // 文字颜色
      textColor: 'rgba(0, 0, 0, 0.85)',
      textColorSecondary: 'rgba(0, 0, 0, 0.65)',
      textColorTertiary: 'rgba(0, 0, 0, 0.45)',
      
      // 边框和分割线
      borderColor: '#f0f0f0',
      borderColorSplit: '#f0f0f0',
      
      // 顶部导航栏
      navHeaderBg: '#ffffff',
      navHeaderText: 'rgba(0, 0, 0, 0.85)',
      navHeaderBorder: '#f0f0f0',
      navLogoBg: '#1677ff',
      navLogoText: '#ffffff',
      
      // 侧边栏
      sidebarMenuBg: '#ffffff',
      sidebarMenuText: 'rgba(0, 0, 0, 0.65)',
      sidebarMenuActiveBg: '#e6f4ff',
      sidebarMenuActiveText: '#1677ff',
      sidebarMenuHoverBg: '#f0f0f0',
      sidebarMenuHoverText: '#1677ff',
      sidebarSubmenuBg: '#ffffff',
      
      // 聊天界面专属
      chatBg: '#fafafa',
      chatSidebarBg: '#ffffff',
      userMessageBg: '#e3f2fd',
      userMessageText: 'rgba(0, 0, 0, 0.85)',
      aiMessageBg: '#f5f5f5',
      aiMessageText: 'rgba(0, 0, 0, 0.85)',
      inputBg: '#ffffff',
      inputBorder: '#d9d9d9',
      
      // 代码块
      codeBlockBg: '#2d3748',
      codeBlockText: '#e2e8f0',
      codeBlockHeaderBg: '#f6f8fa'
    }
  }
}

const ThemeSettings = ({ disabled = false }) => {
  const [form] = Form.useForm()
  const { updateSystemSettings, getSystemSettings, systemSettings } = useAdminStore()
  const { updateSystemConfig } = useSystemConfigStore()
  const [loading, setLoading] = useState(false)
  const [currentTheme, setCurrentTheme] = useState('default')
  const [customColors, setCustomColors] = useState({})
  const [previewMode, setPreviewMode] = useState(true) // 默认开启预览

  // 加载当前主题配置
  useEffect(() => {
    loadCurrentTheme()
  }, [])

  useEffect(() => {
    if (systemSettings?.theme) {
      loadCurrentTheme()
    }
  }, [systemSettings])

  const loadCurrentTheme = () => {
    if (systemSettings?.theme) {
      const { preset, custom, colors } = systemSettings.theme
      setCurrentTheme(preset || 'default')
      
      if (preset === 'custom' && custom) {
        setCustomColors(custom)
        form.setFieldsValue({ colors: custom })
      } else if (colors) {
        // 如果有保存的颜色配置，使用它
        form.setFieldsValue({ colors })
      } else {
        // 否则使用预设主题的颜色
        const presetColors = PRESET_THEMES.default.colors
        form.setFieldsValue({ colors: presetColors })
      }
      
      // 应用主题
      if (colors) {
        applyTheme(colors)
      } else {
        applyTheme(PRESET_THEMES.default.colors)
      }
    } else {
      // 默认主题
      form.setFieldsValue({ colors: PRESET_THEMES.default.colors })
      applyTheme(PRESET_THEMES.default.colors)
    }
  }

  // 切换预设主题
  const handleThemeChange = (themeName) => {
    setCurrentTheme(themeName)
    if (themeName !== 'custom') {
      const theme = PRESET_THEMES[themeName]
      form.setFieldsValue({ colors: theme.colors })
      // 实时预览
      if (previewMode) {
        applyTheme(theme.colors)
      }
    } else {
      // 切换到自定义模式，使用之前的自定义颜色或默认颜色
      const colorsToUse = Object.keys(customColors).length > 0 ? customColors : PRESET_THEMES.default.colors
      form.setFieldsValue({ colors: colorsToUse })
      if (previewMode) {
        applyTheme(colorsToUse)
      }
    }
  }

  // 应用主题到页面
  const applyTheme = (colors) => {
    const root = document.documentElement
    Object.entries(colors).forEach(([key, value]) => {
      // 将驼峰命名转换为 kebab-case
      const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
      root.style.setProperty(cssVarName, value)
    })
  }

  // 保存主题配置
  const handleSave = async () => {
    if (disabled) return

    try {
      const values = await form.validateFields()
      setLoading(true)

      // 如果是自定义主题，保存当前颜色配置
      if (currentTheme === 'custom') {
        setCustomColors(values.colors)
      }

      const themeConfig = {
        preset: currentTheme,
        custom: currentTheme === 'custom' ? values.colors : undefined,
        colors: values.colors
      }

      // 更新系统设置
      const updatedSettings = {
        ...systemSettings,
        theme: themeConfig
      }

      // 保存到后端
      await updateSystemSettings(updatedSettings)
      
      // 更新前端store
      const result = await updateSystemConfig(updatedSettings)
      
      if (result.success) {
        message.success('主题配置保存成功')
        // 应用主题
        applyTheme(values.colors)
      } else {
        message.error(result.error || '保存失败')
      }
    } catch (error) {
      console.error('保存主题失败:', error)
      message.error('保存失败')
    } finally {
      setLoading(false)
    }
  }

  // 重置为默认值
  const handleReset = () => {
    setCurrentTheme('default')
    form.setFieldsValue({ colors: PRESET_THEMES.default.colors })
    if (previewMode) {
      applyTheme(PRESET_THEMES.default.colors)
    }
  }

  // 颜色输入组件 - 修复：传递字段名作为参数
  const ColorInput = ({ value, onChange, disabled, fieldName }) => (
    <Space>
      <ColorPicker
        value={value}
        onChange={(color, hex) => {
          onChange(hex)
          // 如果开启预览，实时更新
          if (previewMode && fieldName) {
            const allColors = form.getFieldsValue().colors || {}
            const updatedColors = { ...allColors }
            
            // 解析字段路径并设置值
            const keys = fieldName.split('.')
            if (keys.length === 2 && keys[0] === 'colors') {
              updatedColors[keys[1]] = hex
              applyTheme(updatedColors)
            }
          }
        }}
        showText
        disabled={disabled}
      />
    </Space>
  )

  return (
    <div>
      {disabled && (
        <Alert
          message="只读模式"
          description="只有超级管理员可以修改主题设置"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 预设主题选择 */}
      <Card title="选择主题" style={{ marginBottom: 16 }}>
        <Form.Item label="主题模式">
          <Select
            value={currentTheme}
            onChange={handleThemeChange}
            style={{ width: '100%' }}
            disabled={disabled}
          >
            <Select.Option value="default">
              <Space>
                <span>默认主题</span>
                <Text type="secondary">- 系统默认配色方案</Text>
              </Space>
            </Select.Option>
            <Select.Option value="custom">
              <Space>
                <span>自定义主题</span>
                <Text type="secondary">- 自由配置所有颜色</Text>
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item label="实时预览">
          <Space>
            <Switch
              checked={previewMode}
              onChange={(checked) => {
                setPreviewMode(checked)
                if (checked) {
                  applyTheme(form.getFieldValue('colors'))
                } else {
                  // 恢复原始主题
                  loadCurrentTheme()
                }
              }}
              disabled={disabled}
            />
            <Text type="secondary">开启后可实时查看主题效果</Text>
          </Space>
        </Form.Item>
      </Card>

      {/* 颜色配置 */}
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          {/* 基础颜色 */}
          <Col span={12}>
            <Card title="基础颜色" size="small" style={{ marginBottom: 16 }}>
              <Form.Item name={['colors', 'primaryColor']} label="主题色">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.primaryColor"
                />
              </Form.Item>
              <Form.Item name={['colors', 'successColor']} label="成功色">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.successColor"
                />
              </Form.Item>
              <Form.Item name={['colors', 'warningColor']} label="警告色">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.warningColor"
                />
              </Form.Item>
              <Form.Item name={['colors', 'errorColor']} label="错误色">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.errorColor"
                />
              </Form.Item>
            </Card>

            {/* 背景颜色 */}
            <Card title="背景颜色" size="small" style={{ marginBottom: 16 }}>
              <Form.Item name={['colors', 'bodyBg']} label="页面背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.bodyBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'componentBg']} label="组件背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.componentBg"
                />
              </Form.Item>
            </Card>

            {/* 顶部导航栏 */}
            <Card title="顶部导航栏" size="small" style={{ marginBottom: 16 }}>
              <Form.Item name={['colors', 'navHeaderBg']} label="导航栏背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.navHeaderBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'navHeaderText']} label="导航栏文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.navHeaderText"
                />
              </Form.Item>
              <Form.Item name={['colors', 'navLogoBg']} label="Logo背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.navLogoBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'navLogoText']} label="Logo文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.navLogoText"
                />
              </Form.Item>
            </Card>
          </Col>

          {/* 聊天界面和侧边栏 */}
          <Col span={12}>
            {/* 侧边栏 */}
            <Card title="侧边栏菜单" size="small" style={{ marginBottom: 16 }}>
              <Form.Item name={['colors', 'sidebarMenuBg']} label="菜单背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.sidebarMenuBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'sidebarMenuText']} label="菜单文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.sidebarMenuText"
                />
              </Form.Item>
              <Form.Item name={['colors', 'sidebarMenuActiveBg']} label="选中项背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.sidebarMenuActiveBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'sidebarMenuActiveText']} label="选中项文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.sidebarMenuActiveText"
                />
              </Form.Item>
              <Form.Item name={['colors', 'sidebarMenuHoverBg']} label="悬停背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.sidebarMenuHoverBg"
                />
              </Form.Item>
            </Card>

            {/* 聊天界面 */}
            <Card title="聊天界面" size="small" style={{ marginBottom: 16 }}>
              <Form.Item name={['colors', 'chatBg']} label="聊天区域背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.chatBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'userMessageBg']} label="用户消息背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.userMessageBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'userMessageText']} label="用户消息文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.userMessageText"
                />
              </Form.Item>
              <Form.Item name={['colors', 'aiMessageBg']} label="AI消息背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.aiMessageBg"
                />
              </Form.Item>
              <Form.Item name={['colors', 'aiMessageText']} label="AI消息文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.aiMessageText"
                />
              </Form.Item>
              <Form.Item name={['colors', 'inputBg']} label="输入框背景">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.inputBg"
                />
              </Form.Item>
            </Card>

            {/* 文字和其他 */}
            <Card title="文字颜色" size="small">
              <Form.Item name={['colors', 'textColor']} label="主要文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.textColor"
                />
              </Form.Item>
              <Form.Item name={['colors', 'textColorSecondary']} label="次要文字">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.textColorSecondary"
                />
              </Form.Item>
              <Form.Item name={['colors', 'borderColor']} label="边框颜色">
                <ColorInput 
                  disabled={disabled || currentTheme !== 'custom'} 
                  fieldName="colors.borderColor"
                />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        {/* 操作按钮 */}
        {!disabled && (
          <Card style={{ marginTop: 16 }}>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={loading}
              >
                保存主题
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleReset}
              >
                重置默认
              </Button>
              <Tooltip title="保存后主题将应用到所有用户">
                <Tag icon={<CheckCircleOutlined />} color="processing">
                  主题设置对所有用户生效
                </Tag>
              </Tooltip>
            </Space>
          </Card>
        )}
      </Form>
    </div>
  )
}

export default ThemeSettings
