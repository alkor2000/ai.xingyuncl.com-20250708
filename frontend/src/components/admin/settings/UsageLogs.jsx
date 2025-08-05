/**
 * 使用记录组件
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  DatePicker,
  Select,
  Tag,
  Row,
  Col,
  Statistic,
  message,
  Tooltip,
  Spin
} from 'antd'
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  UserOutlined,
  TeamOutlined,
  RobotOutlined,
  BarChartOutlined,
  TrophyOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'
import useAuthStore from '../../../stores/authStore'
import moment from 'moment'

const { Search } = Input
const { RangePicker } = DatePicker
const { Option } = Select

const UsageLogs = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    getUsageLogs,
    getUsageSummary,
    exportUsageLogs,
    getAIModels,
    getUserGroups,
    aiModels,
    userGroups
  } = useAdminStore()

  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [data, setData] = useState([])
  const [summary, setSummary] = useState(null)
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  })

  // 筛选条件
  const [filters, setFilters] = useState({
    search: '',
    groupId: null,
    modelName: null,
    dateRange: null
  })

  // 是否是超级管理员
  const isSuperAdmin = user?.role === 'super_admin'

  // 初始化加载
  useEffect(() => {
    loadData()
    loadSummary()
    getAIModels()
    if (isSuperAdmin) {
      getUserGroups()
    }
  }, [])

  // 加载使用记录
  const loadData = async (params = {}) => {
    setLoading(true)
    try {
      const queryParams = {
        page: params.current || pagination.current,
        pageSize: params.pageSize || pagination.pageSize,
        search: filters.search,
        groupId: filters.groupId,
        modelName: filters.modelName,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD'),
        ...params
      }

      const result = await getUsageLogs(queryParams)
      if (result) {
        setData(result.list || [])
        setPagination({
          ...pagination,
          ...result.pagination
        })
      }
    } catch (error) {
      message.error('加载使用记录失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载统计汇总
  const loadSummary = async () => {
    try {
      const queryParams = {
        groupId: filters.groupId,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD')
      }

      const result = await getUsageSummary(queryParams)
      if (result) {
        setSummary(result)
      }
    } catch (error) {
      console.error('加载统计汇总失败:', error)
    }
  }

  // 处理表格变化
  const handleTableChange = (newPagination) => {
    loadData({
      current: newPagination.current,
      pageSize: newPagination.pageSize
    })
  }

  // 处理搜索
  const handleSearch = (value) => {
    setFilters({ ...filters, search: value })
    loadData({ current: 1, search: value })
    loadSummary()
  }

  // 处理筛选变化
  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    loadData({ current: 1 })
    loadSummary()
  }

  // 刷新数据
  const handleRefresh = () => {
    loadData()
    loadSummary()
    message.success('数据已刷新')
  }

  // 导出Excel
  const handleExport = async () => {
    if (!isSuperAdmin) {
      message.warning('只有超级管理员可以导出数据')
      return
    }

    setExporting(true)
    try {
      const queryParams = {
        search: filters.search,
        groupId: filters.groupId,
        modelName: filters.modelName,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD')
      }

      await exportUsageLogs(queryParams)
      message.success('导出成功')
    } catch (error) {
      message.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  // 表格列定义
  const columns = [
    {
      title: '使用时间',
      dataIndex: 'usage_time',
      key: 'usage_time',
      width: 180,
      render: (time) => moment(time).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '用户',
      key: 'user',
      width: 200,
      render: (record) => (
        <Space direction="vertical" size={0}>
          <Space>
            <UserOutlined />
            <span>{record.username}</span>
          </Space>
          <span style={{ fontSize: 12, color: '#999' }}>{record.email}</span>
        </Space>
      )
    },
    {
      title: '所属组',
      dataIndex: 'group_name',
      key: 'group_name',
      width: 120,
      render: (name, record) => name ? (
        <Tag color={record.group_color || 'default'}>
          <TeamOutlined /> {name}
        </Tag>
      ) : '-'
    },
    {
      title: '使用模型',
      key: 'model',
      width: 200,
      render: (record) => (
        <Space>
          <RobotOutlined />
          <span>{record.model_display_name || record.model_name || '-'}</span>
          {record.model_provider && (
            <Tag size="small">{record.model_provider}</Tag>
          )}
        </Space>
      )
    },
    {
      title: '消耗积分',
      dataIndex: 'credits_consumed',
      key: 'credits_consumed',
      width: 100,
      align: 'right',
      render: (credits) => (
        <span style={{ color: '#f5222d', fontWeight: 'bold' }}>
          -{credits}
        </span>
      )
    },
    {
      title: '剩余积分',
      dataIndex: 'balance_after',
      key: 'balance_after',
      width: 100,
      align: 'right',
      render: (balance) => (
        <span style={{ color: balance > 0 ? '#52c41a' : '#999' }}>
          {balance}
        </span>
      )
    },
    {
      title: '会话',
      dataIndex: 'conversation_title',
      key: 'conversation_title',
      ellipsis: true,
      render: (title) => (
        <Tooltip title={title}>
          {title || '-'}
        </Tooltip>
      )
    }
  ]

  return (
    <div>
      {/* 统计汇总 */}
      {summary && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={4}>
            <Card>
              <Statistic
                title="独立用户"
                value={summary.summary?.unique_users || 0}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card>
              <Statistic
                title="使用次数"
                value={summary.summary?.total_transactions || 0}
                prefix={<BarChartOutlined />}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card>
              <Statistic
                title="总消耗积分"
                value={summary.summary?.total_credits_consumed || 0}
                valueStyle={{ color: '#f5222d' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card>
              <Statistic
                title="平均每次消耗"
                value={Math.round(summary.summary?.avg_credits_per_use || 0)}
                precision={0}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card>
              <Statistic
                title="活跃天数"
                value={summary.summary?.active_days || 0}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card>
              <Statistic
                title="使用模型数"
                value={summary.summary?.models_used || 0}
                prefix={<RobotOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* TOP用户 */}
      {summary?.topUsers && summary.topUsers.length > 0 && (
        <Card 
          title={<><TrophyOutlined /> TOP 10 用户</>}
          style={{ marginBottom: 24 }}
          bodyStyle={{ padding: '12px 24px' }}
        >
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
            {summary.topUsers.map((user, index) => (
              <div 
                key={user.user_id}
                style={{
                  minWidth: 150,
                  padding: 12,
                  background: index === 0 ? '#fff3e0' : '#f5f5f5',
                  borderRadius: 8,
                  textAlign: 'center'
                }}
              >
                <div style={{ 
                  fontSize: 20, 
                  fontWeight: 'bold',
                  color: index === 0 ? '#ff9800' : '#666'
                }}>
                  #{index + 1}
                </div>
                <div style={{ fontWeight: 'bold', marginTop: 8 }}>
                  {user.username}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  {user.group_name || '-'}
                </div>
                <div style={{ 
                  marginTop: 8, 
                  color: '#f5222d',
                  fontWeight: 'bold'
                }}>
                  {user.total_credits} 积分
                </div>
                <div style={{ fontSize: 12, color: '#999' }}>
                  {user.usage_count} 次使用
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 筛选和操作栏 */}
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Row gutter={16}>
            <Col span={6}>
              <Search
                placeholder="搜索用户名或邮箱"
                allowClear
                onSearch={handleSearch}
                style={{ width: '100%' }}
              />
            </Col>
            {isSuperAdmin && (
              <Col span={4}>
                <Select
                  placeholder="选择用户组"
                  allowClear
                  style={{ width: '100%' }}
                  onChange={(value) => handleFilterChange('groupId', value)}
                  value={filters.groupId}
                >
                  {userGroups.map(group => (
                    <Option key={group.id} value={group.id}>
                      {group.name}
                    </Option>
                  ))}
                </Select>
              </Col>
            )}
            <Col span={4}>
              <Select
                placeholder="选择模型"
                allowClear
                style={{ width: '100%' }}
                onChange={(value) => handleFilterChange('modelName', value)}
                value={filters.modelName}
              >
                {aiModels.map(model => (
                  <Option key={model.name} value={model.name}>
                    {model.display_name}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col span={6}>
              <RangePicker
                style={{ width: '100%' }}
                onChange={(dates) => handleFilterChange('dateRange', dates)}
                value={filters.dateRange}
              />
            </Col>
            <Col span={4}>
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleRefresh}
                >
                  刷新
                </Button>
                {isSuperAdmin && (
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    loading={exporting}
                    onClick={handleExport}
                  >
                    导出Excel
                  </Button>
                )}
              </Space>
            </Col>
          </Row>

          {/* 使用记录表格 */}
          <Table
            columns={columns}
            dataSource={data}
            rowKey="id"
            loading={loading}
            pagination={pagination}
            onChange={handleTableChange}
            scroll={{ x: 1200 }}
          />
        </Space>
      </Card>
    </div>
  )
}

export default UsageLogs
