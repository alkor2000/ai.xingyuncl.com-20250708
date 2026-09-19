/**
 * 系统统计组件
 */

import React from 'react'
import { Row, Col, Card, Statistic, Tag, Tooltip } from 'antd'
import { 
  RobotOutlined, 
  PictureOutlined,
  MessageOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const SystemStats = ({ systemStats = {} }) => {
  const { t } = useTranslation()
  
  const { users = {}, conversations = {}, models = [] } = systemStats

  // 获取模型图标
  const getModelIcon = (modelType) => {
    if (modelType === 'image') {
      return <PictureOutlined style={{ marginRight: 8, color: '#ff6b6b' }} />
    }
    return <RobotOutlined style={{ marginRight: 8, color: '#1890ff' }} />
  }

  // 获取模型类型标签
  const getModelTypeTag = (modelType) => {
    if (modelType === 'image') {
      return <Tag color="volcano" size="small">图像</Tag>
    }
    return <Tag color="blue" size="small">对话</Tag>
  }

  return (
    <Row gutter={[16, 16]}>
      {/* 用户统计 */}
      <Col xs={24} lg={12}>
        <Card title={t('admin.settings.userStats')} size="small">
          <Row gutter={16}>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.totalUsers')} 
                value={users.total_users || 0} 
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.activeUsers')} 
                value={users.active_users || 0} 
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.totalCreditsQuota')} 
                value={users.total_credits_quota || 0} 
                valueStyle={{ color: '#722ed1' }}
                formatter={value => value?.toLocaleString()}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.totalCreditsUsed')} 
                value={users.total_credits_used || 0} 
                valueStyle={{ color: '#fa8c16' }}
                formatter={value => value?.toLocaleString()}
              />
            </Col>
          </Row>
        </Card>
      </Col>

      {/* 对话统计 */}
      <Col xs={24} lg={12}>
        <Card title={t('admin.settings.conversationStats')} size="small">
          <Row gutter={16}>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.totalConversations')} 
                value={conversations.total_conversations || 0} 
                valueStyle={{ color: '#1677ff' }}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title={t('admin.settings.totalMessages')} 
                value={conversations.total_messages || 0} 
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={24}>
              <Statistic 
                title={t('admin.settings.avgMessagesPerConversation')} 
                value={conversations.avg_messages_per_conversation || 0} 
                precision={1}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Col>
          </Row>
        </Card>
      </Col>

      {/* 模型使用统计 */}
      <Col xs={24}>
        <Card title={t('admin.settings.modelUsage')} size="small">
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {models.length > 0 ? (
              models.map((model, index) => (
                <div 
                  key={`${model.model_type}_${model.id}`} 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: index < models.length - 1 ? '1px solid #f0f0f0' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    {getModelIcon(model.model_type)}
                    <span style={{ fontWeight: 500 }}>
                      #{index + 1} {model.display_name || model.model_name}
                    </span>
                    {getModelTypeTag(model.model_type)}
                    {model.credits_per_use && (
                      <Tag color="blue" size="small">
                        💰 {model.credits_per_use} {t('admin.models.perChat')}
                      </Tag>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {model.model_type === 'chat' ? (
                      <>
                        <Tooltip title="对话数">
                          <span style={{ color: '#1890ff' }}>
                            <MessageOutlined /> {model.conversation_count || 0} {t('admin.settings.conversations')}
                          </span>
                        </Tooltip>
                        {model.total_tokens > 0 && (
                          <span style={{ color: '#999' }}>
                            {model.total_tokens?.toLocaleString()} 词元
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <Tooltip title="生成数">
                          <span style={{ color: '#ff6b6b' }}>
                            <PictureOutlined /> {model.generation_count || 0} 张
                          </span>
                        </Tooltip>
                      </>
                    )}
                    {model.total_credits_consumed > 0 && (
                      <Tooltip title="总消耗积分">
                        <span style={{ color: '#722ed1', fontWeight: 500 }}>
                          🪙 {model.total_credits_consumed?.toLocaleString()} {t('unit.credits', { defaultValue: '积分' })}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                {t('message.noData')}
              </div>
            )}
          </div>
        </Card>
      </Col>
    </Row>
  )
}

export default SystemStats
