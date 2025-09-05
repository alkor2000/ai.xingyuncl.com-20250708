/**
 * 组邀请码使用记录Modal组件
 */

import React, { useState, useEffect } from 'react'
import { 
  Modal, 
  Table, 
  Tag, 
  Space, 
  Button,
  message,
  Empty
} from 'antd'
import { 
  UserOutlined,
  MailOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'
import apiClient from '../../../utils/api'

const GroupInvitationLogsModal = ({
  visible,
  group,
  onCancel
}) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  })

  // 获取邀请记录
  const fetchLogs = async (page = 1) => {
    if (!group) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/user-groups/${group.id}/invitation-logs`, {
        params: {
          page,
          limit: pagination.pageSize
        }
      })

      if (response.data?.success) {
        setLogs(response.data.data.logs || [])
        setPagination({
          ...pagination,
          current: page,
          total: response.data.data.pagination?.total || 0
        })
      }
    } catch (error) {
      console.error('获取邀请记录失败:', error)
      message.error('获取邀请记录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible && group) {
      fetchLogs(1)
    }
  }, [visible, group])

  // 处理分页变化
  const handleTableChange = (newPagination) => {
    fetchLogs(newPagination.current)
  }

  // 刷新记录
  const handleRefresh = () => {
    fetchLogs(pagination.current)
    message.success('已刷新')
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: '使用者',
      key: 'user',
      render: (_, record) => (
        <Space direction="vertical" size="small">
          <Space>
            <UserOutlined />
            <span>{record.username || 'Unknown'}</span>
          </Space>
          {record.email && (
            <Space style={{ fontSize: '12px', color: '#666' }}>
              <MailOutlined />
              <span>{record.email}</span>
            </Space>
          )}
        </Space>
      )
    },
    {
      title: '邀请码',
      dataIndex: 'invitation_code',
      key: 'invitation_code',
      render: (code) => (
        <Tag style={{ fontFamily: 'monospace' }}>{code}</Tag>
      )
    },
    {
      title: 'IP地址',
      dataIndex: 'ip_address',
      key: 'ip_address',
      render: (ip) => (
        <Space>
          <GlobalOutlined />
          <span>{ip || '未知'}</span>
        </Space>
      )
    },
    {
      title: '使用时间',
      dataIndex: 'used_at',
      key: 'used_at',
      render: (time) => (
        <Space direction="vertical" size="small">
          <Space>
            <ClockCircleOutlined />
            <span>{moment(time).format('YYYY-MM-DD HH:mm:ss')}</span>
          </Space>
          <span style={{ fontSize: '11px', color: '#999' }}>
            {moment(time).fromNow()}
          </span>
        </Space>
      )
    }
  ]

  return (
    <Modal
      title={
        <Space>
          <span>邀请码使用记录 - {group?.name}</span>
          {group?.invitation_code && (
            <Tag style={{ fontFamily: 'monospace' }}>{group.invitation_code}</Tag>
          )}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={900}
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={handleRefresh}>
          刷新
        </Button>,
        <Button key="close" type="primary" onClick={onCancel}>
          关闭
        </Button>
      ]}
    >
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        onChange={handleTableChange}
        locale={{
          emptyText: (
            <Empty 
              description="暂无邀请记录" 
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )
        }}
      />
    </Modal>
  )
}

export default GroupInvitationLogsModal
