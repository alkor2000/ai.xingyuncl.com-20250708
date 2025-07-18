/**
 * 用户详情抽屉组件
 */

import React from 'react'
import { 
  Drawer, 
  Card, 
  Row, 
  Col, 
  Tag, 
  Tabs,
  Divider
} from 'antd'
import {
  TrophyOutlined,
  DollarOutlined,
  CalendarOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'

const { TabPane } = Tabs

const UserDetailDrawer = ({
  visible,
  userDetail,
  onClose
}) => {
  const { t } = useTranslation()
  
  if (!userDetail) return null
  
  const { user, permissions } = userDetail
  
  const roleColors = {
    super_admin: 'red',
    admin: 'blue',
    user: 'green'
  }

  const statusColors = {
    active: 'green',
    inactive: 'red'
  }

  return (
    <Drawer
      title={t('admin.users.detail.title')}
      width={700}
      open={visible}
      onClose={onClose}
    >
      <Card title={t('admin.users.detail.basicInfo')} size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <div><strong>{t('admin.users.table.id')}:</strong> {user.id}</div>
          </Col>
          <Col span={12}>
            <div><strong>{t('admin.users.table.username')}:</strong> {user.username}</div>
          </Col>
          <Col span={12}>
            <div><strong>{t('admin.users.table.email')}:</strong> {user.email}</div>
          </Col>
          <Col span={12}>
            <div>
              <strong>{t('admin.users.table.role')}:</strong> 
              <Tag color={roleColors[user.role]} style={{ marginLeft: 8 }}>
                {t(`role.${user.role}`)}
              </Tag>
            </div>
          </Col>
          <Col span={12}>
            <div>
              <strong>{t('admin.users.table.group')}:</strong>
              {user.group_name ? (
                <Tag color={user.group_color} style={{ marginLeft: 8 }}>
                  {user.group_name}
                </Tag>
              ) : (
                <span style={{ marginLeft: 8, color: '#999' }}>{t('admin.users.noGroup')}</span>
              )}
            </div>
          </Col>
          <Col span={12}>
            <div>
              <strong>{t('admin.users.table.status')}:</strong>
              <Tag color={statusColors[user.status]} style={{ marginLeft: 8 }}>
                {t(`status.${user.status}`)}
              </Tag>
            </div>
          </Col>
          {user.remark && (
            <Col span={24}>
              <div style={{ marginTop: 8 }}>
                <strong>{t('admin.users.table.remark')}:</strong>
                <div style={{ 
                  marginTop: 4, 
                  padding: '8px 12px', 
                  background: '#f5f5f5', 
                  borderRadius: 4,
                  color: '#666'
                }}>
                  {user.remark}
                </div>
              </div>
            </Col>
          )}
          <Col span={24}>
            <div style={{ marginTop: 8 }}>
              <strong>{t('admin.users.table.createdAt')}:</strong> {moment(user.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </div>
          </Col>
          <Col span={24}>
            <div style={{ marginTop: 4 }}>
              <strong>{t('admin.users.detail.lastLogin')}:</strong> {
                user.last_login_at 
                  ? moment(user.last_login_at).format('YYYY-MM-DD HH:mm:ss')
                  : t('admin.users.detail.neverLogin')
              }
            </div>
          </Col>
        </Row>
      </Card>

      <Tabs defaultActiveKey="tokens" style={{ marginBottom: 16 }}>
        <TabPane tab={<span><TrophyOutlined />{t('admin.users.detail.tokenStats')}</span>} key="tokens">
          <Card size="small">
            <Row gutter={16} style={{ textAlign: 'center' }}>
              <Col span={8}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1677ff' }}>
                  {user.token_quota?.toLocaleString()}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.form.tokenQuota')}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>
                  {user.used_tokens?.toLocaleString()}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.detail.used')}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
                  {((user.token_quota || 0) - (user.used_tokens || 0)).toLocaleString()}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.detail.remaining')}</div>
              </Col>
            </Row>
          </Card>
        </TabPane>

        <TabPane tab={<span><DollarOutlined />{t('admin.users.detail.creditsStats')}</span>} key="credits">
          <Card size="small">
            <Row gutter={16} style={{ textAlign: 'center' }}>
              <Col span={8}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1677ff' }}>
                  {user.credits_quota?.toLocaleString()}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.form.creditsQuota')}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>
                  {user.used_credits?.toLocaleString()}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.detail.used')}</div>
              </Col>
              <Col span={8}>
                <div style={{ 
                  fontSize: 24, 
                  fontWeight: 'bold', 
                  color: user.credits_stats?.isExpired ? '#ff4d4f' : '#52c41a' 
                }}>
                  {user.credits_stats?.remaining?.toLocaleString() || 0}
                </div>
                <div style={{ color: '#666', fontSize: 12 }}>{t('admin.users.detail.remaining')}</div>
              </Col>
            </Row>
            <Divider />
            <Row gutter={16}>
              <Col span={24}>
                <div style={{ textAlign: 'center' }}>
                  <strong>{t('admin.users.credits.expire.title')}:</strong>
                  {user.credits_expire_at ? (
                    <div style={{ marginTop: 8 }}>
                      <CalendarOutlined style={{ marginRight: 8 }} />
                      {moment(user.credits_expire_at).format('YYYY-MM-DD HH:mm:ss')}
                      {user.credits_stats?.isExpired ? (
                        <Tag color="error" style={{ marginLeft: 8 }}>已过期</Tag>
                      ) : user.credits_stats?.remainingDays <= 7 ? (
                        <Tag color="warning" style={{ marginLeft: 8 }}>
                          {user.credits_stats.remainingDays}天后过期
                        </Tag>
                      ) : (
                        <Tag color="success" style={{ marginLeft: 8 }}>
                          剩余{user.credits_stats.remainingDays}天
                        </Tag>
                      )}
                    </div>
                  ) : (
                    <Tag color="success" style={{ marginTop: 8 }}>永不过期</Tag>
                  )}
                </div>
              </Col>
            </Row>
          </Card>
        </TabPane>
      </Tabs>

      <Card title={t('admin.users.detail.permissions')} size="small">
        <div>
          {permissions?.map(permission => (
            <Tag key={permission} style={{ marginBottom: 4 }}>
              {permission}
            </Tag>
          ))}
        </div>
      </Card>
    </Drawer>
  )
}

export default UserDetailDrawer
