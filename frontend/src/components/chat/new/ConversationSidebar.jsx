/**
 * 会话侧边栏组件 - iOS风格优化版（仅对话列表）
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
  PushpinFilled,
  MenuFoldOutlined,
  MenuUnfoldOutlined
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
  aiModels = [],
  collapsed = false,
  onToggleCollapse
}) => {
  const { t } = useTranslation()

  // 渲染单个会话项 - 优化置顶图标显示
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
            {/* 简单的置顶图标，不显示数字 */}
            {conversation.priority > 0 && (
              <PushpinFilled 
                className="pin-icon"
                style={{ 
                  color: '#FF9500',
                  fontSize: 14,
                  marginRight: 6
                }} 
              />
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
            <MessageOutlined /> {conversation.message_count || 0}
          </Text>
        </div>
        {conversation.last_message_at && (
          <div className="conversation-time">
            <ClockCircleOutlined /> {new Date(conversation.last_message_at).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        )}
      </div>
    )
  }

  // 如果侧边栏折叠，只显示折叠按钮
  if (collapsed) {
    return (
      <div className="sidebar-wrapper collapsed-sidebar">
        <div className="sidebar-collapsed-header">
          <Tooltip title="展开侧边栏" placement="right">
            <Button
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={onToggleCollapse}
              className="collapse-button-only"
              style={{
                width: '36px',
                height: '36px',
                margin: '8px auto'
              }}
            />
          </Tooltip>
        </div>
      </div>
    )
  }

  // 正常展开状态
  return (
    <div className="sidebar-wrapper">
      {/* 新建按钮和折叠按钮 - iOS风格优化 */}
      <div className="sidebar-header-fixed">
        <div className="sidebar-header-content">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onCreateConversation}
            className="new-chat-button"
            style={{ flex: 1 }}
          >
            {t('chat.newConversation')}
          </Button>
          {/* 折叠/展开按钮 */}
          <Tooltip title="收起侧边栏">
            <Button
              type="text"
              icon={<MenuFoldOutlined />}
              onClick={onToggleCollapse}
              className="collapse-button"
            />
          </Tooltip>
        </div>
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
