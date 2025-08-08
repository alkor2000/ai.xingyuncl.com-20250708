/**
 * 优化的聊天输入组件 - 隔离输入状态，避免父组件重渲染
 */

import React, { useState, useRef, useCallback, memo, forwardRef, useImperativeHandle, useEffect } from 'react'
import {
  Input,
  Button,
  Upload,
  Tooltip,
  Badge,
  Space,
  Typography
} from 'antd'
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  CloseOutlined,
  DownloadOutlined,
  ClearOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import debounce from 'lodash.debounce'
import ModelSelector from './ModelSelector'

const { TextArea } = Input
const { Text } = Typography

// 使用memo和forwardRef优化
const OptimizedChatInput = memo(forwardRef(({
  uploadedImage,
  uploading,
  typing,
  isStreaming,
  imageUploadEnabled,
  hasMessages,
  currentModel,
  availableModels,
  onSend,
  onStop,
  onImageUpload,
  onRemoveImage,
  onExportChat,
  onClearChat,
  onModelChange,
  onDraftChange,
  initialValue = '',
  disabled = false
}, ref) => {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  
  // 本地管理输入状态，避免影响父组件
  const [localInputValue, setLocalInputValue] = useState(initialValue)
  
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
    },
    clear: () => {
      setLocalInputValue('')
    },
    getValue: () => localInputValue,
    setValue: (value) => {
      setLocalInputValue(value)
    }
  }))
  
  // 初始值变化时更新（用于恢复草稿）
  useEffect(() => {
    if (initialValue && !localInputValue) {
      setLocalInputValue(initialValue)
    }
  }, [initialValue])
  
  // 创建防抖的草稿保存函数
  const debouncedDraftSave = useCallback(
    debounce((value) => {
      if (onDraftChange) {
        onDraftChange(value)
      }
    }, 1000),
    [onDraftChange]
  )
  
  // 输入处理 - 本地状态更新，防抖保存草稿
  const handleInputChange = useCallback((e) => {
    const value = e.target.value
    setLocalInputValue(value)
    
    // 防抖保存草稿
    debouncedDraftSave(value)
  }, [debouncedDraftSave])
  
  // 发送消息
  const handleSend = useCallback(() => {
    if (!localInputValue.trim() && !uploadedImage) return
    
    // 调用父组件的发送方法，传递当前值
    onSend(localInputValue.trim())
    
    // 立即清空本地输入
    setLocalInputValue('')
    
    // 取消未完成的草稿保存
    debouncedDraftSave.cancel()
  }, [localInputValue, uploadedImage, onSend, debouncedDraftSave])
  
  // 键盘事件处理
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])
  
  // 停止生成
  const handleStop = useCallback(() => {
    onStop()
  }, [onStop])
  
  // 导出聊天
  const handleExport = useCallback(() => {
    onExportChat()
  }, [onExportChat])
  
  // 清空聊天
  const handleClear = useCallback(() => {
    onClearChat()
  }, [onClearChat])
  
  // 模型切换
  const handleModelChange = useCallback((model) => {
    onModelChange(model)
  }, [onModelChange])
  
  // 图片上传
  const handleImageUpload = useCallback((file) => {
    onImageUpload(file)
    return false // 阻止默认上传
  }, [onImageUpload])
  
  // 移除图片
  const handleRemoveImage = useCallback(() => {
    onRemoveImage()
  }, [onRemoveImage])
  
  return (
    <div className="input-container">
      {/* 已上传的图片预览 */}
      {uploadedImage && (
        <div className="uploaded-image-preview">
          <Badge
            count={
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={handleRemoveImage}
                className="remove-image-btn"
              />
            }
          >
            <img 
              src={uploadedImage.url} 
              alt={uploadedImage.original_name}
              className="preview-image"
            />
          </Badge>
          <Text size="small" type="secondary">
            {uploadedImage.original_name}
          </Text>
        </div>
      )}
      
      {/* 模型选择器和工具栏 */}
      <div className="input-header">
        <div className="left-tools">
          <ModelSelector
            currentModel={currentModel}
            availableModels={availableModels}
            onModelChange={handleModelChange}
            disabled={typing || isStreaming}
          />
          
          {/* 图片上传按钮 */}
          {imageUploadEnabled && (
            <Upload
              beforeUpload={handleImageUpload}
              showUploadList={false}
              accept="image/*"
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={t('chat.upload.image')}>
                <Button
                  type="text"
                  icon={<PictureOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                />
              </Tooltip>
            </Upload>
          )}
        </div>
        
        <div className="right-tools">
          <Space size={4}>
            <Tooltip title={t('chat.export')}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={handleExport}
                disabled={!hasMessages || typing || isStreaming}
              />
            </Tooltip>
            
            <Tooltip title={t('chat.clear')}>
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={handleClear}
                disabled={!hasMessages || typing || isStreaming}
              />
            </Tooltip>
          </Space>
        </div>
      </div>
      
      <div className="input-wrapper">
        <TextArea
          ref={inputRef}
          value={localInputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            uploadedImage 
              ? t('chat.input.placeholderWithImage')
              : t('chat.input.placeholder')
          }
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={disabled || typing || isStreaming}
          className="message-input"
        />
        
        <div className="input-actions-right">
          {/* 发送/停止按钮 */}
          {isStreaming ? (
            <Tooltip title={t('chat.stop')}>
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('chat.send')}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={(!localInputValue.trim() && !uploadedImage) || typing}
                loading={typing}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}), (prevProps, nextProps) => {
  // 自定义比较函数，只在关键属性变化时重渲染
  return (
    prevProps.typing === nextProps.typing &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.uploading === nextProps.uploading &&
    prevProps.uploadedImage?.id === nextProps.uploadedImage?.id &&
    prevProps.currentModel?.name === nextProps.currentModel?.name &&
    prevProps.availableModels?.length === nextProps.availableModels?.length &&
    prevProps.hasMessages === nextProps.hasMessages &&
    prevProps.imageUploadEnabled === nextProps.imageUploadEnabled &&
    prevProps.disabled === nextProps.disabled
  )
})

OptimizedChatInput.displayName = 'OptimizedChatInput'

export default OptimizedChatInput
