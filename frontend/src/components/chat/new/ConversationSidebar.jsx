/**
 * 会话侧边栏组件 - iOS风格优化版（仅对话列表）
 *
 * 功能：
 * - 新建对话按钮 + 折叠/展开按钮
 * - 对话列表展示（标题、消息数、最后活跃时间、置顶图标）
 * - 对话设置/删除快捷操作
 *
 * v2.0 新增：
 * - 对话标题搜索框（前端按标题toLowerCase模糊匹配）
 * - 紧凑模式切换按钮（单行显示标题，节省垂直空间）
 * - 紧凑模式偏好通过 localStorage 持久化
 * - 搜索激活时显示匹配数；无结果时显示友好Empty提示
 *
 * 说明：搜索关键字和紧凑模式状态在组件内部自管理，
 *      不影响父组件Chat.jsx的状态结构和props契约
 */

import React, { useState, useMemo, useEffect } from 'react'
import {
  Button,
  Empty,
  Input,
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
  MenuUnfoldOutlined,
  SearchOutlined,
  CompressOutlined,
  ExpandAltOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

// localStorage 中紧凑模式开关的键名
const COMPACT_MODE_KEY = 'chat_sidebar_compact_mode'

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

  // v2.0: 对话标题搜索关键字（前端实时过滤，无需后端）
  const [searchKeyword, setSearchKeyword] = useState('')

  // v2.0: 紧凑模式开关（从localStorage读取持久化偏好，默认标准模式）
  const [compactMode, setCompactMode] = useState(() => {
    try {
      const saved = localStorage.getItem(COMPACT_MODE_KEY)
      return saved === 'true'
    } catch {
      return false
    }
  })

  // v2.0: 紧凑模式切换后保存到 localStorage
  const handleToggleCompactMode = () => {
    setCompactMode(prev => {
      const newValue = !prev
      try {
        localStorage.setItem(COMPACT_MODE_KEY, String(newValue))
      } catch {
        // localStorage 不可用时静默失败，不影响功能
      }
      return newValue
    })
  }

  // v2.0: 根据搜索关键字过滤会话列表（按标题toLowerCase模糊匹配）
  const filteredConversations = useMemo(() => {
    if (!searchKeyword || !searchKeyword.trim()) {
      return conversations
    }
    const keyword = searchKeyword.trim().toLowerCase()
    return conversations.filter(conv => {
      const title = (conv.title || '').toLowerCase()
      return title.includes(keyword)
    })
  }, [conversations, searchKeyword])

  // v2.0: 派生状态 - 搜索激活但无结果（用于显示空结果提示）
  const isSearchActive = Boolean(searchKeyword && searchKeyword.trim())
  const isSearchNoResult = isSearchActive && filteredConversations.length === 0

  // 渲染单个会话项（支持标准模式和紧凑模式两种视觉）
  const renderConversationItem = (conversation) => {
    const isActive = currentConversation?.id === conversation.id

    // v2.0: 紧凑模式渲染分支（单行只显示标题，操作按钮hover时浮现）
    if (compactMode) {
      return (
        <div
          key={conversation.id}
          className={`conversation-item conversation-item-compact ${isActive ? 'active' : ''}`}
          onClick={() => onSelectConversation(conversation.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 10px',
            marginBottom: 2,
            minHeight: 32,
            cursor: 'pointer',
            position: 'relative'
          }}
        >
          {/* 置顶图标 */}
          {conversation.priority > 0 && (
            <PushpinFilled
              style={{
                color: '#FF9500',
                fontSize: 12,
                marginRight: 6,
                flexShrink: 0
              }}
            />
          )}
          {/* 标题（单行ellipsis截断） */}
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13,
              lineHeight: '20px'
            }}
            title={conversation.title}
          >
            {conversation.title}
          </span>
          {/* 操作按钮区（hover时浮现，由CSS控制；这里始终渲染但用className-compact-actions） */}
          <span
            className="conversation-compact-actions"
            style={{
              flexShrink: 0,
              marginLeft: 4
            }}
          >
            <Tooltip title={t('chat.conversation.settings')}>
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditConversation(conversation)
                }}
                style={{ padding: '0 4px', height: 22 }}
              />
            </Tooltip>
            <Tooltip title={t('button.delete')}>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteConversation(conversation)
                }}
                style={{ padding: '0 4px', height: 22 }}
              />
            </Tooltip>
          </span>
        </div>
      )
    }

    // 标准模式（原始三层结构：title / meta / time）
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
      {/* 注入紧凑模式专属样式（避免修改全局Chat.less） */}
      <style>{`
        .conversation-item-compact {
          border-radius: 6px;
          transition: background-color 0.15s ease;
        }
        .conversation-item-compact:hover {
          background-color: rgba(0, 0, 0, 0.04);
        }
        .conversation-item-compact.active {
          background-color: rgba(0, 122, 255, 0.1);
          color: #007AFF;
        }
        .conversation-item-compact.active .title-text {
          color: #007AFF;
          font-weight: 500;
        }
        .conversation-compact-actions {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .conversation-item-compact:hover .conversation-compact-actions {
          opacity: 1;
        }
        .conversation-item-compact.active .conversation-compact-actions {
          opacity: 0.6;
        }
      `}</style>

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

      {/* v2.0: 搜索框 + 紧凑模式切换工具栏 */}
      <div
        style={{
          padding: '8px 12px 4px',
          display: 'flex',
          gap: 6,
          alignItems: 'center'
        }}
      >
        <Input
          size="small"
          prefix={<SearchOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />}
          placeholder={t('chat.sidebar.search')}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          style={{ flex: 1, borderRadius: 8 }}
        />
        <Tooltip
          title={
            compactMode
              ? t('chat.sidebar.compact.disable')
              : t('chat.sidebar.compact.enable')
          }
          placement="bottom"
        >
          <Button
            size="small"
            type={compactMode ? 'primary' : 'default'}
            icon={compactMode ? <ExpandAltOutlined /> : <CompressOutlined />}
            onClick={handleToggleCompactMode}
            style={{
              flexShrink: 0,
              borderRadius: 8
            }}
          />
        </Tooltip>
      </div>

      {/* v2.0: 搜索结果数提示（仅搜索激活时显示） */}
      {isSearchActive && (
        <div
          style={{
            padding: '0 12px 4px',
            fontSize: 11,
            color: '#8c8c8c',
            lineHeight: '16px'
          }}
        >
          {t('chat.sidebar.search.resultCount', {
            count: filteredConversations.length
          })}
        </div>
      )}

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
        ) : isSearchNoResult ? (
          /* v2.0: 搜索无结果的友好提示 */
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ fontSize: 13, color: '#8c8c8c' }}>
                {t('chat.sidebar.search.empty')}
              </span>
            }
            style={{ marginTop: 40 }}
          />
        ) : (
          filteredConversations.map(conversation => renderConversationItem(conversation))
        )}
      </div>
    </div>
  )
}

export default ConversationSidebar
