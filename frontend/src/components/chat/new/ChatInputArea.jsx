/**
 * 聊天输入区域组件 - 支持图片和文档上传
 */

import React, { useRef, forwardRef, useImperativeHandle } from 'react'
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
  FileTextOutlined,
  CloseOutlined,
  DownloadOutlined,
  ClearOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ModelSelector from './ModelSelector'

const { TextArea } = Input
const { Text } = Typography

// 使用forwardRef使组件可以接收ref
const ChatInputArea = forwardRef(({
  inputValue,
  uploadedImage,
  uploadedDocument,
  uploading,
  typing,
  isStreaming,
  imageUploadEnabled,
  documentUploadEnabled,
  hasMessages,
  currentModel,
  availableModels,
  onInputChange,
  onSend,
  onStop,
  onImageUpload,
  onDocumentUpload,
  onRemoveImage,
  onRemoveDocument,
  onKeyPress,
  onExportChat,
  onClearChat,
  onModelChange
}, ref) => {
  const { t } = useTranslation()
  const inputRef = useRef(null)

  // 暴露focus方法给父组件
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

  // 判断是否有已上传的文件（图片或文档）
  const hasUploadedFile = uploadedImage || uploadedDocument

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
                onClick={onRemoveImage}
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
      
      {/* 已上传的文档预览 */}
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
          />
          
          {/* 图片上传按钮 */}
          {imageUploadEnabled && !hasUploadedFile && (
            <Upload
              beforeUpload={onImageUpload}
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
          
          {/* 文档上传按钮 */}
          {documentUploadEnabled && !hasUploadedFile && (
            <Upload
              beforeUpload={onDocumentUpload}
              showUploadList={false}
              accept=".pdf,.doc,.docx,.txt,.csv,.html,.htm,.md,.markdown,.xls,.xlsx,.ppt,.pptx,.rtf"
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={t('chat.upload.document')}>
                <Button
                  type="text"
                  icon={<FileTextOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                />
              </Tooltip>
            </Upload>
          )}
        </div>
        
        <div className="right-tools">
          {/* 导出和清空按钮并排 */}
          <Space size={4}>
            <Tooltip title={t('chat.export')}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={onExportChat}
                disabled={!hasMessages || typing || isStreaming}
              />
            </Tooltip>
            
            <Tooltip title={t('chat.clear')}>
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={onClearChat}
                disabled={!hasMessages || typing || isStreaming}
              />
            </Tooltip>
          </Space>
        </div>
      </div>
      
      <div className="input-wrapper">
        <TextArea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={
            uploadedImage 
              ? t('chat.input.placeholderWithImage')
              : uploadedDocument
              ? t('chat.input.placeholderWithDocument')
              : t('chat.input.placeholder')
          }
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={typing || isStreaming}
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
                onClick={onStop}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('chat.send')}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={onSend}
                disabled={(!inputValue.trim() && !hasUploadedFile) || typing}
                loading={typing}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
})

// 设置displayName以便调试
ChatInputArea.displayName = 'ChatInputArea'

export default ChatInputArea
