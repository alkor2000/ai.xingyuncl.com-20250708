/**
 * 对话头部组件
 */

import React from 'react'
import {
  Button,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  MenuOutlined,
  PlusOutlined,
  SettingOutlined,
  PictureOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Title } = Typography

const ChatHeader = ({
  currentConversation,
  aiModel,
  sidebarCollapsed,
  onToggleSidebar,
  onNewConversation,
  onOpenSettings
}) => {
  const { t } = useTranslation()
  
  if (!currentConversation) return null

  return (
    <div className="chat-header">
      <div className="header-left">
        <Button
          icon={<MenuOutlined />}
          onClick={onToggleSidebar}
          className="menu-button"
          type="text"
          size="large"
        />
        <Title level={4} className="conversation-title">
          {currentConversation.title}
        </Title>
        <Tag color="blue">{aiModel?.display_name}</Tag>
        {aiModel?.image_upload_enabled && (
          <Tag color="green" icon={<PictureOutlined />}>
            {t('chat.supportsImage')}
          </Tag>
        )}
      </div>
      <div className="header-right">
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={onNewConversation}
          >
            {t("chat.newConversation")}
          </Button>
          <Button
            type="primary"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
          >
            {t("chat.conversation.settings")}
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default ChatHeader
