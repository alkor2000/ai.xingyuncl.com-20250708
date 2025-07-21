/**
 * 空对话状态组件 - 显示系统公告
 */

import React, { useState, useEffect } from 'react'
import {
  Empty,
  Button,
  Space,
  Typography,
  Card,
  Spin
} from 'antd'
import {
  RobotOutlined,
  PlusOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import apiClient from '../../../utils/api'
import './EmptyConversation.less'

const { Title, Paragraph } = Typography

const EmptyConversation = ({ onCreateConversation }) => {
  const { t } = useTranslation()
  const [announcement, setAnnouncement] = useState(null)
  const [loading, setLoading] = useState(true)

  // 获取系统公告
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        setLoading(true)
        const response = await apiClient.get('/admin/announcement')
        if (response.data.success) {
          setAnnouncement(response.data.data)
        }
      } catch (error) {
        console.error('获取系统公告失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnnouncement()
  }, [])

  return (
    <div className="empty-conversation-container">
      {/* 系统公告 */}
      {loading ? (
        <div className="announcement-loading">
          <Spin size="large" />
        </div>
      ) : (
        announcement?.content && (
          <Card className="announcement-card">
            <div className="announcement-header">
              <InfoCircleOutlined style={{ color: '#1677ff', marginRight: 8 }} />
              <span>系统公告</span>
            </div>
            <div className="announcement-content markdown-content">
              <ReactMarkdown>{announcement.content}</ReactMarkdown>
            </div>
          </Card>
        )
      )}

      {/* 原有的空状态内容 */}
      <div className="empty-state">
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
    </div>
  )
}

export default EmptyConversation
