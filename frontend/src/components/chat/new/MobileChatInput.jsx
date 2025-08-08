/**
 * 移动端聊天输入组件
 * 优化移动端输入体验，支持动态高度调整
 */

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import {
  Input,
  Button,
  Upload,
  Space,
  Badge
} from 'antd'
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  CloseOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

const MobileChatInput = forwardRef(({
  inputValue,
  uploadedImage,
  uploading,
  typing,
  isStreaming,
  imageUploadEnabled,
  disabled,
  onInputChange,
  onSend,
  onStop,
  onImageUpload,
  onRemoveImage,
  onOpenActions
}, ref) => {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [inputHeight, setInputHeight] = useState(40)
  
  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (inputRef.current) {
        inputRef.current.focus()
      }
    },
    blur: () => {
      if (inputRef.current) {
        inputRef.current.blur()
      }
    }
  }))
  
  // 动态调整输入框高度
  useEffect(() => {
    if (inputRef.current) {
      const textarea = inputRef.current.resizableTextArea?.textArea
      if (textarea) {
        textarea.style.height = 'auto'
        const newHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120)
        setInputHeight(newHeight)
        textarea.style.height = `${newHeight}px`
      }
    }
  }, [inputValue])
  
  // 处理发送
  const handleSend = () => {
    if (inputValue.trim() || uploadedImage) {
      onSend()
    }
  }
  
  // 处理键盘事件
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  return (
    <div className="mobile-chat-input">
      {/* 已上传的图片预览 */}
      {uploadedImage && (
        <div className="mobile-image-preview">
          <Badge
            count={
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={onRemoveImage}
              />
            }
          >
            <img 
              src={uploadedImage.url} 
              alt={uploadedImage.original_name}
              className="preview-thumb"
            />
          </Badge>
        </div>
      )}
      
      <div className="mobile-input-row">
        {/* 附加功能按钮 */}
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={onOpenActions}
          className="mobile-action-btn"
          disabled={typing || isStreaming}
        />
        
        {/* 输入框 */}
        <TextArea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={t('chat.input.placeholder')}
          autoSize={false}
          style={{ height: inputHeight }}
          disabled={disabled || typing || isStreaming}
          className="mobile-text-input"
        />
        
        {/* 发送/停止按钮 */}
        {isStreaming ? (
          <Button
            type="primary"
            danger
            icon={<StopOutlined />}
            onClick={onStop}
            className="mobile-send-btn"
          />
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={(!inputValue.trim() && !uploadedImage) || typing || disabled}
            loading={typing}
            className="mobile-send-btn"
          />
        )}
      </div>
    </div>
  )
})

MobileChatInput.displayName = 'MobileChatInput'

export default MobileChatInput
