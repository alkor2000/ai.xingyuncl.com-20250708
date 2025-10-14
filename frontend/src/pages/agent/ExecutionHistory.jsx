/**
 * Agent工作流执行历史页
 * 展示所有工作流的执行记录，支持查看详情、筛选
 */

import React, { useEffect, useState } from 'react'
import { 
  Card, 
  Table, 
  Space, 
  Tag, 
  Button,
  Select,
  Tooltip,
  Drawer,
  Descriptions,
  Timeline,
  Statistic,
  Row,
  Col,
  Popconfirm
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  EyeOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAgentStore from '../../stores/agentStore'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

dayjs.extend(duration)

const ExecutionHistory = () => {
  const { t } = useTranslation()
  
  const {
    executions,
    executionsLoading,
    executionsPagination,
    fetchExecutions,
    deleteExecution,
    currentExecution,
    fetchExecutionById
  } = useAgentStore()
  
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false)
  const [filterStatus, setFilterStatus] = useState(undefined)
  
  // 初始加载
  useEffect(() => {
    fetchExecutions({ current: 1 })
  }, [])
  
  // 查看详情
  const handleViewDetail = async (id) => {
    try {
      await fetchExecutionById(id)
      setDetailDrawerVisible(true)
    } catch (error) {
      console.error('获取详情失败:', error)
    }
  }
  
  // 删除记录
  const handleDelete = async (id) => {
    try {
      await deleteExecution(id)
    } catch (error) {
      console.error('删除失败:', error)
    }
  }
  
  // 状态筛选
  const handleFilterChange = (value) => {
    setFilterStatus(value)
    fetchExecutions({ current: 1, status: value })
  }
  
  // 状态标签渲染
  const renderStatusTag = (status) => {
    const statusMap = {
      running: { color: 'processing', icon: <SyncOutlined spin />, text: '运行中' },
      success: { color: 'success', icon: <CheckCircleOutlined />, text: '成功' },
      failed: { color: 'error', icon: <CloseCircleOutlined />, text: '失败' },
      cancelled: { color: 'default', icon: <CloseCircleOutlined />, text: '已取消' }
    }
    
    const config = statusMap[status] || statusMap.running
    
    return (
      <Tag color={config.color} icon={config.icon}>
        {config.text}
      </Tag>
    )
  }
  
  // 格式化时长
  const formatDuration = (ms) => {
    if (!ms) return '-'
    const d = dayjs.duration(ms)
    if (d.asMinutes() < 1) {
      return `${d.seconds()}秒`
    }
    return `${Math.floor(d.asMinutes())}分${d.seconds()}秒`
  }
  
  // 表格列定义
  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: '工作流名称',
      dataIndex: 'workflow_name',
      key: 'workflow_name',
      ellipsis: true
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: renderStatusTag
    },
    {
      title: '积分消耗',
      key: 'credits',
      width: 120,
      align: 'center',
      render: (_, record) => {
        const estimated = record.estimated_credits || 0
        const used = record.total_credits_used || 0
        
        return (
          <Tooltip title={`预估: ${estimated} / 实际: ${used}`}>
            <Space>
              <ThunderboltOutlined style={{ color: '#faad14' }} />
              {used}
            </Space>
          </Tooltip>
        )
      }
    },
    {
      title: '执行时长',
      key: 'duration',
      width: 120,
      render: (_, record) => {
        if (!record.completed_at) return '-'
        const start = dayjs(record.created_at)
        const end = dayjs(record.completed_at)
        const duration = end.diff(start)
        return formatDuration(duration)
      }
    },
    {
      title: '开始时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text) => dayjs(text).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '完成时间',
      dataIndex: 'completed_at',
      key: 'completed_at',
      width: 180,
      render: (text) => text ? dayjs(text).format('YYYY-MM-DD HH:mm:ss') : '-'
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleViewDetail(record.id)}
            />
          </Tooltip>
          
          <Popconfirm
            title="确定要删除这条记录吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]
  
  return (
    <div style={{ padding: '24px' }}>
      <Card
        title="执行历史"
        extra={
          <Space>
            <span>状态筛选:</span>
            <Select
              style={{ width: 120 }}
              placeholder="全部状态"
              allowClear
              value={filterStatus}
              onChange={handleFilterChange}
            >
              <Select.Option value="running">运行中</Select.Option>
              <Select.Option value="success">成功</Select.Option>
              <Select.Option value="failed">失败</Select.Option>
              <Select.Option value="cancelled">已取消</Select.Option>
            </Select>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={executions}
          rowKey="id"
          loading={executionsLoading}
          pagination={{
            current: executionsPagination.current,
            pageSize: executionsPagination.pageSize,
            total: executionsPagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              fetchExecutions({ current: page, pageSize, status: filterStatus })
            }
          }}
          scroll={{ x: 1400 }}
        />
      </Card>
      
      {/* 执行详情抽屉 */}
      <Drawer
        title="执行详情"
        placement="right"
        width={800}
        open={detailDrawerVisible}
        onClose={() => setDetailDrawerVisible(false)}
      >
        {currentExecution && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 基本信息 */}
            <Card title="基本信息" size="small">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="执行ID">
                  {currentExecution.id}
                </Descriptions.Item>
                <Descriptions.Item label="工作流">
                  {currentExecution.workflow_name}
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  {renderStatusTag(currentExecution.status)}
                </Descriptions.Item>
                <Descriptions.Item label="版本">
                  v{currentExecution.workflow_version}
                </Descriptions.Item>
                <Descriptions.Item label="开始时间" span={2}>
                  {dayjs(currentExecution.created_at).format('YYYY-MM-DD HH:mm:ss')}
                </Descriptions.Item>
                <Descriptions.Item label="完成时间" span={2}>
                  {currentExecution.completed_at 
                    ? dayjs(currentExecution.completed_at).format('YYYY-MM-DD HH:mm:ss')
                    : '-'
                  }
                </Descriptions.Item>
                {currentExecution.error_message && (
                  <Descriptions.Item label="错误信息" span={2}>
                    <span style={{ color: '#ff4d4f' }}>
                      {currentExecution.error_message}
                    </span>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
            
            {/* 积分统计 */}
            <Card title="积分消耗" size="small">
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic 
                    title="预估积分" 
                    value={currentExecution.estimated_credits || 0}
                    prefix={<ThunderboltOutlined />}
                  />
                </Col>
                <Col span={8}>
                  <Statistic 
                    title="实际消耗" 
                    value={currentExecution.total_credits_used || 0}
                    prefix={<ThunderboltOutlined />}
                    valueStyle={{ color: '#faad14' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic 
                    title="节省积分" 
                    value={(currentExecution.estimated_credits || 0) - (currentExecution.total_credits_used || 0)}
                    prefix={<ThunderboltOutlined />}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
              </Row>
            </Card>
            
            {/* 输入数据 */}
            {currentExecution.input_data && (
              <Card title="输入数据" size="small">
                <pre style={{ 
                  background: '#f5f5f5', 
                  padding: '12px', 
                  borderRadius: '4px',
                  maxHeight: '200px',
                  overflow: 'auto'
                }}>
                  {JSON.stringify(currentExecution.input_data, null, 2)}
                </pre>
              </Card>
            )}
            
            {/* 输出数据 */}
            {currentExecution.output_data && (
              <Card title="输出数据" size="small">
                <pre style={{ 
                  background: '#f5f5f5', 
                  padding: '12px', 
                  borderRadius: '4px',
                  maxHeight: '200px',
                  overflow: 'auto'
                }}>
                  {JSON.stringify(currentExecution.output_data, null, 2)}
                </pre>
              </Card>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}

export default ExecutionHistory
