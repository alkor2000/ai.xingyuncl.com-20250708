import React, { useState } from 'react'
import { Typography, Image, Spin } from 'antd'
import { UserOutlined, RobotOutlined, LoadingOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import './MessageContent.less'

const { Text } = Typography

const MessageContent = ({ message, isStreaming = false }) => {
  const [imageLoading, setImageLoading] = useState(true)
  
  const isUser = message.role === 'user'
  
  // Markdown 渲染配置
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      return !inline && match ? (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
  }
  
  return (
    <div className={`message-content ${isUser ? 'user-message' : 'assistant-message'}`}>
      <div className="message-avatar">
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>
      
      <div className="message-body">
        {/* 显示图片（如果有） */}
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
        <div className="message-text">
          {isUser ? (
            <Text>{message.content}</Text>
          ) : (
            <>
              {isStreaming && message.streaming ? (
                <div className="streaming-content">
                  <ReactMarkdown components={markdownComponents}>
                    {message.content || ''}
                  </ReactMarkdown>
                  <span className="streaming-cursor">
                    <LoadingOutlined />
                  </span>
                </div>
              ) : (
                <ReactMarkdown components={markdownComponents}>
                  {message.content}
                </ReactMarkdown>
              )}
            </>
          )}
        </div>
        
        {/* 消息时间 */}
        <div className="message-time">
          <Text type="secondary" className="time-text">
            {new Date(message.created_at).toLocaleTimeString()}
          </Text>
        </div>
      </div>
    </div>
  )
}

export default MessageContent
