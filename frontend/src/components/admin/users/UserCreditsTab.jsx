/**
 * 用户积分管理标签页组件
 */

import React from 'react'
import {
  Alert,
  Descriptions,
  Tag,
  Divider,
  Form,
  Select,
  InputNumber,
  Input,
  Timeline,
  Space
} from 'antd'
import {
  CalendarOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
  WalletOutlined,
  ClockCircleOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'

const UserCreditsTab = ({
  userCredits = {},
  creditHistory = [],
  historyLoading = false,
  form
}) => {
  const { t } = useTranslation()
  
  const creditsStats = userCredits.credits_stats || {}

  return (
    <>
      {/* 当前积分信息 */}
      <Alert
        message={t('admin.users.credits.currentInfo')}
        description={
          <Descriptions column={2} size="small" style={{ marginTop: 8 }}>
            <Descriptions.Item label={t('admin.users.credits.currentBalance')}>
              <span style={{ 
                fontSize: 18, 
                fontWeight: 'bold', 
                color: creditsStats.isExpired ? '#ff4d4f' : '#52c41a' 
              }}>
                {creditsStats.remaining?.toLocaleString() || 0}
              </span>
              {creditsStats.isExpired && (
                <Tag color="error" style={{ marginLeft: 8 }}>已过期</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.users.credits.quota')}>
              {userCredits.credits_quota?.toLocaleString() || 0}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.users.credits.used')}>
              {userCredits.used_credits?.toLocaleString() || 0}
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.users.credits.usageRate')}>
              {creditsStats.usageRate || 0}%
            </Descriptions.Item>
            <Descriptions.Item label={t('admin.users.credits.expireAt')} span={2}>
              {userCredits.credits_expire_at ? (
                <Space>
                  <CalendarOutlined />
                  {moment(userCredits.credits_expire_at).format('YYYY-MM-DD HH:mm:ss')}
                  {creditsStats.remainingDays !== null && (
                    <Tag color={
                      creditsStats.isExpired ? 'error' :
                      creditsStats.remainingDays <= 7 ? 'warning' : 'success'
                    }>
                      {creditsStats.isExpired 
                        ? '已过期' 
                        : `剩余${creditsStats.remainingDays}天`
                      }
                    </Tag>
                  )}
                </Space>
              ) : (
                <Tag color="success">永不过期</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
        }
        type={creditsStats.isExpired ? 'error' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 积分操作 */}
      <Divider>{t('admin.users.credits.operation')}</Divider>
      
      <Form.Item 
        name="creditsOperation" 
        label={t('admin.users.credits.operationType')}
      >
        <Select placeholder={t('admin.users.credits.selectOperation')}>
          <Select.Option value="add">
            <Space>
              <PlusCircleOutlined style={{ color: '#52c41a' }} />
              {t('admin.credits.recharge')}
            </Space>
          </Select.Option>
          <Select.Option value="deduct">
            <Space>
              <MinusCircleOutlined style={{ color: '#ff4d4f' }} />
              {t('admin.credits.deduct')}
            </Space>
          </Select.Option>
          <Select.Option value="set">
            <Space>
              <WalletOutlined style={{ color: '#1677ff' }} />
              {t('admin.credits.setQuota')}
            </Space>
          </Select.Option>
        </Select>
      </Form.Item>

      <Form.Item 
        noStyle
        shouldUpdate={(prevValues, currentValues) => 
          prevValues.creditsOperation !== currentValues.creditsOperation
        }
      >
        {({ getFieldValue }) => {
          const operation = getFieldValue('creditsOperation')
          if (!operation) return null

          return (
            <>
              <Form.Item
                name="creditsAmount"
                label={operation === 'set' ? t('admin.credits.form.newQuota') : t('admin.credits.form.amount')}
                rules={[
                  { required: true, message: t('admin.credits.form.amount.required') },
                  { pattern: /^\d+$/, message: t('admin.credits.form.amount.invalid') }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={operation === 'set' ? 1000000 : 100000}
                  placeholder={operation === 'set' ? t('admin.credits.form.newQuota') : t('admin.credits.form.amount')}
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                />
              </Form.Item>

              {operation === 'add' && (
                <Form.Item
                  name="extend_days"
                  label={t('admin.credits.form.extendDays')}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    max={3650}
                    placeholder={t('admin.credits.form.extendDays.placeholder')}
                  />
                </Form.Item>
              )}

              <Form.Item
                name="creditsReason"
                label={t('admin.credits.form.reason')}
                rules={[{ required: true, message: t('admin.credits.form.reason.required') }]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder={t('admin.credits.form.reason.placeholder')}
                  showCount
                  maxLength={200}
                />
              </Form.Item>
            </>
          )
        }}
      </Form.Item>

      {/* 积分历史 */}
      <Divider>{t('admin.users.credits.history')}</Divider>
      
      <Timeline loading={historyLoading}>
        {creditHistory.length > 0 ? (
          creditHistory.map((record) => (
            <Timeline.Item 
              key={record.id}
              color={record.amount > 0 ? 'green' : 'red'}
              dot={<ClockCircleOutlined />}
            >
              <div>
                <strong>{moment(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</strong>
              </div>
              <div>
                <Tag color={record.amount > 0 ? 'green' : 'red'}>
                  {record.amount > 0 ? '+' : ''}{record.amount}
                </Tag>
                <span style={{ marginLeft: 8 }}>{record.description}</span>
              </div>
              {record.operator_name && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  <UserOutlined /> {t('admin.users.credits.operator')}: {record.operator_name}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#999' }}>
                {t('admin.users.credits.balanceAfter')}: {record.balance_after}
              </div>
            </Timeline.Item>
          ))
        ) : (
          <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
            {t('admin.users.credits.noHistory')}
          </div>
        )}
      </Timeline>
    </>
  )
}

export default UserCreditsTab
