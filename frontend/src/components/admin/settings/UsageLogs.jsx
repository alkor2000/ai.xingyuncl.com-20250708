/**
 * 使用记录组件 v2.2
 * 
 * v2.0 - 去掉TOP10排行榜，新增ECharts积分消耗柱状图
 * v2.1 - 图表视觉优化：配色、Tooltip、圆角
 * v2.2 - 图表深度优化：
 *   1. X轴标签自适应间隔：按小时时只显示部分标签，避免拥挤
 *   2. 柱子宽度根据数据量自适应（数据多时更细）
 *   3. 图表高度加大到420px，给底部留足空间
 *   4. dataZoom滑块支持大数据量时拖拽查看
 *   5. 空数据时显示友好提示
 *   6. 顶部柱子统一圆角
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Card, Table, Button, Space, Input, DatePicker, Select, Tag,
  Row, Col, Statistic, message, Tooltip, Spin, Segmented, Empty
} from 'antd'
import {
  SearchOutlined, ReloadOutlined, DownloadOutlined,
  UserOutlined, TeamOutlined, RobotOutlined,
  BarChartOutlined, EyeOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import * as echarts from 'echarts'
import useAdminStore from '../../../stores/adminStore'
import useAuthStore from '../../../stores/authStore'
import moment from 'moment'
import ConversationContentDrawer from './ConversationContentDrawer'
import apiClient from '../../../utils/api'

const { Search } = Input
const { RangePicker } = DatePicker
const { Option } = Select

/** 20+1种高区分度柔和配色 */
const CHART_COLORS = [
  '#5B8FF9', '#5AD8A6', '#F6BD16', '#E86452', '#6DC8EC',
  '#945FB9', '#FF9845', '#1E9493', '#FF99C3', '#269A99',
  '#BDD2FD', '#BEDED1', '#C2C8D5', '#EFE0B5', '#F2CEC7',
  '#D3CEFD', '#FFD8B8', '#AAD8D8', '#FFD6E7', '#C9E2B3',
  '#BFBFBF'
]

