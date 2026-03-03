/**
 * 消息内容渲染组件
 * 负责渲染用户消息和AI消息的内容，包括文本、图片、代码块等
 * 
 * v2.0 变更：
 *   - 支持显示多张用户附件图片（message.files 数组）
 *   - 向后兼容 message.file 单文件字段
 */

import React, { useState } from 'react'
import { Typography, Image, Spin, Button, Space, message as antMessage, Row, Col } from 'antd'
import { LoadingOutlined, CopyOutlined, DeleteOutlined, RobotOutlined, ClockCircleOutlined, ThunderboltOutlined, PictureOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from './CodeBlock'
import useSystemConfigStore from '../../stores/systemConfigStore'
import './MessageContent.less'

const { Text } = Typography

const MessageContent = ({ message, isStreaming = false, currentModel, onDeleteMessage, aiModels = [] }) => {
  const [imageLoading, setImageLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  // 获取系统配置中的字体设置
  const { systemConfig } = useSystemConfigStore()
  const chatFontFamily = systemConfig?.chat?.font_family || 'system-ui'
  const chatFontSize = systemConfig?.chat?.font_size || 14

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  // v2.0: 获取消息的附件文件列表（兼容 files 数组和 file 单对象）
  const getAttachedFiles = () => {
    // 优先使用 files 数组
    if (message.files && Array.isArray(message.files) && message.files.length > 0) {
      return message.files
    }
    // 向后兼容：单个 file 对象
    if (message.file) {
      return [message.file]
    }
    return []
  }

  const attachedFiles = getAttachedFiles()
  // 分类：图片文件和文档文件
  const imageFiles = attachedFiles.filter(f => f.mime_type && f.mime_type.startsWith('image/'))
  const docFiles = attachedFiles.filter(f => f.mime_type && !f.mime_type.startsWith('image/'))

  // 处理生成的图片数据（AI消息）
  const getGeneratedImages = () => {
    if (!message.generated_images) return []
    if (typeof message.generated_images === 'string') {
      try { return JSON.parse(message.generated_images) } catch (e) { return [] }
    }
    if (Array.isArray(message.generated_images)) return message.generated_images
    return []
  }

  const generatedImages = getGeneratedImages()

  // 获取消息实际使用的模型信息
  const getMessageModel = () => {
    if (message.model_name) {
      const model = aiModels.find(m => m.name === message.model_name)
      if (model) return model
      return { name: message.model_name, display_name: message.model_name }
    }
    if (message.temp || message.streaming) return currentModel
    return null
  }

  const messageModel = getMessageModel()

  // 消息文本样式
  const messageTextStyle = {
    fontFamily: chatFontFamily,
    fontSize: `${chatFontSize}px`,
    lineHeight: chatFontSize > 16 ? '1.6' : '1.5'
  }

  // 用户消息样式
  const userMessageStyle = {
    ...messageTextStyle,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }

  // 渲染用户消息文本
  const renderUserMessage = (content) => {
    if (!content) return null
    const lines = content.split('\n')
    return lines.map((line, index) => (
      <React.Fragment key={index}>
        {line}
        {index < lines.length - 1 && <br />}
      </React.Fragment>
    ))
  }

  // 复制消息内容
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      antMessage.success('内容已复制到剪贴板')
    } catch (error) {
      antMessage.error('复制失败，请手动选择复制')
    }
  }

  // 删除消息对
  const handleDelete = async () => {
    if (!onDeleteMessage || !isAssistant) return
    setDeleting(true)
    try {
      await onDeleteMessage(message.id)
      antMessage.success('消息已删除')
    } catch (error) {
      antMessage.error('删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // 格式化时间
  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  // Markdown 渲染配置
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')

      if (!inline && match) {
        return (
          <CodeBlock className={className}>
            {String(children).replace(/\n$/, '')}
          </CodeBlock>
        )
      }

      if (!inline) {
        return (
          <pre style={{
            backgroundColor: '#2d3748', color: '#d4d4d4',
            padding: '16px', borderRadius: '6px',
            overflow: 'visible', whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', overflowWrap: 'break-word',
            maxWidth: '100%', marginTop: '8px', marginBottom: '8px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '13px', lineHeight: '1.45', minHeight: '20px'
          }}>
            <code>{String(children).replace(/\n$/, '')}</code>
          </pre>
        )
      }

      return (
        <code className={className} style={{
          backgroundColor: 'rgba(0, 0, 0, 0.06)',
          padding: '2px 4px', borderRadius: '3px', fontSize: '14px',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace'
        }} {...props}>
          {children}
        </code>
      )
    },
    p: ({ children }) => <p style={messageTextStyle}>{children}</p>,
    li: ({ children }) => <li style={messageTextStyle}>{children}</li>,
    h1: ({ children }) => <h1 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.7}px` }}>{children}</h1>,
    h2: ({ children }) => <h2 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.5}px` }}>{children}</h2>,
    h3: ({ children }) => <h3 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.3}px` }}>{children}</h3>,
    h4: ({ children }) => <h4 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.1}px` }}>{children}</h4>,
    h5: ({ children }) => <h5 style={messageTextStyle}>{children}</h5>,
    h6: ({ children }) => <h6 style={messageTextStyle}>{children}</h6>,
    table: ({ children }) => (
      <div className="markdown-table-wrapper">
        <table className="markdown-table">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th style={messageTextStyle}>{children}</th>,
    td: ({ children }) => <td style={messageTextStyle}>{children}</td>,
  }

  return (
    <div className={`message-content ${isUser ? 'user-message' : 'assistant-message'}`}>

      {/* v2.0: 显示用户上传的图片（支持多张） */}
      {imageFiles.length > 0 && (
        <div className="message-images" style={{ marginBottom: '8px' }}>
          <Row gutter={[8, 8]}>
            {imageFiles.map((file, index) => (
              <Col key={file.id || index} xs={imageFiles.length === 1 ? 24 : 12} sm={imageFiles.length === 1 ? 16 : 8}>
                <Image
                  src={file.url}
                  alt={file.original_name}
                  width="100%"
                  style={{ borderRadius: '8px', maxWidth: imageFiles.length === 1 ? '300px' : '200px' }}
                  placeholder={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px', backgroundColor: '#f5f5f5' }}>
                      <Spin />
                    </div>
                  }
                />
                {imageFiles.length > 1 && (
                  <Text type="secondary" style={{ fontSize: '11px', display: 'block', marginTop: '2px' }}>
                    {file.original_name}
                  </Text>
                )}
              </Col>
            ))}
          </Row>
          {imageFiles.length === 1 && (
            <Text type="secondary" className="image-name" style={{ fontSize: '12px' }}>
              {imageFiles[0].original_name}
            </Text>
          )}
        </div>
      )}

      {/* 显示上传的文档（保持不变） */}
      {docFiles.length > 0 && docFiles.map((file, index) => (
        <div key={file.id || index} className="message-document" style={{ marginBottom: '8px' }}>
          <Text type="secondary">[文档: {file.original_name}]</Text>
        </div>
      ))}

      {/* 消息文本内容 */}
      <div className="message-text" style={messageTextStyle}>
        {isUser ? (
          <div style={userMessageStyle}>
            {renderUserMessage(message.content)}
          </div>
        ) : (
          <>
            {message.error ? (
              <div style={{ color: '#ff4d4f', fontSize: '13px', padding: '4px 0' }}>
                {message.content || '⚠️ AI响应异常'}
              </div>
            ) : !message.content && !message.streaming ? (
              <div style={{ color: '#999', fontSize: '13px', fontStyle: 'italic', padding: '4px 0' }}>
                ⚠️ AI返回内容为空，可能是网络问题或模型响应异常
              </div>
            ) : isStreaming && message.streaming ? (
              <div className="streaming-content">
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                  {message.content || ''}
                </ReactMarkdown>
                <span className="streaming-cursor"><LoadingOutlined /></span>
              </div>
            ) : (
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            )}
          </>
        )}
      </div>

      {/* 显示AI生成的图片 */}
      {isAssistant && generatedImages.length > 0 && (
        <div className="generated-images" style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', color: '#1890ff' }}>
            <PictureOutlined style={{ marginRight: '6px' }} />
            <Text type="secondary">生成的图片 ({generatedImages.length})</Text>
          </div>
          <Row gutter={[12, 12]}>
            {generatedImages.map((img, index) => (
              <Col key={index} xs={24} sm={12} md={8} lg={6}>
                <Image
                  src={img.url}
                  alt={`Generated image ${index + 1}`}
                  style={{ width: '100%', borderRadius: '8px', border: '1px solid #f0f0f0' }}
                  placeholder={
                    <div style={{ width: '100%', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
                      <Spin />
                    </div>
                  }
                />
                {img.filename && (
                  <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', textAlign: 'center' }}>
                    {img.filename}
                  </Text>
                )}
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* 消息底部信息 */}
      {!isStreaming && !message.streaming && (
        <div className="message-footer">
          <Space size="middle" className="message-info">
            <span className="info-item">
              <ClockCircleOutlined />
              <Text type="secondary" className="info-text">{formatTime(message.created_at)}</Text>
            </span>

            {message.tokens > 0 && (
              <span className="info-item">
                <ThunderboltOutlined />
                <Text type="secondary" className="info-text">{message.tokens} Tokens</Text>
              </span>
            )}

            {isAssistant && messageModel && (
              <span className="info-item">
                <RobotOutlined />
                <Text type="secondary" className="info-text">{messageModel.display_name || messageModel.name}</Text>
              </span>
            )}

            {isAssistant && generatedImages.length > 0 && (
              <span className="info-item">
                <PictureOutlined />
                <Text type="secondary" className="info-text">{generatedImages.length} 张图片</Text>
              </span>
            )}

            {/* v2.0: 显示附件图片数量 */}
            {imageFiles.length > 1 && (
              <span className="info-item">
                <PictureOutlined />
                <Text type="secondary" className="info-text">{imageFiles.length} 张附件</Text>
              </span>
            )}
          </Space>

          <Space size="small" className="message-actions">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} title="复制内容" />
            {isAssistant && onDeleteMessage && (
              <Button type="text" size="small" icon={<DeleteOutlined />} onClick={handleDelete} loading={deleting} title="删除对话" />
            )}
          </Space>
        </div>
      )}
    </div>
  )
}

export default MessageContent
