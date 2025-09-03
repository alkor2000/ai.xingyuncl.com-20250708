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
  
  // 处理生成的图片数据
  const getGeneratedImages = () => {
    if (!message.generated_images) return []
    
    // 如果是字符串，尝试解析JSON
    if (typeof message.generated_images === 'string') {
      try {
        return JSON.parse(message.generated_images)
      } catch (e) {
        console.error('解析生成的图片失败:', e)
        return []
      }
    }
    
    // 如果已经是数组，直接返回
    if (Array.isArray(message.generated_images)) {
      return message.generated_images
    }
    
    return []
  }
  
  const generatedImages = getGeneratedImages()
  
  // 添加调试日志，查看消息数据
  if (isAssistant && !message.temp && !message.streaming && generatedImages.length > 0) {
    console.log('AI消息包含生成的图片:', {
      id: message.id,
      imageCount: generatedImages.length,
      images: generatedImages
    })
  }
  
  // 获取消息实际使用的模型信息
  const getMessageModel = () => {
    // 优先使用消息自己的model_name
    if (message.model_name) {
      // 尝试在aiModels中找到对应的模型对象
      const model = aiModels.find(m => m.name === message.model_name)
      if (model) {
        return model
      }
      // 如果找不到，创建一个临时模型对象，确保显示正确的模型名
      return {
        name: message.model_name,
        display_name: message.model_name // 使用模型名作为显示名
      }
    }
    
    // 只有临时消息（没有model_name的）才使用当前对话的模型
    if (message.temp || message.streaming) {
      return currentModel
    }
    
    // 其他情况返回null，不显示模型信息
    return null
  }
  
  const messageModel = getMessageModel()
  
  // 消息文本样式
  const messageTextStyle = {
    fontFamily: chatFontFamily,
    fontSize: `${chatFontSize}px`,
    lineHeight: chatFontSize > 16 ? '1.6' : '1.5'
  }
  
  // 用户消息样式 - 添加 white-space: pre-wrap 以保留格式
  const userMessageStyle = {
    ...messageTextStyle,
    whiteSpace: 'pre-wrap',  // 保留换行和空格
    wordBreak: 'break-word'  // 长单词换行
  }
  
  // 处理用户消息格式，将换行符转换为HTML结构
  const renderUserMessage = (content) => {
    if (!content) return null
    
    // 将内容按换行符分割
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
      console.error('复制失败:', error)
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
      console.error('删除失败:', error)
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
    } else {
      return date.toLocaleString('zh-CN', { 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    }
  }
  
  // Markdown 渲染配置
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      
      // 如果是代码块（非内联）且有语言标识，使用CodeBlock组件
      if (!inline && match) {
        return (
          <CodeBlock className={className}>
            {String(children).replace(/\n$/, '')}
          </CodeBlock>
        )
      }
      
      // 如果是代码块但没有语言标识，使用普通的pre标签
      // 重要修改：使用自动换行而不是滚动
      if (!inline) {
        return (
          <pre style={{ 
            backgroundColor: '#2d3748', 
            color: '#d4d4d4',
            padding: '16px', 
            borderRadius: '6px',
            // 核心修改：完全避免滚动，使用自动换行
            overflow: 'visible',        // 完全不创建滚动容器
            whiteSpace: 'pre-wrap',      // 保留格式但允许换行
            wordBreak: 'break-all',      // 允许在任意位置断行
            overflowWrap: 'break-word',  // 长单词换行
            maxWidth: '100%',            // 确保不超出容器宽度
            marginTop: '8px',
            marginBottom: '8px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: '13px',
            lineHeight: '1.45',
            minHeight: '20px'           // 添加最小高度
          }}>
            <code>
              {String(children).replace(/\n$/, '')}
            </code>
          </pre>
        )
      }
      
      // 内联代码使用原样式
      return (
        <code 
          className={className} 
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.06)',
            padding: '2px 4px',
            borderRadius: '3px',
            fontSize: '14px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace'
          }}
          {...props}
        >
          {children}
        </code>
      )
    },
    // 为所有文本元素应用字体设置
    p: ({ children }) => <p style={messageTextStyle}>{children}</p>,
    li: ({ children }) => <li style={messageTextStyle}>{children}</li>,
    h1: ({ children }) => <h1 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.7}px` }}>{children}</h1>,
    h2: ({ children }) => <h2 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.5}px` }}>{children}</h2>,
    h3: ({ children }) => <h3 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.3}px` }}>{children}</h3>,
    h4: ({ children }) => <h4 style={{ ...messageTextStyle, fontSize: `${chatFontSize * 1.1}px` }}>{children}</h4>,
    h5: ({ children }) => <h5 style={{ ...messageTextStyle, fontSize: `${chatFontSize}px` }}>{children}</h5>,
    h6: ({ children }) => <h6 style={{ ...messageTextStyle, fontSize: `${chatFontSize}px` }}>{children}</h6>,
    // 表格相关组件样式
    table: ({ children }) => (
      <div className="markdown-table-wrapper">
        <table className="markdown-table">
          {children}
        </table>
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
      {/* 显示上传的图片（用户消息） */}
      {message.file && (
        <div className="message-image">
          <Image
            src={message.file.url}
            alt={message.file.original_name}
            width={300}
            placeholder={
              <div className="image-loading">
                <Spin />
              </div>
            }
            onLoad={() => setImageLoading(false)}
            onError={() => setImageLoading(false)}
          />
          <Text type="secondary" className="image-name">
            {message.file.original_name}
          </Text>
        </div>
      )}
      
      {/* 消息文本内容 */}
      <div className="message-text" style={messageTextStyle}>
        {isUser ? (
          // 使用实际的HTML结构渲染用户消息，支持手动选择复制格式
          <div style={userMessageStyle}>
            {renderUserMessage(message.content)}
          </div>
        ) : (
          <>
            {isStreaming && message.streaming ? (
              <div className="streaming-content">
                <ReactMarkdown 
                  components={markdownComponents}
                  remarkPlugins={[remarkGfm]}
                >
                  {message.content || ''}
                </ReactMarkdown>
                <span className="streaming-cursor">
                  <LoadingOutlined />
                </span>
              </div>
            ) : (
              <ReactMarkdown 
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </>
        )}
      </div>
      
      {/* 显示AI生成的图片 */}
      {isAssistant && generatedImages.length > 0 && (
        <div className="generated-images" style={{ marginTop: '12px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            marginBottom: '8px',
            color: '#1890ff'
          }}>
            <PictureOutlined style={{ marginRight: '6px' }} />
            <Text type="secondary">生成的图片 ({generatedImages.length})</Text>
          </div>
          <Row gutter={[12, 12]}>
            {generatedImages.map((img, index) => (
              <Col key={index} xs={24} sm={12} md={8} lg={6}>
                <Image
                  src={img.url}
                  alt={`Generated image ${index + 1}`}
                  style={{ 
                    width: '100%', 
                    borderRadius: '8px',
                    border: '1px solid #f0f0f0'
                  }}
                  placeholder={
                    <div style={{ 
                      width: '100%', 
                      height: '200px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#f5f5f5'
                    }}>
                      <Spin />
                    </div>
                  }
                />
                {img.filename && (
                  <Text type="secondary" style={{ 
                    fontSize: '12px',
                    display: 'block',
                    marginTop: '4px',
                    textAlign: 'center'
                  }}>
                    {img.filename}
                  </Text>
                )}
              </Col>
            ))}
          </Row>
        </div>
      )}
      
      {/* 消息底部信息 - 用户消息和AI消息都显示，但内容不同 */}
      {!isStreaming && !message.streaming && (
        <div className="message-footer">
          <Space size="middle" className="message-info">
            {/* 时间 - 所有消息都显示 */}
            <span className="info-item">
              <ClockCircleOutlined />
              <Text type="secondary" className="info-text">
                {formatTime(message.created_at)}
              </Text>
            </span>
            
            {/* Token数量 - 不限制角色，只要有token就显示 */}
            {message.tokens > 0 && (
              <span className="info-item">
                <ThunderboltOutlined />
                <Text type="secondary" className="info-text">
                  {message.tokens} Tokens
                </Text>
              </span>
            )}
            
            {/* 模型名称 - 只显示AI消息的，使用消息自己的模型 */}
            {isAssistant && messageModel && (
              <span className="info-item">
                <RobotOutlined />
                <Text type="secondary" className="info-text">
                  {messageModel.display_name || messageModel.name}
                </Text>
              </span>
            )}
            
            {/* 显示生成的图片数量 */}
            {isAssistant && generatedImages.length > 0 && (
              <span className="info-item">
                <PictureOutlined />
                <Text type="secondary" className="info-text">
                  {generatedImages.length} 张图片
                </Text>
              </span>
            )}
          </Space>
          
          {/* 操作按钮 - 根据消息类型显示不同按钮 */}
          <Space size="small" className="message-actions">
            {/* 复制按钮 - 所有消息都有 */}
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              title="复制内容"
            />
            
            {/* 删除按钮 - 只有AI消息才有 */}
            {isAssistant && onDeleteMessage && (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                loading={deleting}
                title="删除对话"
              />
            )}
          </Space>
        </div>
      )}
    </div>
  )
}

export default MessageContent
