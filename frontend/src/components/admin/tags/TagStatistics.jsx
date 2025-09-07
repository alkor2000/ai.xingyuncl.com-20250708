/**
 * 标签统计组件 - 显示标签使用情况统计
 */

import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Table, 
  Tag, 
  Progress,
  Empty,
  Spin,
  Space,  // 添加Space导入
  message
} from 'antd'
import {
  TagsOutlined,
  TeamOutlined,
  PieChartOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import apiClient from '../../../utils/api'

const TagStatistics = ({ groupId }) => {
  const [loading, setLoading] = useState(false)
  const [statistics, setStatistics] = useState(null)

  // 加载统计数据
  const loadStatistics = async () => {
    if (!groupId) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/user-tags/statistics/${groupId}`)
      setStatistics(response.data.data)
    } catch (error) {
      message.error('加载统计数据失败')
      console.error('加载统计失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatistics()
  }, [groupId])

  if (!statistics) {
    return (
      <Card>
        <Spin spinning={loading}>
          <Empty description="暂无统计数据" />
        </Spin>
      </Card>
    )
  }

  // 计算最大使用人数（用于进度条）
  const maxUserCount = Math.max(...(statistics.tags?.map(t => t.user_count) || [1]))

  // 表格列定义
  const columns = [
    {
      title: '标签',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Tag color={record.color}>
          {text}
        </Tag>
      )
    },
    {
      title: '使用人数',
      dataIndex: 'user_count',
      key: 'user_count',
      width: 120,
      sorter: (a, b) => a.user_count - b.user_count,
      render: (count) => (
        <Space>
          <TeamOutlined />
          <span>{count}</span>
        </Space>
      )
    },
    {
      title: '使用率',
      key: 'usage_rate',
      width: 200,
      render: (_, record) => {
        const percent = maxUserCount > 0 
          ? Math.round((record.user_count / maxUserCount) * 100)
          : 0
        return (
          <Progress 
            percent={percent} 
            size="small"
            strokeColor={{
              '0%': record.color,
              '100%': record.color
            }}
          />
        )
      }
    },
    {
      title: '用户列表',
      dataIndex: 'user_names',
      key: 'user_names',
      ellipsis: true,
      render: (names) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {names || '暂无用户'}
        </span>
      )
    }
  ]

  return (
    <Spin spinning={loading}>
      <Row gutter={16}>
        <Col span={24}>
          <Card 
            title={
              <Space>
                <PieChartOutlined />
                <span>标签使用统计</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="标签总数"
                  value={statistics.total_tags || 0}
                  prefix={<TagsOutlined />}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="已使用标签"
                  value={statistics.tags?.filter(t => t.user_count > 0).length || 0}
                  prefix={<BarChartOutlined />}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="标签覆盖用户"
                  value={
                    statistics.tags?.reduce((sum, t) => sum + t.user_count, 0) || 0
                  }
                  prefix={<TeamOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card title="标签详细统计">
        {statistics.tags && statistics.tags.length > 0 ? (
          <Table
            dataSource={statistics.tags}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        ) : (
          <Empty 
            description="暂无标签数据"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>
    </Spin>
  )
}

export default TagStatistics
