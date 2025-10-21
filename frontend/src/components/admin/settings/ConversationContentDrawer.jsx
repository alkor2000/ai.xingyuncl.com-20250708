/**
 * 对话内容查看抽屉组件
 * 用于管理员查看使用记录中的完整对话内容
 */

import React, { useState, useEffect } from 'react'
import { 
  Drawer, 
  Spin, 
  Empty, 
  Alert, 
  Space, 
  Tag, 
  Divider,
  Typography,
  Timeline
} from 'antd'
import {
  UserOutlined,
  RobotOutlined,
  ClockCircleOutlined,
  MessageOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'
import apiClient from '../../../utils/api'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

const { Title, Text, Paragraph } = Typography

const ConversationContentDrawer = ({ 
  visible, 
  conversationId, 
  onClose 
}) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  // 当抽屉打开且有conversationId时加载数据
  useEffect(() => {
    if (visible && conversationId) {
      loadConversationData()
    } else {
      // 关闭时清空数据
      setData(null)
      setError(null)
    }
  }, [visible, conversationId])

  // 加载对话数据
  const loadConversationData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await apiClient.get(
        `/admin/conversations/${conversationId}/messages`
      )
      
      if (response.data.success) {
        setData(response.data.data)
      } else {
        setError(response.data.message || '加载失败')
      }
    } catch (err) {
      console.error('加载对话内容失败:', err)
      setError(err.response?.data?.message || '加载对话内容失败')
    } finally {
      setLoading(false)
    }
  }

  // 渲染消息内容（支持代码高亮）
  const renderMessageContent = (content) => {
    if (!content) return null

    // 检测代码块
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
    const parts = []
    let lastIndex = 0
    let match

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // 添加代码块之前的文本
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.substring(lastIndex, match.index)
        })
      }

      // 添加代码块
      parts.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2].trim()
      })

      lastIndex = match.index + match[0].length
    }

    // 添加最后剩余的文本
    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        content: content.substring(lastIndex)
      })
    }

    // 如果没有代码块，直接返回文本
    if (parts.length === 0) {
      return (
        <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {content}
        </Paragraph>
      )
    }

    // 渲染混合内容
    return parts.map((part, index) => {
      if (part.type === 'code') {
        return (
          <SyntaxHighlighter
            key={index}
            language={part.language}
            style={vscDarkPlus}
            customStyle={{
              borderRadius: 4,
              fontSize: 13,
              margin: '8px 0'
            }}
          >
            {part.content}
          </SyntaxHighlighter>
        )
      } else {
        return (
          <Paragraph 
            key={index} 
            style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}
          >
            {part.content}
          </Paragraph>
        )
      }
    })
  }

  // 渲染单条消息
  const renderMessage = (message) => {
    const isUser = message.role === 'user'
    const isSystem = message.role === 'system'

    return (
      <div
        key={message.id}
        style={{
          padding: 16,
          marginBottom: 12,
          borderRadius: 8,
          backgroundColor: isUser ? '#e6f7ff' : (isSystem ? '#fff7e6' : '#f5f5f5'),
          border: `1px solid ${isUser ? '#91d5ff' : (isSystem ? '#ffd591' : '#d9d9d9')}`
        }}
      >
        <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            {isUser ? (
              <Tag icon={<UserOutlined />} color="blue">用户</Tag>
            ) : isSystem ? (
              <Tag icon={<MessageOutlined />} color="orange">系统</Tag>
            ) : (
              <Tag icon={<RobotOutlined />} color="green">AI助手</Tag>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              <ClockCircleOutlined /> {moment(message.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Text>
          </Space>
          {message.tokens > 0 && (
            <Tag>{message.tokens} tokens</Tag>
          )}
        </Space>
        <div style={{ marginTop: 8 }}>
          {renderMessageContent(message.content)}
        </div>
      </div>
    )
  }

  // 渲染会话信息
  const renderConversationInfo = () => {
    if (!data?.conversation) return null

    const { conversation } = data

    return (
      <div style={{ marginBottom: 16, padding: 16, backgroundColor: '#fafafa', borderRadius: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>会话标题：</Text>
            <Text>{conversation.title || 'New Chat'}</Text>
          </div>
          <div>
            <Text strong>使用模型：</Text>
            <Tag color="blue">{conversation.model_name}</Tag>
          </div>
          <div>
            <Text strong>创建时间：</Text>
            <Text>{moment(conversation.created_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
          </div>
          {conversation.message_count > 0 && (
            <div>
              <Text strong>消息数量：</Text>
              <Text>{conversation.message_count} 条</Text>
            </div>
          )}
          {conversation.total_tokens > 0 && (
            <div>
              <Text strong>总Token数：</Text>
              <Text>{conversation.total_tokens.toLocaleString()}</Text>
            </div>
          )}
        </Space>
      </div>
    )
  }

  return (
    <Drawer
      title="对话内容"
      width={700}
      open={visible}
      onClose={onClose}
      destroyOnClose
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Spin size="large" tip="加载对话内容中..." />
        </div>
      )}

      {error && !loading && (
        <Alert
          message="加载失败"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {data && !loading && !error && (
        <>
          {renderConversationInfo()}
          
          <Divider orientation="left">
            对话记录（共 {data.messages.length} 条）
          </Divider>

          {data.messages.length === 0 ? (
            <Empty description="暂无对话记录" />
          ) : (
            <div style={{ marginTop: 16 }}>
              {data.messages.map(renderMessage)}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}

export default ConversationContentDrawer
