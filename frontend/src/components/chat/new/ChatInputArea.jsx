/**
 * 聊天输入区域组件 - 支持多图上传和Ctrl+V粘贴（移动端优化版）
 * 
 * v2.0 变更：
 *   - 支持多图上传（最多5张，每张≤5MB）
 *   - 支持 Ctrl+V / Command+V 粘贴图片
 *   - uploadedImage(单个) -> uploadedImages(数组)
 *   - 多图缩略图预览，支持单张删除
 *   - Upload组件支持multiple多选
 * 
 * v2.1 变更：
 *   - 输入框高度增大：PC端maxRows从6增至16，移动端从4增至8
 *   - 输入框字体跟随系统设置：从systemConfigStore读取font_family和font_size
 *   - 整体视觉优化：输入区域样式改进
 * 
 * v2.2 变更：
 *   - 新增上下文Token数量显示：在工具栏显示当前对话携带的上下文Token总量
 *   - 接收 contextTokens prop，格式化为 K 单位显示
 *   - 包含系统提示词 + 万智魔方 + 历史消息 + 图片/文档估算
 */

import React, { useRef, forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import {
  Input,
  Button,
  Upload,
  Tooltip,
  Badge,
  Space,
  Typography,
  message as antMessage
} from 'antd'
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  FileTextOutlined,
  CloseOutlined,
  DownloadOutlined,
  ClearOutlined,
  DatabaseOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ModelSelector from './ModelSelector'
import useSystemConfigStore from '../../../stores/systemConfigStore'
import { formatTokenCount } from '../../../utils/tokenCalculator'

const { TextArea } = Input
const { Text } = Typography

/** 单张图片最大大小：5MB */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
/** 最大图片数量 */
const MAX_IMAGE_COUNT = 5

const ChatInputArea = forwardRef(({
  inputValue,
  uploadedImages = [],          // v2.0: 图片数组（替代原 uploadedImage 单对象）
  uploadedDocument,
  uploading,
  typing,
  isStreaming,
  imageUploadEnabled,
  documentUploadEnabled,
  hasMessages,
  currentModel,
  availableModels,
  contextTokens,                // v2.2: 上下文Token数量
  onInputChange,
  onSend,
  onStop,
  onImageUpload,               // v2.0: 接收文件数组进行上传
  onDocumentUpload,
  onRemoveImage,               // v2.0: 接收index参数，删除指定图片
  onRemoveDocument,
  onKeyPress,
  onExportChat,
  onClearChat,
  onModelChange
}, ref) => {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const inputWrapperRef = useRef(null)

  // v2.1: 从系统配置中获取字体设置
  const { getChatFontConfig } = useSystemConfigStore()
  const fontConfig = getChatFontConfig()

  // 检测是否为移动设备
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 暴露 focus/blur 方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur()
  }))

  // 是否有已上传的文件
  const hasUploadedFile = uploadedImages.length > 0 || uploadedDocument
  // 是否已达到图片上限
  const isImageLimitReached = uploadedImages.length >= MAX_IMAGE_COUNT

  // ---- Ctrl+V 粘贴图片处理 ----
  useEffect(() => {
    const wrapper = inputWrapperRef.current
    if (!wrapper) return

    const handlePaste = (e) => {
      // 如果不支持图片上传或正在输入/流式中，不处理粘贴
      if (!imageUploadEnabled || uploading || typing || isStreaming) return
      // 如果有文档已上传，不允许再贴图
      if (uploadedDocument) return

      const items = e.clipboardData?.items
      if (!items) return

      // 从剪贴板提取图片文件
      const imageFiles = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }

      if (imageFiles.length === 0) return

      // 阻止默认粘贴行为（避免图片base64插入文本框）
      e.preventDefault()

      // 检查数量限制
      const remaining = MAX_IMAGE_COUNT - uploadedImages.length
      if (remaining <= 0) {
        antMessage.warning(t('chat.image.upload.maxReached') || `最多上传 ${MAX_IMAGE_COUNT} 张图片`)
        return
      }

      // 取允许数量的图片
      const filesToUpload = imageFiles.slice(0, remaining)

      // 检查单张大小
      for (const file of filesToUpload) {
        if (file.size > MAX_IMAGE_SIZE) {
          antMessage.error(t('chat.image.upload.tooLarge') || '图片大小不能超过 5MB')
          return
        }
      }

      // 调用父组件的上传方法
      if (onImageUpload) {
        onImageUpload(filesToUpload)
      }
    }

    wrapper.addEventListener('paste', handlePaste)
    return () => wrapper.removeEventListener('paste', handlePaste)
  }, [imageUploadEnabled, uploading, typing, isStreaming, uploadedDocument, uploadedImages.length, onImageUpload, t])

  // ---- Upload beforeUpload 钩子：拦截文件选择，交给父组件处理 ----
  const handleBeforeUpload = (file, fileList) => {
    // 检查数量限制
    const remaining = MAX_IMAGE_COUNT - uploadedImages.length
    if (remaining <= 0) {
      antMessage.warning(t('chat.image.upload.maxReached') || `最多上传 ${MAX_IMAGE_COUNT} 张图片`)
      return false
    }

    // 检查单张大小
    if (file.size > MAX_IMAGE_SIZE) {
      antMessage.error(t('chat.image.upload.tooLarge') || `图片 ${file.name} 大小超过 5MB`)
      return false
    }

    // 取允许数量的文件（fileList 是本次选择的所有文件）
    const filesToUpload = fileList.slice(0, remaining)

    // 只在处理第一个文件时触发上传（避免多次调用）
    if (file === fileList[0] && onImageUpload) {
      // 再次过滤大小
      const validFiles = filesToUpload.filter(f => f.size <= MAX_IMAGE_SIZE)
      if (validFiles.length > 0) {
        onImageUpload(validFiles)
      }
    }

    // 返回false阻止antd Upload自动上传
    return false
  }

  // ---- 根据状态获取placeholder ----
  const getPlaceholder = () => {
    if (uploadedImages.length > 0) {
      return isMobile
        ? t('chat.input.placeholderWithImage.mobile')
        : t('chat.input.placeholderWithImage')
    }
    if (uploadedDocument) {
      return isMobile
        ? t('chat.input.placeholderWithDocument.mobile')
        : t('chat.input.placeholderWithDocument')
    }
    return isMobile
      ? t('chat.input.placeholder.mobile')
      : t('chat.input.placeholder')
  }

  // v2.1: 构建输入框样式 - 跟随系统字体设置
  const getInputStyle = () => {
    const style = {}

    // 移动端强制16px防止iOS缩放，PC端使用系统配置的字号
    if (isMobile) {
      style.fontSize = '16px'
    } else {
      // 使用系统配置的字号，默认14px
      const configFontSize = fontConfig?.fontSize || 14
      style.fontSize = `${configFontSize}px`
    }

    // 字体跟随系统设置
    const configFontFamily = fontConfig?.fontFamily
    if (configFontFamily && configFontFamily !== 'system-ui') {
      // 如果配置了特定字体，使用配置字体并追加兜底字体
      style.fontFamily = `${configFontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
    }
    // 如果是 system-ui 或未配置，不设置 fontFamily，使用浏览器默认

    // 行高设置
    style.lineHeight = '1.6'

    return style
  }

  // v2.2: 获取上下文Token的显示颜色（根据数量级变色）
  const getTokenColor = (tokens) => {
    if (!tokens || tokens === 0) return '#bfbfbf'     // 灰色 - 无上下文
    if (tokens < 2000) return '#8c8c8c'               // 深灰 - 较少
    if (tokens < 10000) return '#1890ff'               // 蓝色 - 正常
    if (tokens < 50000) return '#faad14'               // 橙色 - 较多
    return '#ff4d4f'                                    // 红色 - 很多
  }

  // v2.2: 构建上下文Token的Tooltip详情
  const getTokenTooltip = () => {
    if (!contextTokens || contextTokens === 0) {
      return t('chat.context.noContext') || '当前无额外上下文'
    }
    return `${t('chat.context.totalTokens') || '上下文约'} ${contextTokens.toLocaleString()} tokens`
  }

  return (
    <div className="input-container" ref={inputWrapperRef}>
      {/* v2.0: 多图预览区域 */}
      {uploadedImages.length > 0 && (
        <div className="uploaded-images-preview" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0'
        }}>
          {uploadedImages.map((img, index) => (
            <Badge
              key={img.id || index}
              count={
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => onRemoveImage && onRemoveImage(index)}
                  className="remove-image-btn"
                  style={{
                    background: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    padding: 0,
                    minWidth: 'unset'
                  }}
                />
              }
            >
              <img
                src={img.url}
                alt={img.original_name}
                style={{
                  width: '60px',
                  height: '60px',
                  objectFit: 'cover',
                  borderRadius: '6px',
                  border: '1px solid #e8e8e8'
                }}
              />
            </Badge>
          ))}
          {/* 剩余上传数量提示 */}
          <Text type="secondary" style={{ fontSize: '12px', alignSelf: 'flex-end', marginBottom: '4px' }}>
            {uploadedImages.length}/{MAX_IMAGE_COUNT}
          </Text>
        </div>
      )}

      {/* 已上传的文档预览（保持不变） */}
      {uploadedDocument && (
        <div className="uploaded-document-preview">
          <Badge
            count={
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={onRemoveDocument}
                className="remove-document-btn"
              />
            }
          >
            <div className="document-preview">
              <FileTextOutlined style={{ fontSize: 32, color: '#1890ff' }} />
              <Text size="small" type="secondary" className="document-name">
                {uploadedDocument.original_name}
              </Text>
              <Text size="small" type="secondary" className="document-size">
                {Math.round(uploadedDocument.size / 1024)} KB
              </Text>
            </div>
          </Badge>
        </div>
      )}

      {/* 模型选择器和工具栏 */}
      <div className="input-header">
        <div className="left-tools">
          <ModelSelector
            currentModel={currentModel}
            availableModels={availableModels}
            onModelChange={onModelChange}
            disabled={typing || isStreaming}
            isMobile={isMobile}
          />

          {/* v2.0: 图片上传按钮 - 支持多选，未达上限且无文档时显示 */}
          {imageUploadEnabled && !uploadedDocument && !isImageLimitReached && (
            <Upload
              beforeUpload={handleBeforeUpload}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={isMobile ? '' : (
                uploadedImages.length > 0
                  ? `${t('chat.upload.image')} (${uploadedImages.length}/${MAX_IMAGE_COUNT})`
                  : t('chat.upload.image')
              )}>
                <Button
                  type="text"
                  icon={<PictureOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                  className="mobile-action-btn"
                />
              </Tooltip>
            </Upload>
          )}

          {/* 文档上传按钮 - 无图片上传时才显示 */}
          {documentUploadEnabled && uploadedImages.length === 0 && !uploadedDocument && (
            <Upload
              beforeUpload={onDocumentUpload}
              showUploadList={false}
              accept=".pdf,.doc,.docx,.txt,.csv,.html,.htm,.md,.markdown,.xls,.xlsx,.ppt,.pptx,.rtf"
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={isMobile ? '' : t('chat.upload.document')}>
                <Button
                  type="text"
                  icon={<FileTextOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                  className="mobile-action-btn"
                />
              </Tooltip>
            </Upload>
          )}

          {/* v2.2: 上下文Token数量显示 */}
          {contextTokens > 0 && (
            <Tooltip title={getTokenTooltip()}>
              <span className="context-token-indicator" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: isMobile ? '2px 6px' : '2px 8px',
                borderRadius: '10px',
                fontSize: isMobile ? '11px' : '12px',
                color: getTokenColor(contextTokens),
                background: 'rgba(0,0,0,0.04)',
                cursor: 'default',
                whiteSpace: 'nowrap',
                lineHeight: '20px',
                userSelect: 'none'
              }}>
                <DatabaseOutlined style={{ fontSize: isMobile ? '11px' : '12px' }} />
                <span>{formatTokenCount(contextTokens)}</span>
              </span>
            </Tooltip>
          )}
        </div>

        <div className="right-tools">
          <Space size={4}>
            <Tooltip title={isMobile ? '' : t('chat.export')}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={onExportChat}
                disabled={!hasMessages || typing || isStreaming}
                className="mobile-action-btn"
              />
            </Tooltip>
            <Tooltip title={isMobile ? '' : t('chat.clear')}>
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={onClearChat}
                disabled={!hasMessages || typing || isStreaming}
                className="mobile-action-btn"
              />
            </Tooltip>
          </Space>
        </div>
      </div>

      {/* v2.1: 输入框 - 增大maxRows + 字体跟随系统设置 */}
      <div className="input-wrapper">
        <TextArea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={getPlaceholder()}
          autoSize={{ minRows: isMobile ? 2 : 3, maxRows: isMobile ? 8 : 16 }}
          disabled={typing || isStreaming}
          className="message-input"
          style={getInputStyle()}
        />

        <div className="input-actions-right">
          {isStreaming ? (
            <Tooltip title={isMobile ? '' : t('chat.stop')}>
              <Button type="primary" danger icon={<StopOutlined />} onClick={onStop} className="mobile-send-btn" />
            </Tooltip>
          ) : (
            <Tooltip title={isMobile ? '' : t('chat.send')}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={onSend}
                disabled={(!inputValue.trim() && !hasUploadedFile) || typing}
                loading={typing}
                className="mobile-send-btn"
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
})

ChatInputArea.displayName = 'ChatInputArea'

export default ChatInputArea
