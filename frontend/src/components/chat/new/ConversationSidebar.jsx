/**
 * 会话侧边栏组件
 */

import React from 'react'
import {
  Button,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  PlusOutlined,
  SettingOutlined,
  DeleteOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  StarFilled
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

const ConversationSidebar = ({
  conversations = [],
  conversationsLoading = false,
  currentConversation,
  userCredits,
  onSelectConversation,
  onCreateConversation,
  onEditConversation,
  onDeleteConversation,
  onTogglePin,
  aiModels = []
}) => {
  const { t } = useTranslation()

  // 渲染单个会话项
  const renderConversationItem = (conversation) => {
    const isActive = currentConversation?.id === conversation.id
    const model = aiModels.find(m => m.name === conversation.model_name)
    
    return (
      <div
        key={conversation.id}
        className={`conversation-item ${isActive ? 'active' : ''}`}
        onClick={() => onSelectConversation(conversation.id)}
      >
        <div className="conversation-header">
          <div className="conversation-title">
            {conversation.priority > 0 && (
              <Tag color="gold" size="small">
                <StarFilled /> {conversation.priority}
              </Tag>
            )}
            <span className="title-text">{conversation.title}</span>
          </div>
          <div className="conversation-actions">
            <Tooltip title={t('chat.conversation.settings')}>
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditConversation(conversation)
                }}
              />
            </Tooltip>
            <Tooltip title={t('button.delete')}>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteConversation(conversation)
                }}
              />
            </Tooltip>
          </div>
        </div>
        <div className="conversation-meta">
          <Text type="secondary" className="message-count">
            <MessageOutlined /> {conversation.message_count}
          </Text>
        </div>
        {conversation.last_message_at && (
          <div className="conversation-time">
            <ClockCircleOutlined /> {new Date(conversation.last_message_at).toLocaleString()}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="sidebar-wrapper">
      {/* 新建按钮 */}
      <div className="sidebar-header-fixed">
        <Button
          type="default"
          block
          icon={<PlusOutlined />}
          onClick={onCreateConversation}
          style={{ height: '36px' }}
        >
          {t('chat.newConversation')}
        </Button>
      </div>
      
      {/* 对话列表 */}
      <div className="conversations-list-wrapper">
        {conversationsLoading ? (
          <div className="loading-container">
            <Spin tip={t('status.loading')} />
          </div>
        ) : conversations.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('chat.noConversations')}
          />
        ) : (
          conversations.map(conversation => renderConversationItem(conversation))
        )}
      </div>
    </div>
  )
}

export default ConversationSidebar
