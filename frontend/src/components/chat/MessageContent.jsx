/**
 * 消息内容渲染组件
 * 负责渲染用户消息和AI消息的内容，包括文本、图片、代码块等
 *
 * v2.0 变更：
 *   - 支持显示多张用户附件图片（message.files 数组）
 *   - 向后兼容 message.file 单文件字段
 *
 * v3.0 变更：
 *   - 新增 thinking 内容过滤/显示功能
 *   - Claude推理模型会输出 <thinking>...</thinking> 标签包裹的思考过程
 *   - 默认过滤隐藏，用户可在工具栏开关显示
 *   - 开启时以灰色折叠区域展示思考过程
 *   - 流式输出和已完成消息都支持过滤
 *
 * v4.0 国际化改造 + 一处日期格式修复：
 * 【国际化】原组件完全未接入 i18n，15 处文案为硬编码中文
 *   （文档前缀、生成图片标题、图片/附件计数、AI异常与空内容提示、
 *     Tokens单位、思考过程折叠标题与提示、复制/删除的 Tooltip 与 toast），
 *   现全部改为 chat.message.* / chat.thinking.* 翻译键。
 * 【日期修复】formatTime 原先写死 toLocaleTimeString('zh-CN') 与
 *   toLocaleString('zh-CN')，英文环境下时间仍按中文习惯格式化
 *   （如"03/16 14:30"而非"03/16, 02:30 PM"）。
 *   现改为根据 i18n.language 动态传入 locale。
 *
 * v4.1 收尾清理：
 *   仅剩的1处console.error开发者日志改为英文（不进语言包，属内部诊断信息）。
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Typography, Image, Spin, Button, Space, message as antMessage, Row, Col, Collapse } from 'antd'
import {
  LoadingOutlined, CopyOutlined, DeleteOutlined, RobotOutlined,
  ClockCircleOutlined, ThunderboltOutlined, PictureOutlined,
  BulbOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import CodeBlock from './CodeBlock'
import useSystemConfigStore from '../../stores/systemConfigStore'
import './MessageContent.less'

const { Text } = Typography

/** 思考过程折叠区的最大高度（像素），超出后内部滚动 */
const THINKING_BLOCK_MAX_HEIGHT = 300

/**
 * 过滤/提取 thinking 内容
 * 支持 <thinking>...</thinking> 和 <think>...</think> 两种标签格式
 *
 * @param {string} content - 原始消息内容
 * @returns {{ cleanContent: string, thinkingBlocks: string[] }}
 *   cleanContent: 过滤掉 thinking 后的正文内容
 *   thinkingBlocks: 提取出的 thinking 内容数组
 */
const extractThinkingContent = (content) => {
  if (!content) return { cleanContent: '', thinkingBlocks: [] }

  const thinkingBlocks = []

  /**
   * 匹配 <thinking>...</thinking> 和 <think>...</think>
   * 使用非贪婪匹配 [\s\S]*? 以支持多行内容，
   * 反向引用 \1 确保开闭标签一致（避免 <thinking> 被 </think> 闭合）
   */
  const thinkingRegex = /<(thinking|think)>([\s\S]*?)<\/\1>\n*/gi

  /* 提取所有 thinking 块的内容 */
  let match
  while ((match = thinkingRegex.exec(content)) !== null) {
    const thinkContent = match[2].trim()
    if (thinkContent) {
      thinkingBlocks.push(thinkContent)
    }
  }

  /* 从原文中移除 thinking 标签及其内容，得到纯正文 */
  const cleanContent = content.replace(thinkingRegex, '').trim()

  return { cleanContent, thinkingBlocks }
}

