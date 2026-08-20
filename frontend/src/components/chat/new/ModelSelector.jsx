/**
 * 模型选择器组件（移动端显示完整别名）
 * 用于在对话中快速切换AI模型
 *
 * v1.1 国际化改造 + Antd v5 API 修正：
 * 【国际化】接入 useTranslation，将未选择模型时的占位文案
 *   "选择模型" 改为 chat.model.select 翻译键。
 * 【API 修正】Popover 的 visible / onVisibleChange 是 Antd v4 的写法，
 *   在 v5 中已废弃并会在控制台产生 deprecated 警告，
 *   本项目使用 Antd 5，故改为 open / onOpenChange。
 */

import React, { useState, useRef, useEffect } from 'react'
import { Popover, Button, List, Typography } from 'antd'
import {
  ThunderboltOutlined,
  FileImageOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import './ModelSelector.less'

const { Text } = Typography

const ModelSelector = ({
  currentModel,
  availableModels = [],
  onModelChange,
  disabled = false,
  isMobile = false
}) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const popoverRef = useRef(null)

  /* 点击弹层外部区域时关闭下拉 */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setVisible(false)
      }
    }

    if (visible) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible])

  /**
   * 处理模型选择
   * 选中的仍是当前模型时不触发变更回调，避免无意义的状态更新
   */
  const handleModelSelect = (model) => {
    if (model.name !== currentModel?.name) {
      onModelChange(model)
    }
    setVisible(false)
  }

  /* 模型列表弹层内容 */
  const modelListContent = (
    <div className="model-selector-list" ref={popoverRef}>
      <List
        dataSource={availableModels}
        renderItem={(model) => {
          const isSelected = model.name === currentModel?.name
          return (
            <List.Item
              className={`model-item ${isSelected ? 'selected' : ''}`}
              onClick={() => handleModelSelect(model)}
            >
              <div className="model-info">
                <div className="model-name-row">
                  {/* 模型名称由管理员在后台配置，属业务数据，不做翻译 */}
                  <Text strong={isSelected}>
                    {model.display_name || model.name}
                  </Text>
                  {isSelected && <CheckOutlined className="selected-icon" />}
                </div>
                <div className="model-features">
                  <span className="credits-info">
                    <ThunderboltOutlined className="credits-icon" />
                    <span className="credits-number">{model.credits_per_chat}</span>
                  </span>
                  {model.image_upload_enabled && (
                    <FileImageOutlined className="image-icon" />
                  )}
                </div>
              </div>
            </List.Item>
          )
        }}
      />
    </div>
  )

  return (
    <Popover
      content={modelListContent}
      trigger="click"
      open={visible}
      onOpenChange={setVisible}
      placement={isMobile ? 'top' : 'topLeft'}
      getPopupContainer={isMobile ? undefined : (trigger) => trigger.parentElement}
      overlayClassName={`model-selector-popover ${isMobile ? 'mobile' : ''}`}
      autoAdjustOverflow={true}
      align={isMobile ? { offset: [0, -8] } : undefined}
    >
      <Button
        className={`model-selector-button ${isMobile ? 'mobile' : ''}`}
        disabled={disabled}
      >
        <span className="model-name">
          {currentModel?.display_name || currentModel?.name || t('chat.model.select')}
        </span>
        <span className="credits-display">
          <ThunderboltOutlined className="credits-icon" />
          <span className="credits-number">{currentModel?.credits_per_chat || 0}</span>
        </span>
      </Button>
    </Popover>
  )
}

export default ModelSelector
