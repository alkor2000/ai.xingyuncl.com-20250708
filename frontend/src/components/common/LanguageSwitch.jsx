/**
 * 语言切换组件
 * 
 * 功能说明：
 * 1. 显示当前语言
 * 2. 提供下拉菜单切换语言
 * 3. 用户主动切换的语言会保存到localStorage
 * 
 * 版本更新：
 * - v1.1.0 (2025-01-07): 使用统一的changeLanguage函数，标记用户主动选择
 */

import React from 'react'
import { Dropdown, Button, Space } from 'antd'
import { GlobalOutlined, DownOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { changeLanguage, getSupportedLanguages } from '../../utils/i18n'

const LanguageSwitch = ({ style = {} }) => {
  const { i18n } = useTranslation()
  
  // 获取支持的语言列表
  const languages = getSupportedLanguages()
  
  // 当前语言
  const currentLanguage = i18n.language || 'zh-CN'
  const currentLang = languages.find(lang => lang.code === currentLanguage) || languages[0]
  
  // 处理语言切换
  const handleLanguageChange = ({ key }) => {
    // 使用统一的语言切换函数，会标记为用户主动选择
    changeLanguage(key)
  }
  
  // 下拉菜单项
  const menuItems = languages.map(lang => ({
    key: lang.code,
    label: (
      <Space>
        <span>{lang.flag}</span>
        <span>{lang.name}</span>
      </Space>
    )
  }))

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: handleLanguageChange,
        selectedKeys: [currentLanguage]
      }}
      trigger={['click']}
    >
      <Button 
        type="text" 
        style={{ 
          display: 'flex', 
          alignItems: 'center',
          padding: '4px 8px',
          ...style 
        }}
      >
        <Space size={4}>
          <GlobalOutlined />
          <span>{currentLang.flag}</span>
          <span style={{ fontSize: '12px' }}>{currentLang.name}</span>
          <DownOutlined style={{ fontSize: '10px' }} />
        </Space>
      </Button>
    </Dropdown>
  )
}

export default LanguageSwitch
