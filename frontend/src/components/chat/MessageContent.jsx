import React from 'react'
import CodeBlock from './CodeBlock'

const MessageContent = ({ content, role }) => {
  // 如果是用户消息，直接显示文本，不做任何解析
  if (role === 'user') {
    return (
      <div className="message-content user-message">
        {content}
      </div>
    )
  }

  // AI消息：只处理代码块，其他内容保持原样
  const renderAIMessage = (text) => {
    // 匹配代码块的正则表达式 (```语言\n代码\n```)
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
    const parts = []
    let lastIndex = 0
    let match

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // 添加代码块前的普通文本
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index)
        if (beforeText.trim()) {
          parts.push(
            <span key={`text-${lastIndex}`} className="normal-text">
              {beforeText}
            </span>
          )
        }
      }

      // 添加代码块组件
      const language = match[1] || 'text'
      const code = match[2].trim()
      
      parts.push(
        <CodeBlock 
          key={`code-${match.index}`}
          className={`language-${language}`}
        >
          {code}
        </CodeBlock>
      )

      lastIndex = match.index + match[0].length
    }

    // 添加最后剩余的普通文本
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex)
      if (remainingText.trim()) {
        parts.push(
          <span key={`text-${lastIndex}`} className="normal-text">
            {remainingText}
          </span>
        )
      }
    }

    // 如果没有找到代码块，直接返回原文本
    if (parts.length === 0) {
      return <span className="normal-text">{text}</span>
    }

    return parts
  }

  return (
    <div className="message-content ai-message">
      {renderAIMessage(content)}
    </div>
  )
}

export default MessageContent