const UsageLogs = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    getUsageLogs, getUsageSummary, exportUsageLogs,
    getAIModels, getUserGroups, aiModels, userGroups
  } = useAdminStore()

  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [data, setData] = useState([])
  const [summary, setSummary] = useState(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState({ search: '', groupId: null, modelName: null, dateRange: null })
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [canViewChat, setCanViewChat] = useState(false)
  const [permissionChecked, setPermissionChecked] = useState(false)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartGranularity, setChartGranularity] = useState('day')
  const [chartEmpty, setChartEmpty] = useState(false)
  const chartRef = useRef(null)
  const chartInstance = useRef(null)

  const isSuperAdmin = user?.role === 'super_admin'
  const isGroupAdmin = user?.role === 'admin'

  /* 权限检查 */
  const checkViewChatPermission = async () => {
    try {
      if (isSuperAdmin) { setCanViewChat(true); setPermissionChecked(true); return }
      if (isGroupAdmin) {
        const response = await apiClient.get('/admin/usage-logs/can-view-chat')
        if (response.data?.data) setCanViewChat(response.data.data.canView)
      }
    } catch (error) { setCanViewChat(false) }
    finally { setPermissionChecked(true) }
  }

  /* 初始化 */
  useEffect(() => {
    loadData(); loadSummary(); loadChart()
    getAIModels()
    if (isSuperAdmin) getUserGroups()
    checkViewChatPermission()
  }, [])

  useEffect(() => { loadChart() }, [chartGranularity, filters.groupId, filters.dateRange])

  /* 初始化/销毁ECharts */
  useEffect(() => {
    if (chartRef.current) {
      chartInstance.current = echarts.init(chartRef.current)
      const handleResize = () => chartInstance.current?.resize()
      window.addEventListener('resize', handleResize)
      return () => { window.removeEventListener('resize', handleResize); chartInstance.current?.dispose() }
    }
  }, [])

  /* ========== 数据加载 ========== */

  const loadData = async (params = {}) => {
    setLoading(true)
    try {
      const queryParams = {
        page: params.current || pagination.current,
        pageSize: params.pageSize || pagination.pageSize,
        search: filters.search, groupId: filters.groupId, modelName: filters.modelName,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD'),
        ...params
      }
      const result = await getUsageLogs(queryParams)
      if (result) { setData(result.list || []); setPagination({ ...pagination, ...result.pagination }) }
    } catch (error) { message.error('加载使用记录失败') }
    finally { setLoading(false) }
  }

  const loadSummary = async () => {
    try {
      const result = await getUsageSummary({
        groupId: filters.groupId,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD')
      })
      if (result) setSummary(result)
    } catch (error) { console.error('加载统计汇总失败:', error) }
  }

  /** 加载柱状图 */
  const loadChart = async () => {
    setChartLoading(true)
    setChartEmpty(false)
    try {
      const startDate = filters.dateRange?.[0]?.format('YYYY-MM-DD')
        || moment().subtract(6, 'days').format('YYYY-MM-DD')
      const endDate = filters.dateRange?.[1]?.format('YYYY-MM-DD')
        || moment().format('YYYY-MM-DD')

      const response = await apiClient.get('/admin/usage-logs/chart', {
        params: { granularity: chartGranularity, startDate, endDate, groupId: filters.groupId || undefined }
      })

      if (response.data?.success && chartInstance.current) {
        const { timeLabels, series, mode } = response.data.data
        if (!timeLabels || timeLabels.length === 0) {
          setChartEmpty(true)
          chartInstance.current.clear()
        } else {
          renderChart(timeLabels, series, mode)
        }
      }
    } catch (error) { console.error('加载柱状图失败:', error) }
    finally { setChartLoading(false) }
  }

  /**
   * 渲染ECharts堆叠柱状图 v2.2
   * 
   * 关键优化：
   * - X轴标签根据数据量自适应间隔（>30个时每隔N个显示1个）
   * - 柱宽根据数据量自适应（少则粗，多则细）
   * - 数据量>40时启用底部 dataZoom 滑块
   * - 堆叠最顶部的柱子显示圆角
   */
  const renderChart = (timeLabels, series, mode) => {
    if (!chartInstance.current) return

    const count = timeLabels.length

    /* 自适应X轴标签间隔 */
    let labelInterval = 0 /* 默认全部显示 */
    if (count > 60) labelInterval = 5
    else if (count > 40) labelInterval = 3
    else if (count > 20) labelInterval = 2
    else if (count > 12) labelInterval = 1

    /* 自适应柱宽 */
    let barMaxWidth = 40
    if (count > 60) barMaxWidth = 12
    else if (count > 30) barMaxWidth = 20
    else if (count > 15) barMaxWidth = 30

    /* 是否启用dataZoom（数据量大时） */
    const useZoom = count > 40

    const option = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.03)' } },
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: '#e8e8e8',
        borderWidth: 1,
        textStyle: { color: '#333', fontSize: 13 },
        extraCssText: 'box-shadow: 0 4px 20px rgba(0,0,0,0.12); border-radius: 8px; padding: 12px 16px;',
        formatter: (params) => {
          if (!params || params.length === 0) return ''
          let total = 0
          let html = `<div style="font-weight:600;font-size:14px;margin-bottom:8px;color:#1a1a1a">${params[0].axisValue}</div>`
          const sorted = [...params].filter(p => p.value > 0).sort((a, b) => b.value - a.value)
          sorted.forEach(p => {
            total += p.value
            html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;margin:3px 0">`
            html += `<span style="display:flex;align-items:center;gap:6px">${p.marker}<span style="color:#555">${p.seriesName}</span></span>`
            html += `<span style="font-weight:600;color:#222;font-variant-numeric:tabular-nums">${p.value.toLocaleString()}</span>`
            html += `</div>`
          })
          if (sorted.length > 0) {
            html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between">`
            html += `<span style="font-weight:600;color:#1a1a1a">总计</span>`
            html += `<span style="font-weight:700;color:#f5222d;font-size:15px">${total.toLocaleString()}</span>`
            html += `</div>`
          }
          return html
        }
      },
      legend: {
        type: 'scroll',
        bottom: useZoom ? 36 : 0,
        itemWidth: 14,
        itemHeight: 10,
        itemGap: 16,
        borderRadius: 2,
        textStyle: { fontSize: 12, color: '#666' }
      },
      grid: {
        left: 56,
        right: 16,
        top: 20,
        bottom: useZoom ? 90 : 50
      },
      /* v2.2: 数据量大时启用底部缩放滑块 */
      dataZoom: useZoom ? [{
        type: 'slider',
        bottom: 56,
        height: 20,
        start: Math.max(0, 100 - (40 / count * 100)),
        end: 100,
        borderColor: '#e8e8e8',
        fillerColor: 'rgba(91,143,249,0.15)',
        handleStyle: { color: '#5B8FF9', borderColor: '#5B8FF9' },
        textStyle: { fontSize: 11, color: '#999' },
        brushSelect: false
      }] : [],
      xAxis: {
        type: 'category',
        data: timeLabels,
        axisLine: { lineStyle: { color: '#e0e0e0' } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: '#888',
          interval: labelInterval,
          rotate: count > 12 ? 40 : 0,
          margin: 12
        }
      },
      yAxis: {
        type: 'value',
        name: '积分',
        nameTextStyle: { fontSize: 11, color: '#aaa', padding: [0, 0, 0, -16] },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: {
          fontSize: 11,
          color: '#aaa',
          formatter: (v) => {
            if (v >= 10000) return `${(v / 10000).toFixed(1)}万`
            if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
            return v
          }
        }
      },
      series: series.map((s, i) => ({
        name: s.name,
        type: 'bar',
        stack: 'total',
        data: s.data,
        barMaxWidth: barMaxWidth,
        barMinWidth: 4,
        /* v2.2: 最顶层系列显示圆角（视觉上堆叠顶部圆润） */
        itemStyle: {
          color: CHART_COLORS[i % CHART_COLORS.length],
          borderRadius: i === 0 ? [4, 4, 0, 0] : [0, 0, 0, 0]
        },
        emphasis: {
          focus: 'series',
          itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.12)' }
        }
      })),
      animationDuration: 500,
      animationEasing: 'cubicOut'
    }

    chartInstance.current.setOption(option, true)
  }

  /* ========== 事件处理 ========== */

  const handleTableChange = (p) => { loadData({ current: p.current, pageSize: p.pageSize }) }
  const handleSearch = (value) => {
    setFilters({ ...filters, search: value }); loadData({ current: 1, search: value }); loadSummary()
  }
  const handleFilterChange = (key, value) => {
    setFilters({ ...filters, [key]: value }); loadData({ current: 1 }); loadSummary()
  }
  const handleRefresh = () => { loadData(); loadSummary(); loadChart(); message.success('数据已刷新') }
  const handleExport = async () => {
    if (!isSuperAdmin) { message.warning('只有超级管理员可以导出数据'); return }
    setExporting(true)
    try {
      await exportUsageLogs({
        search: filters.search, groupId: filters.groupId, modelName: filters.modelName,
        startDate: filters.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: filters.dateRange?.[1]?.format('YYYY-MM-DD')
      })
      message.success('导出成功')
    } catch (error) { message.error('导出失败') }
    finally { setExporting(false) }
  }
  const handleViewConversation = (record) => {
    if (!record.related_conversation_id) { message.warning('该记录没有关联的对话'); return }
    setSelectedConversationId(record.related_conversation_id); setDrawerVisible(true)
  }

  /* ========== 表格列 ========== */

  const columns = useMemo(() => {
    const cols = [
      {
        title: '使用时间', dataIndex: 'usage_time', key: 'usage_time', width: 170, fixed: 'left',
        render: (time) => moment(time).format('YYYY-MM-DD HH:mm:ss')
      },
      {
        title: '用户', key: 'user', width: 200, fixed: 'left',
        render: (record) => (
          <Space direction="vertical" size={0}>
            <Space><UserOutlined /><span>{record.username}</span></Space>
            <span style={{ fontSize: 12, color: '#999' }}>{record.email}</span>
          </Space>
        )
      },
      {
        title: '所属组', dataIndex: 'group_name', key: 'group_name', width: 120,
        render: (name, record) => name ? <Tag color={record.group_color || 'default'}><TeamOutlined /> {name}</Tag> : '-'
      },
      {
        title: '使用模型', key: 'model', width: 200,
        render: (record) => (
          <Space>
            <RobotOutlined />
            <span>{record.model_display_name || record.model_name || '-'}</span>
            {record.model_provider && <Tag size="small">{record.model_provider}</Tag>}
          </Space>
        )
      },
      {
        title: '消耗积分', dataIndex: 'credits_consumed', key: 'credits_consumed', width: 100, align: 'right',
        render: (c) => <span style={{ color: '#f5222d', fontWeight: 'bold' }}>-{c}</span>
      },
      {
        title: '剩余积分', dataIndex: 'balance_after', key: 'balance_after', width: 100, align: 'right',
        render: (b) => <span style={{ color: b > 0 ? '#52c41a' : '#999' }}>{b}</span>
      },
      {
        title: '会话', dataIndex: 'conversation_title', key: 'conversation_title', width: 120, fixed: 'right', ellipsis: true,
        render: (title, record) => {
          if (title) return <Tooltip title={title}>{title}</Tooltip>
          if (record.related_conversation_id && !record.conversation_exists)
            return <span style={{ color: '#faad14', fontSize: 12 }}>已删除</span>
          return <span style={{ color: '#ccc' }}>-</span>
        }
      }
    ]

    if (canViewChat) {
      cols.push({
        title: '内容', key: 'content', width: 80, fixed: 'right', align: 'center',
        render: (_, record) => {
          if (record.related_conversation_id && record.conversation_exists)
            return <Button type="link" size="small" icon={<EyeOutlined />}
              onClick={() => handleViewConversation(record)} style={{ color: '#ff4d4f' }}>查看</Button>
          if (record.related_conversation_id && !record.conversation_exists)
            return <Tooltip title="该对话已被用户删除"><Button type="text" size="small" icon={<EyeOutlined />} disabled>已删除</Button></Tooltip>
          return <Tooltip title="非对话类消费"><span style={{ color: '#ccc' }}>-</span></Tooltip>
        }
      })
    }
    return cols
  }, [canViewChat])

  const tableScrollX = canViewChat ? 1300 : 1220

  return (
    <div>
      {/* 统计卡片 */}
      {summary && (
        <Row gutter={16} style={{ marginBottom: 20 }}>
          <Col span={6}>
            <Card size="small"><Statistic title="使用次数" value={summary.summary?.total_transactions || 0} prefix={<BarChartOutlined />} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="总消耗积分" value={summary.summary?.total_credits_consumed || 0} valueStyle={{ color: '#f5222d' }} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="平均每次消耗" value={Math.round(summary.summary?.avg_credits_per_use || 0)} precision={0} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="使用模型数" value={summary.summary?.models_used || 0} prefix={<RobotOutlined />} /></Card>
          </Col>
        </Row>
      )}

      {/* 积分消耗柱状图 */}
      <Card
        title={<Space><BarChartOutlined /><span>积分消耗趋势</span>
          <Tag color={filters.groupId ? 'blue' : 'default'}>{filters.groupId ? '按用户' : '按组'}</Tag></Space>}
        extra={<Segmented value={chartGranularity} onChange={setChartGranularity} size="small"
          options={[{ label: '按小时', value: 'hour' }, { label: '按天', value: 'day' },
            { label: '按周', value: 'week' }, { label: '按月', value: 'month' }]} />}
        style={{ marginBottom: 20 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Spin spinning={chartLoading}>
          {chartEmpty ? (
            <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="该时间范围内暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div ref={chartRef} style={{ width: '100%', height: 420 }} />
          )}
        </Spin>
      </Card>

      {/* 筛选+表格 */}
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Row gutter={16}>
            <Col span={6}><Search placeholder="搜索用户名或邮箱" allowClear onSearch={handleSearch} style={{ width: '100%' }} /></Col>
            {isSuperAdmin && (
              <Col span={4}>
                <Select placeholder="选择用户组" allowClear style={{ width: '100%' }}
                  onChange={(v) => handleFilterChange('groupId', v)} value={filters.groupId}>
                  {userGroups.map(g => <Option key={g.id} value={g.id}>{g.name}</Option>)}
                </Select>
              </Col>
            )}
            <Col span={4}>
              <Select placeholder="选择模型" allowClear style={{ width: '100%' }}
                onChange={(v) => handleFilterChange('modelName', v)} value={filters.modelName}>
                {aiModels.map(m => <Option key={m.name} value={m.name}>{m.display_name}</Option>)}
              </Select>
            </Col>
            <Col span={6}>
              <RangePicker style={{ width: '100%' }}
                onChange={(d) => handleFilterChange('dateRange', d)} value={filters.dateRange} />
            </Col>
            <Col span={4}>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>
                {isSuperAdmin && <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>导出Excel</Button>}
              </Space>
            </Col>
          </Row>
          <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
            pagination={pagination} onChange={handleTableChange} scroll={{ x: tableScrollX, y: 600 }} />
        </Space>
      </Card>

      {canViewChat && (
        <ConversationContentDrawer visible={drawerVisible} conversationId={selectedConversationId}
          onClose={() => { setDrawerVisible(false); setSelectedConversationId(null) }} />
      )}
    </div>
  )
}

export default UsageLogs
