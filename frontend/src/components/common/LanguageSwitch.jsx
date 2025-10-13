/**
 * 语言切换组件 - 移动端精简版
 * PC端：显示完整文字
 * 移动端：显示简化版本 "中/EN"
 */
import React, { useState, useEffect } from 'react'
import { Select, Space } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const LanguageSwitch = () => {
  const { i18n } = useTranslation()
  const [isMobile, setIsMobile] = useState(false)
  
  // 检测移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  const languages = [
    { value: 'zh-CN', label: '简体中文', flag: '🇨🇳', short: '中' },
    { value: 'en-US', label: 'English', flag: '🇺🇸', short: 'EN' }
  ]
  
  const handleChange = (value) => {
    i18n.changeLanguage(value)
  }
  
  // 移动端：精简显示
  if (isMobile) {
    const currentLang = languages.find(lang => lang.value === i18n.language) || languages[0]
    
    return (
      <Select
        value={i18n.language}
        onChange={handleChange}
        style={{ width: 70 }}
        size="small"
        suffixIcon={null}
        className="mobile-language-switch"
      >
        {languages.map(lang => (
          <Select.Option key={lang.value} value={lang.value}>
            {lang.short}
          </Select.Option>
        ))}
      </Select>
    )
  }
  
  // PC端：完整显示
  return (
    <Select
      value={i18n.language}
      onChange={handleChange}
      style={{ width: 140 }}
      suffixIcon={<GlobalOutlined />}
    >
      {languages.map(lang => (
        <Select.Option key={lang.value} value={lang.value}>
          <Space>
            <span>{lang.flag}</span>
            <span>{lang.label}</span>
          </Space>
        </Select.Option>
      ))}
    </Select>
  )
}

export default LanguageSwitch
