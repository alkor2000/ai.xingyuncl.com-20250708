import React from 'react'
import { Select, Space } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const LanguageSwitch = () => {
  const { i18n } = useTranslation()
  
  const languages = [
    { value: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
    { value: 'en-US', label: 'English', flag: '🇺🇸' }
  ]
  
  const handleChange = (value) => {
    i18n.changeLanguage(value)
  }
  
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
