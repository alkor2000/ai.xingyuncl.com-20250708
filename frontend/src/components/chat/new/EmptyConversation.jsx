/**
 * 空对话状态组件
 */

import React from 'react'
import {
  Empty,
  Button,
  Space,
  Typography
} from 'antd'
import {
  RobotOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Title, Paragraph } = Typography

const EmptyConversation = ({ onCreateConversation }) => {
  const { t } = useTranslation()

  return (
    <div className="no-conversation">
      <Empty
        image={<RobotOutlined style={{ fontSize: 64, color: '#bfbfbf' }} />}
        description={
          <Space direction="vertical" size="large">
            <Title level={4}>{t('chat.welcome')}</Title>
            <Paragraph>{t('chat.selectOrCreate')}</Paragraph>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={onCreateConversation}
            >
              {t('chat.startNewChat')}
            </Button>
          </Space>
        }
      />
    </div>
  )
}

export default EmptyConversation
