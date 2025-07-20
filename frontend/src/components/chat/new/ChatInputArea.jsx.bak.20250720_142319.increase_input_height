/**
 * 聊天输入区域组件
 */

import React, { useRef } from 'react'
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
  CloseOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Text } = Typography

const ChatInputArea = ({
  inputValue,
  uploadedImage,
  uploading,
  typing,
  isStreaming,
  modelCredits,
  remainingCredits,
  imageUploadEnabled,
  onInputChange,
  onSend,
  onStop,
  onUploadImage,
  onRemoveImage,
  onKeyPress
}) => {
  const { t } = useTranslation()
  const inputRef = useRef(null)

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
      
      <div className="input-wrapper">
        <div className="input-actions-left">
          {/* 图片上传按钮 */}
          {imageUploadEnabled && (
            <Upload
              beforeUpload={onUploadImage}
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
        
        <TextArea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={
            uploadedImage 
              ? t('chat.input.placeholderWithImage')
              : t('chat.input.placeholder')
          }
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={typing || isStreaming}
          className="message-input"
        />
        
        <div className="input-actions-right">
          {isStreaming ? (
            <Button
              type="primary"
              danger
              icon={<StopOutlined />}
              onClick={onStop}
            >
              {t('chat.stop')}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={onSend}
              disabled={(!inputValue.trim() && !uploadedImage) || typing}
              loading={typing}
            >
              {t('chat.send')}
            </Button>
          )}
        </div>
      </div>
      
      {/* 积分提示 */}
      <div className="input-tips">
        <Text type="secondary" size="small">
          {t('chat.credits.cost', { 
            cost: modelCredits,
            remaining: remainingCredits || 0
          })}
        </Text>
      </div>
    </div>
  )
}

export default ChatInputArea
