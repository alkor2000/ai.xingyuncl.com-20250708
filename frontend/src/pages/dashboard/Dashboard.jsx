import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Typography, Space, Tag, Alert, Spin } from 'antd'
import {
  BankOutlined,
  DollarOutlined,
  FireOutlined,
  InfoCircleOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAuthStore from '../../stores/authStore'
import apiClient from '../../utils/api'

const { Title, Paragraph } = Typography

const Dashboard = () => {
  const { user } = useAuthStore()
  const { t } = useTranslation()
  const [creditsData, setCreditsData] = useState(null)
  const [loading, setLoading] = useState(true)

  // 加载用户积分统计
  useEffect(() => {
    const fetchCreditsStats = async () => {
      try {
        setLoading(true)
        const response = await apiClient.get('/stats/user-credits')
        if (response.data.success) {
          setCreditsData(response.data.data)
        }
      } catch (error) {
        console.error('获取积分统计失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCreditsStats()
  }, [])

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '400px' 
      }}>
        <Spin size="large" tip={t('status.loading')} />
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={2} className="page-title">
          {t('dashboard.title')}
        </Title>
        <Paragraph type="secondary">
          {t('dashboard.welcome', { name: user?.username })}
        </Paragraph>
      </div>

      {/* 积分中心 */}
      <Card 
        title={
          <Space>
            <DollarOutlined style={{ color: '#52c41a' }} />
            {t('dashboard.creditsCenter.title')}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: 8 }}>
                <BankOutlined style={{ fontSize: 24, color: '#1677ff' }} />
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                {t('dashboard.creditsCenter.organization')}
              </div>
              <Tag color={creditsData?.group_color || '#1677ff'} style={{ fontSize: 14 }}>
                {creditsData?.group_name || t('dashboard.creditsCenter.defaultGroup')}
              </Tag>
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={t('dashboard.creditsCenter.totalCredits')}
                value={creditsData?.credits_total || 0}
                prefix={<DollarOutlined />}
                suffix={t('unit.credits')}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={t('dashboard.creditsCenter.currentCredits')}
                value={creditsData?.credits_remaining || 0}
                prefix={<DollarOutlined />}
                suffix={t('unit.credits')}
                valueStyle={{ 
                  color: creditsData?.credits_remaining > 0 ? '#52c41a' : '#ff4d4f' 
                }}
              />
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={t('dashboard.creditsCenter.todayConsumed')}
                value={creditsData?.today_consumed || 0}
                prefix={<FireOutlined />}
                suffix={t('unit.credits')}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Col>
        </Row>

        {/* 积分过期提醒 */}
        {creditsData?.is_expired && (
          <Alert
            message={t('dashboard.creditsCenter.expiredAlert')}
            type="error"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
        
        {!creditsData?.is_expired && creditsData?.remaining_days !== null && creditsData?.remaining_days <= 7 && (
          <Alert
            message={t('dashboard.creditsCenter.expiringSoon', { days: creditsData.remaining_days })}
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      {/* 系统公告 */}
      <Card 
        title={
          <Space>
            <InfoCircleOutlined style={{ color: '#1677ff' }} />
            {t('dashboard.announcement.system')}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message={t('dashboard.announcement.systemDefault')}
          type="info"
          showIcon={false}
        />
      </Card>

      {/* 机构公告 */}
      <Card 
        title={
          <Space>
            <WarningOutlined style={{ color: '#fa8c16' }} />
            {t('dashboard.announcement.organization')}
          </Space>
        }
      >
        <Alert
          message={t('dashboard.announcement.organizationDefault')}
          type="warning"
          showIcon={false}
        />
      </Card>
    </div>
  )
}

export default Dashboard
