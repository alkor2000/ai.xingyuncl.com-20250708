/**
 * 会话侧边栏组件
 */

import React from 'react'
import {
  Button,
  Empty,
  Spin,
  Tag,
  Card,
  Tooltip,
  Typography
} from 'antd'
import {
  PlusOutlined,
  PushpinOutlined,
  PushpinFilled,
  SettingOutlined,
  DeleteOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  WalletOutlined,
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
            {conversation.is_pinned && <PushpinFilled className="pin-icon" />}
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
            <Tooltip title={conversation.is_pinned ? t('chat.conversation.unpin') : t('chat.conversation.pin')}>
              <Button
                type="text"
                size="small"
                icon={conversation.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin(conversation.id, conversation.is_pinned)
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
          <Tag size="small" color="blue">{model?.display_name || conversation.model_name}</Tag>
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
    <>
      <div className="sidebar-header">
        <Button
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={onCreateConversation}
        >
          {t('chat.newConversation')}
        </Button>
      </div>
      
      <div className="conversations-list">
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
      
      {/* 积分显示 */}
      {userCredits && (
        <div className="sidebar-footer">
          <Card size="small" className="credits-card">
            <div className="credits-info">
              <Text strong>{t('chat.credits.title')}</Text>
              <div className="credits-stats">
                <div className="credits-item">
                  <Text type="secondary">{t('chat.credits.remaining')}:</Text>
                  <Text strong className="credits-value">
                    {userCredits.credits_stats.remaining.toLocaleString()}
                  </Text>
                </div>
                <div className="credits-item">
                  <Text type="secondary">{t('chat.credits.used')}:</Text>
                  <Text className="credits-value">
                    {userCredits.credits_stats.used.toLocaleString()}
                  </Text>
                </div>
              </div>
              {userCredits.credits_stats?.isExpired && (
                <div style={{ color: "#ff4d4f", fontSize: 12, marginTop: 4 }}>
                  <ExclamationCircleOutlined /> {t('chat.credits.expired')}
                </div>
              )}
              {userCredits.credits_stats?.remainingDays !== null && 
               userCredits.credits_stats.remainingDays <= 7 && 
               !userCredits.credits_stats.isExpired && (
                <div style={{ color: "#fa8c16", fontSize: 12, marginTop: 4 }}>
                  <ClockCircleOutlined /> {t('chat.credits.expireSoon', { days: userCredits.credits_stats.remainingDays })}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}

export default ConversationSidebar
