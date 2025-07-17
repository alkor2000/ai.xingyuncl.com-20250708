/**
 * 系统统计组件
 */

import React from 'react'
import { Row, Col, Card, Statistic, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

const SystemStats = ({ systemStats = {} }) => {
  const { t } = useTranslation()
  
  const { users = {}, conversations = {}, models = [] } = systemStats

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
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {models.length > 0 ? (
              models.map((model, index) => (
                <div 
                  key={model.model_name} 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: index < models.length - 1 ? '1px solid #f0f0f0' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>#{index + 1} {model.model_name}</span>
                    {model.credits_per_chat && (
                      <Tag color="blue" size="small">
                        💰 {model.credits_per_chat} {t('admin.models.perChat')}
                      </Tag>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span>{model.conversation_count} {t('admin.settings.conversations')}</span>
                    {model.total_credits_consumed && (
                      <span style={{ color: '#722ed1' }}>
                        🪙 {model.total_credits_consumed?.toLocaleString()} {t('unit.credits', { defaultValue: '积分' })}
                      </span>
                    )}
                    <span style={{ color: '#999' }}>
                      {model.total_tokens?.toLocaleString()} {t('unit.tokens')}
                    </span>
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
