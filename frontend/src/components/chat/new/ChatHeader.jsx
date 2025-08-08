/**
 * 对话头部组件 - 简化版
 */

import React from 'react'
import {
  Button,
  Tag,
  Typography,
  Space
} from 'antd'
import {
  MenuOutlined,
  PictureOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Title } = Typography

const ChatHeader = ({
  conversation,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings
}) => {
  const { t } = useTranslation()
  
  if (!conversation) return null

  return (
    <div className="chat-header">
      <div className="header-left">
        <Button
          icon={<MenuOutlined />}
          onClick={onToggleSidebar}
          className="menu-button"
          type="text"
          size="small"
        />
        <Title level={5} className="conversation-title" style={{ margin: 0 }}>
          {conversation.title}
        </Title>
      </div>
      <div className="header-right">
        <Space>
          {conversation.model_name && (
            <Tag color="blue">{conversation.model_name}</Tag>
          )}
          <Button
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            type="text"
            size="small"
            title={t('chat.conversation.settings')}
          />
        </Space>
      </div>
    </div>
  )
}

export default ChatHeader