const MessageContent = ({
  message,
  isStreaming = false,
  currentModel,
  onDeleteMessage,
  aiModels = [],
  showThinking = false
}) => {
  const { t, i18n } = useTranslation()
  const [imageLoading, setImageLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  /* 获取系统配置中的对话字体设置 */
  const { systemConfig } = useSystemConfigStore()
  const chatFontFamily = systemConfig?.chat?.font_family || 'system-ui'
  const chatFontSize = systemConfig?.chat?.font_size || 14

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  /* 处理 thinking 内容 - 使用 useMemo 避免重复正则计算 */
  const { cleanContent, thinkingBlocks } = useMemo(() => {
    if (!isAssistant || !message.content) {
      return { cleanContent: message.content || '', thinkingBlocks: [] }
    }
    return extractThinkingContent(message.content)
  }, [message.content, isAssistant])

  /* 实际用于渲染的正文内容（AI 消息使用过滤掉 thinking 后的内容） */
  const displayContent = isAssistant ? cleanContent : message.content

  /**
   * 获取消息的附件文件列表
   * 兼容 files 数组（多文件）与 file 单对象（旧数据）两种结构
   */
  const getAttachedFiles = () => {
    if (message.files && Array.isArray(message.files) && message.files.length > 0) {
      return message.files
    }
    if (message.file) {
      return [message.file]
    }
    return []
  }

  const attachedFiles = getAttachedFiles()
  const imageFiles = attachedFiles.filter(f => f.mime_type && f.mime_type.startsWith('image/'))
  const docFiles = attachedFiles.filter(f => f.mime_type && !f.mime_type.startsWith('image/'))

  /**
   * 处理 AI 生成的图片数据
   * MySQL JSON 字段可能返回字符串或已解析的数组，需兼容两种情况
   */
  const getGeneratedImages = () => {
    if (!message.generated_images) return []
    if (typeof message.generated_images === 'string') {
      try {
        return JSON.parse(message.generated_images)
      } catch (e) {
        console.error('[MessageContent] Failed to parse generated images data:', e)
        return []
      }
    }
    if (Array.isArray(message.generated_images)) return message.generated_images
    return []
  }

  const generatedImages = getGeneratedImages()

  /**
   * 获取消息实际使用的模型信息
   * 三级回退：消息记录的模型 -> 模型列表匹配 -> 当前会话模型
   */
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

  /* 消息文本基础样式（跟随系统配置的字体与字号） */
  const messageTextStyle = {
    fontFamily: chatFontFamily,
    fontSize: `${chatFontSize}px`,
    lineHeight: chatFontSize > 16 ? '1.6' : '1.5'
  }

  /* 用户消息样式：保留换行与空格 */
  const userMessageStyle = {
    ...messageTextStyle,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }

  /** 渲染用户消息文本（按换行拆分为 br） */
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

  /** 复制消息内容（AI 消息复制过滤掉 thinking 后的干净正文） */
  const handleCopy = async () => {
    try {
      const contentToCopy = isAssistant ? cleanContent : message.content
      await navigator.clipboard.writeText(contentToCopy)
      antMessage.success(t('chat.message.copied'))
    } catch (error) {
      antMessage.error(t('chat.message.copyFailedManual'))
    }
  }

  /** 删除消息对（用户提问 + AI 回复） */
  const handleDelete = async () => {
    if (!onDeleteMessage || !isAssistant) return
    setDeleting(true)
    try {
      await onDeleteMessage(message.id)
      antMessage.success(t('chat.message.deleted'))
    } catch (error) {
      antMessage.error(t('chat.message.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  /**
   * 格式化消息时间
   * 当天只显示时分，非当天显示月日与时分
   * locale 跟随当前界面语言，避免英文环境下出现中文日期格式
   */
  const formatTime = useCallback((dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    /* i18n.language 形如 zh-CN / en-US，可直接作为 BCP 47 locale 使用 */
    const locale = i18n.language || 'zh-CN'

    if (isToday) {
      return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }, [i18n.language])

  /* Markdown 渲染配置：自定义各元素以应用系统字体设置 */
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')

      /* 带语言标识的块级代码 -> 使用 CodeBlock 组件（含语言徽章与复制） */
      if (!inline && match) {
        return (
          <CodeBlock className={className}>
            {String(children).replace(/\n$/, '')}
          </CodeBlock>
        )
      }

      /* 无语言标识的块级代码 -> 简单 pre 渲染 */
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

      /* 行内代码 */
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

  /**
   * 渲染 thinking 折叠区域
   * 仅当 showThinking=true 且存在 thinking 内容时展示
   * 多个思考块时标题带序号，单个时不带
   */
  const renderThinkingBlocks = () => {
    if (!showThinking || thinkingBlocks.length === 0) return null

    const hasMultipleBlocks = thinkingBlocks.length > 1

    return (
      <div className="thinking-blocks" style={{ marginBottom: '12px' }}>
        <Collapse
          size="small"
          ghost
          items={thinkingBlocks.map((block, index) => ({
            key: `thinking-${index}`,
            label: (
              <span style={{
                color: '#8c8c8c', fontSize: '12px',
                display: 'flex', alignItems: 'center', gap: '6px'
              }}>
                <BulbOutlined />
                {hasMultipleBlocks
                  ? t('chat.thinking.blockTitleIndexed', { index: index + 1 })
                  : t('chat.thinking.blockTitle')}
              </span>
            ),
            children: (
              <div style={{
                fontSize: '13px',
                color: '#666',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: `${THINKING_BLOCK_MAX_HEIGHT}px`,
                overflow: 'auto',
                fontFamily: chatFontFamily
              }}>
                {block}
              </div>
            ),
            style: {
              background: '#f9f9fb',
              borderRadius: '8px',
              border: '1px solid #f0f0f0',
              marginBottom: hasMultipleBlocks ? '6px' : 0
            }
          }))}
        />
      </div>
    )
  }

  return (
    <div className={`message-content ${isUser ? 'user-message' : 'assistant-message'}`}>

      {/* 用户上传的图片（支持多张，响应式网格） */}
      {imageFiles.length > 0 && (
        <div className="message-images" style={{ marginBottom: '8px' }}>
          <Row gutter={[8, 8]}>
            {imageFiles.map((file, index) => (
              <Col
                key={file.id || index}
                xs={imageFiles.length === 1 ? 24 : 12}
                sm={imageFiles.length === 1 ? 16 : 8}
              >
                <Image
                  src={file.url}
                  alt={file.original_name}
                  width="100%"
                  style={{
                    borderRadius: '8px',
                    maxWidth: imageFiles.length === 1 ? '300px' : '200px'
                  }}
                  placeholder={
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      height: '120px', backgroundColor: '#f5f5f5'
                    }}>
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

      {/* 上传的文档附件 */}
      {docFiles.length > 0 && docFiles.map((file, index) => (
        <div key={file.id || index} className="message-document" style={{ marginBottom: '8px' }}>
          <Text type="secondary">
            {t('chat.message.documentPrefix', { name: file.original_name })}
          </Text>
        </div>
      ))}

      {/* thinking 折叠区域（显示在正文之前） */}
      {isAssistant && renderThinkingBlocks()}

      {/* 消息正文内容 */}
      <div className="message-text" style={messageTextStyle}>
        {isUser ? (
          <div style={userMessageStyle}>
            {renderUserMessage(message.content)}
          </div>
        ) : (
          <>
            {message.error ? (
              /* AI 响应异常 */
              <div style={{ color: '#ff4d4f', fontSize: '13px', padding: '4px 0' }}>
                {message.content || `⚠️ ${t('chat.message.errorResponse')}`}
              </div>
            ) : !displayContent && !message.streaming && generatedImages.length === 0 ? (
              /* 空内容提示：区分"仅有思考过程"与"完全无返回"两种情况 */
              <div style={{ color: '#999', fontSize: '13px', fontStyle: 'italic', padding: '4px 0' }}>
                {thinkingBlocks.length > 0
                  ? `💭 ${t('chat.thinking.onlyThinking')}`
                  : `⚠️ ${t('chat.message.emptyResponse')}`}
              </div>
            ) : isStreaming && message.streaming ? (
              /* 流式输出中：正文 + 闪烁光标 */
              <div className="streaming-content">
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                  {displayContent || ''}
                </ReactMarkdown>
                <span className="streaming-cursor"><LoadingOutlined /></span>
              </div>
            ) : (
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            )}
          </>
        )}
      </div>

      {/* AI 生成的图片 */}
      {isAssistant && generatedImages.length > 0 && (
        <div className="generated-images" style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', color: '#1890ff' }}>
            <PictureOutlined style={{ marginRight: '6px' }} />
            <Text type="secondary">
              {t('chat.message.generatedImages', { count: generatedImages.length })}
            </Text>
          </div>
          <Row gutter={[12, 12]}>
            {generatedImages.map((img, index) => (
              <Col key={index} xs={24} sm={12} md={8} lg={6}>
                <Image
                  src={img.url}
                  alt={`Generated image ${index + 1}`}
                  style={{ width: '100%', borderRadius: '8px', border: '1px solid #f0f0f0' }}
                  placeholder={
                    <div style={{
                      width: '100%', height: '200px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5'
                    }}>
                      <Spin />
                    </div>
                  }
                />
                {img.filename && (
                  <Text type="secondary" style={{
                    fontSize: '12px', display: 'block',
                    marginTop: '4px', textAlign: 'center'
                  }}>
                    {img.filename}
                  </Text>
                )}
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* 消息底部信息栏（流式输出中不显示） */}
      {!isStreaming && !message.streaming && (
        <div className="message-footer">
          <Space size="middle" className="message-info">
            {/* 发送时间 */}
            <span className="info-item">
              <ClockCircleOutlined />
              <Text type="secondary" className="info-text">{formatTime(message.created_at)}</Text>
            </span>

            {/* Token 消耗 */}
            {message.tokens > 0 && (
              <span className="info-item">
                <ThunderboltOutlined />
                <Text type="secondary" className="info-text">
                  {message.tokens} {t('chat.message.tokensUnit')}
                </Text>
              </span>
            )}

            {/* 使用的模型（名称来自后台配置，属业务数据不翻译） */}
            {isAssistant && messageModel && (
              <span className="info-item">
                <RobotOutlined />
                <Text type="secondary" className="info-text">
                  {messageModel.display_name || messageModel.name}
                </Text>
              </span>
            )}

            {/* 生成图片数量 */}
            {isAssistant && generatedImages.length > 0 && (
              <span className="info-item">
                <PictureOutlined />
                <Text type="secondary" className="info-text">
                  {t('chat.message.imageCount', { count: generatedImages.length })}
                </Text>
              </span>
            )}

            {/* 附件图片数量（多张时显示） */}
            {imageFiles.length > 1 && (
              <span className="info-item">
                <PictureOutlined />
                <Text type="secondary" className="info-text">
                  {t('chat.message.attachmentCount', { count: imageFiles.length })}
                </Text>
              </span>
            )}

            {/* 存在被隐藏的 thinking 内容时的提示 */}
            {isAssistant && !showThinking && thinkingBlocks.length > 0 && (
              <span className="info-item" style={{ opacity: 0.6 }}>
                <BulbOutlined />
                <Text type="secondary" className="info-text">
                  {t('chat.thinking.hasThinking')}
                </Text>
              </span>
            )}
          </Space>

          {/* 消息操作按钮 */}
          <Space size="small" className="message-actions">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              title={t('chat.message.copyTooltip')}
            />
            {isAssistant && onDeleteMessage && (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                loading={deleting}
                title={t('chat.message.deleteTooltip')}
              />
            )}
          </Space>
        </div>
      )}
    </div>
  )
}

export default MessageContent
