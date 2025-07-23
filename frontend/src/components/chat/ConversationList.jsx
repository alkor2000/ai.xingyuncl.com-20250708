import React, { useCallback, useMemo } from 'react'
import { 
  Button, 
  List, 
  Empty, 
  Spin, 
  Dropdown,
  Tag
} from 'antd'
import {
  PlusOutlined,
  MoreOutlined,
  SettingOutlined,
  DeleteOutlined,
  PushpinOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

// 提取样式常量，避免每次渲染创建新对象
const styles = {
  sidebar: {
    padding: '16px 16px 16px 16px'
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '20px'
  },
  loadingText: {
    marginTop: 8,
    color: '#666'
  },
  emptyContainer: {
    marginTop: '50px'
  },
  listItem: {
    marginBottom: 8,
    borderRadius: 6,
    cursor: 'pointer',
    padding: '12px 8px',
    // 只对需要动画的属性添加过渡效果
    transition: 'background-color 0.15s ease, border-color 0.15s ease'
  },
  listItemSelected: {
    background: '#f0f7ff',
    border: '1px solid #d9ecff'
  },
  listItemDefault: {
    background: 'transparent',
    border: '1px solid transparent'
  },
  titleContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  titleContent: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden'
  },
  priorityTag: {
    margin: 0,
    fontSize: 11,
    padding: '0 4px',
    lineHeight: '18px'
  },
  priorityIcon: {
    fontSize: 10,
    marginRight: 2
  },
  title: {
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  titleSelected: {
    fontWeight: 600,
    color: '#1677ff'
  },
  titleDefault: {
    fontWeight: 500,
    color: 'inherit'
  },
  description: {
    fontSize: 12,
    color: '#999'
  }
}

// 日期格式化选项
const dateFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
}

// 获取优先级标签颜色
const getPriorityColor = (priority) => {
  if (priority >= 8) return 'red'
  if (priority >= 5) return 'orange'
  if (priority >= 3) return 'blue'
  return 'default'
}

// 单独的对话项组件，减少重渲染
const ConversationItem = React.memo(({ 
  conversation, 
  isSelected, 
  onSelect, 
  onEdit, 
  onDelete,
  t 
}) => {
  // 缓存菜单配置
  const menuItems = useMemo(() => [
    {
      key: 'edit',
      label: t('chat.conversation.settings'),
      icon: <SettingOutlined />,
      onClick: (e) => {
        e?.domEvent?.stopPropagation()
        onEdit(conversation)
      }
    },
    {
      key: 'delete',
      label: t('chat.conversation.delete'),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: (e) => {
        e?.domEvent?.stopPropagation()
        onDelete(conversation.id)
      }
    }
  ], [conversation, onEdit, onDelete, t])

  // 缓存格式化的日期
  const formattedDate = useMemo(() => 
    new Date(conversation.updated_at).toLocaleString('zh-CN', dateFormatOptions),
    [conversation.updated_at]
  )

  // 处理点击事件
  const handleClick = useCallback(() => {
    onSelect(conversation.id)
  }, [conversation.id, onSelect])

  // 阻止下拉菜单按钮的点击冒泡
  const handleDropdownClick = useCallback((e) => {
    e.stopPropagation()
  }, [])

  return (
    <List.Item
      style={{
        ...styles.listItem,
        ...(isSelected ? styles.listItemSelected : styles.listItemDefault)
      }}
      onClick={handleClick}
    >
      <List.Item.Meta
        title={
          <div style={styles.titleContainer}>
            <div style={styles.titleContent}>
              {conversation.priority > 0 && (
                <Tag 
                  color={getPriorityColor(conversation.priority)}
                  style={styles.priorityTag}
                >
                  <PushpinOutlined style={styles.priorityIcon} />
                  {conversation.priority}
                </Tag>
              )}
              <span style={{
                ...styles.title,
                ...(isSelected ? styles.titleSelected : styles.titleDefault)
              }}>
                {conversation.title}
              </span>
            </div>
            <Dropdown 
              menu={{ items: menuItems }} 
              trigger={['click']}
              placement="bottomRight"
            >
              <Button 
                type="text" 
                size="small" 
                icon={<MoreOutlined />}
                onClick={handleDropdownClick}
              />
            </Dropdown>
          </div>
        }
        description={
          <div style={styles.description}>
            {formattedDate}
          </div>
        }
      />
    </List.Item>
  )
})

ConversationItem.displayName = 'ConversationItem'

const ConversationList = React.memo(({ 
  conversations, 
  conversationsLoading,
  currentConversationId,
  onSelectConversation,
  onEditConversation,
  onDeleteConversation,
  onCreateConversation
}) => {
  const { t } = useTranslation()

  // 使用useCallback缓存回调函数
  const handleSelectConversation = useCallback((id) => {
    onSelectConversation(id)
  }, [onSelectConversation])

  const handleEditConversation = useCallback((conversation) => {
    onEditConversation(conversation)
  }, [onEditConversation])

  const handleDeleteConversation = useCallback((id) => {
    onDeleteConversation(id)
  }, [onDeleteConversation])

  return (
    <div className="chat-sidebar">
      {/* 新建对话按钮 */}
      <div style={styles.sidebar}>
        <Button 
          type="primary" 
          block 
          icon={<PlusOutlined />}
          onClick={onCreateConversation}
        >
          {t('chat.newConversation')}
        </Button>
      </div>
      
      <div className="chat-conversations-container">
        <div className="chat-conversations-list">
          {conversationsLoading ? (
            <div style={styles.loadingContainer}>
              <Spin />
              <div style={styles.loadingText}>{t('chat.loadingConversations')}</div>
            </div>
          ) : conversations.length === 0 ? (
            <Empty 
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('chat.noConversations')}
              style={styles.emptyContainer}
            />
          ) : (
            <List
              dataSource={conversations}
              renderItem={conv => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isSelected={currentConversationId === conv.id}
                  onSelect={handleSelectConversation}
                  onEdit={handleEditConversation}
                  onDelete={handleDeleteConversation}
                  t={t}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
})

ConversationList.displayName = 'ConversationList'

export default ConversationList
