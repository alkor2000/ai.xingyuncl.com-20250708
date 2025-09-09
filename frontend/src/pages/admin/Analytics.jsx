/**
 * 数据分析BI面板页面 - iOS科技风格版本（修复日期选择器）
 */

import React, { useEffect, useState } from 'react'
import {
  Card,
  Row,
  Col,
  Statistic,
  DatePicker,
  Select,
  Button,
  Space,
  Tabs,
  Table,
  Tag,
  Empty,
  Spin,
  Radio,
  message,
  Tooltip,
  Badge
} from 'antd'
import {
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  UserOutlined,
  WalletOutlined,
  MessageOutlined,
  ExportOutlined,
  ReloadOutlined,
  DashboardOutlined,
  RiseOutlined,
  FallOutlined,
  TrophyOutlined,
  FireOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import * as echarts from 'echarts/core'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import useAnalyticsStore from '../../stores/analyticsStore'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'

// 导入iOS风格样式
import '../../styles/Analytics.ios.css'

// 配置 dayjs 中文
dayjs.locale('zh-cn')

const { RangePicker } = DatePicker
const { Option } = Select
const { TabPane } = Tabs

const Analytics = () => {
  const { t } = useTranslation()
  const { user: currentUser } = useAuthStore()
  const { userGroups, getUserGroups } = useAdminStore()
  const {
    loading,
    analyticsData,
    dashboardData,
    filters,
    setFilters,
    resetFilters,
    getAnalytics,
    getDashboard,
    exportAnalytics
  } = useAnalyticsStore()

  const [activeTab, setActiveTab] = useState('overview')

  // 判断用户权限
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isGroupAdmin = currentUser?.role === 'admin'

  // 初始化加载
  useEffect(() => {
    // 加载用户组
    if (isSuperAdmin) {
      getUserGroups()
    }
    
    // 设置默认时间范围（最近30天）
    const defaultFilters = {
      startDate: dayjs().subtract(30, 'days').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD'),
      groupId: isGroupAdmin ? currentUser.group_id : null
    }
    
    setFilters(defaultFilters)
    
    // 加载数据
    loadData(defaultFilters)
  }, [])

  // 加载数据
  const loadData = async (customFilters = {}) => {
    try {
      await Promise.all([
        getAnalytics(customFilters),
        getDashboard()
      ])
    } catch (error) {
      console.error('加载数据失败:', error)
    }
  }

  // 处理日期范围变化
  const handleDateRangeChange = (dates) => {
    if (dates && dates.length === 2) {
      const newFilters = {
        startDate: dates[0].format('YYYY-MM-DD'),
        endDate: dates[1].format('YYYY-MM-DD')
      }
      setFilters(newFilters)
      loadData(newFilters)
    }
  }

  // 处理组选择变化
  const handleGroupChange = (groupId) => {
    const newFilters = { groupId }
    setFilters(newFilters)
    loadData(newFilters)
  }

  // 处理时间粒度变化
  const handleGranularityChange = (e) => {
    const newFilters = { timeGranularity: e.target.value }
    setFilters(newFilters)
    loadData(newFilters)
  }

  // 刷新数据
  const handleRefresh = () => {
    loadData()
    message.success('数据已刷新')
  }

  // 导出报表
  const handleExport = async () => {
    try {
      await exportAnalytics()
    } catch (error) {
      console.error('导出失败:', error)
    }
  }

  // iOS风格的图表颜色
  const iosColors = {
    blue: '#007AFF',
    purple: '#5856D6',
    red: '#FF3B30',
    orange: '#FF9500',
    green: '#34C759',
    teal: '#00C7BE',
    lightBlue: '#32ADE6',
    pink: '#FF2D55',
    yellow: '#FFCC00',
    gray: '#8E8E93'
  }

  // 获取时间序列图表配置 - iOS风格
  const getTimeSeriesOption = () => {
    if (!analyticsData?.timeSeries || analyticsData.timeSeries.length === 0) {
      return {}
    }

    const data = analyticsData.timeSeries

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: 'rgba(0, 0, 0, 0.08)',
        borderWidth: 1,
        textStyle: {
          color: '#1c1c1e'
        },
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: 'rgba(0, 122, 255, 0.2)'
          }
        }
      },
      legend: {
        data: ['积分消耗', '独立用户', '交易次数'],
        textStyle: {
          color: '#8e8e93'
        },
        icon: 'roundRect'
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.map(item => item.period),
        axisLine: {
          lineStyle: {
            color: 'rgba(0, 0, 0, 0.06)'
          }
        },
        axisLabel: {
          color: '#8e8e93'
        }
      },
      yAxis: [
        {
          type: 'value',
          name: '积分',
          position: 'left',
          axisLine: {
            show: false
          },
          axisTick: {
            show: false
          },
          axisLabel: {
            color: '#8e8e93',
            formatter: '{value}'
          },
          splitLine: {
            lineStyle: {
              color: 'rgba(0, 0, 0, 0.03)'
            }
          }
        },
        {
          type: 'value',
          name: '用户/次数',
          position: 'right',
          axisLine: {
            show: false
          },
          axisTick: {
            show: false
          },
          axisLabel: {
            color: '#8e8e93',
            formatter: '{value}'
          },
          splitLine: {
            show: false
          }
        }
      ],
      series: [
        {
          name: '积分消耗',
          type: 'line',
          smooth: true,
          yAxisIndex: 0,
          data: data.map(item => item.credits_consumed),
          lineStyle: {
            width: 3,
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: iosColors.blue },
              { offset: 1, color: iosColors.purple }
            ])
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(0, 122, 255, 0.15)' },
              { offset: 1, color: 'rgba(0, 122, 255, 0.01)' }
            ])
          },
          itemStyle: {
            color: iosColors.blue,
            borderWidth: 2,
            borderColor: '#fff'
          }
        },
        {
          name: '独立用户',
          type: 'line',
          smooth: true,
          yAxisIndex: 1,
          data: data.map(item => item.unique_users),
          lineStyle: {
            width: 3,
            color: iosColors.green
          },
          itemStyle: {
            color: iosColors.green,
            borderWidth: 2,
            borderColor: '#fff'
          }
        },
        {
          name: '交易次数',
          type: 'line',
          smooth: true,
          yAxisIndex: 1,
          data: data.map(item => item.transaction_count),
          lineStyle: {
            width: 3,
            color: iosColors.orange
          },
          itemStyle: {
            color: iosColors.orange,
            borderWidth: 2,
            borderColor: '#fff'
          }
        }
      ]
    }
  }

  // 获取模型使用饼图配置 - iOS风格
  const getModelPieOption = () => {
    if (!analyticsData?.models?.chatModels || analyticsData.models.chatModels.length === 0) {
      return {}
    }

    const data = analyticsData.models.chatModels.map(model => ({
      name: model.display_name || model.model_name,
      value: model.credits_consumed || 0
    }))

    const colors = Object.values(iosColors)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: 'rgba(0, 0, 0, 0.08)',
        borderWidth: 1,
        textStyle: {
          color: '#1c1c1e'
        }
      },
      legend: {
        orient: 'vertical',
        left: 'left',
        textStyle: {
          color: '#8e8e93'
        },
        icon: 'circle'
      },
      color: colors,
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: false,
            position: 'center'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 20,
              fontWeight: 'bold'
            },
            itemStyle: {
              shadowBlur: 20,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)'
            }
          },
          labelLine: {
            show: false
          },
          data: data
        }
      ]
    }
  }

  // 获取功能模块柱状图配置 - iOS风格
  const getModuleBarOption = () => {
    if (!analyticsData?.modules || analyticsData.modules.length === 0) {
      return {}
    }

    const data = analyticsData.modules

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: 'rgba(0, 0, 0, 0.08)',
        borderWidth: 1,
        textStyle: {
          color: '#1c1c1e'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: data.map(item => item.module_name),
        axisTick: {
          show: false
        },
        axisLine: {
          lineStyle: {
            color: 'rgba(0, 0, 0, 0.06)'
          }
        },
        axisLabel: {
          color: '#8e8e93'
        }
      },
      yAxis: {
        type: 'value',
        name: '积分消耗',
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        axisLabel: {
          color: '#8e8e93'
        },
        splitLine: {
          lineStyle: {
            color: 'rgba(0, 0, 0, 0.03)'
          }
        }
      },
      series: [
        {
          name: '积分消耗',
          type: 'bar',
          data: data.map(item => item.credits_consumed),
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: iosColors.blue },
              { offset: 1, color: iosColors.lightBlue }
            ])
          },
          emphasis: {
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: iosColors.purple },
                { offset: 1, color: iosColors.blue }
              ])
            }
          }
        }
      ]
    }
  }

  // 渲染iOS风格的概览卡片
  const renderOverviewCards = () => {
    if (!dashboardData) return null

    const cards = [
      {
        title: t('admin.analytics.todayCredits'),
        value: dashboardData.today.credits,
        icon: <WalletOutlined />,
        color: iosColors.blue,
        bgGradient: 'linear-gradient(135deg, rgba(0, 122, 255, 0.1) 0%, rgba(88, 86, 214, 0.1) 100%)'
      },
      {
        title: t('admin.analytics.todayUsers'),
        value: dashboardData.today.users,
        icon: <UserOutlined />,
        color: iosColors.green,
        bgGradient: 'linear-gradient(135deg, rgba(52, 199, 89, 0.1) 0%, rgba(48, 209, 88, 0.1) 100%)'
      },
      {
        title: t('admin.analytics.todayConversations'),
        value: dashboardData.today.conversations,
        icon: <MessageOutlined />,
        color: iosColors.orange,
        bgGradient: 'linear-gradient(135deg, rgba(255, 149, 0, 0.1) 0%, rgba(255, 204, 0, 0.1) 100%)'
      },
      {
        title: t('admin.analytics.monthCredits'),
        value: dashboardData.month.credits,
        icon: <BarChartOutlined />,
        color: iosColors.purple,
        bgGradient: 'linear-gradient(135deg, rgba(88, 86, 214, 0.1) 0%, rgba(175, 82, 222, 0.1) 100%)'
      }
    ]

    return (
      <Row gutter={[16, 16]}>
        {cards.map((card, index) => (
          <Col xs={24} sm={12} md={6} key={index}>
            <div className="ios-card overview-card" style={{ background: card.bgGradient }}>
              <div className="stat-icon" style={{ color: card.color }}>
                {card.icon}
              </div>
              <div className="stat-value" style={{ color: card.color }}>
                {card.value.toLocaleString()}
              </div>
              <div className="stat-label">{card.title}</div>
            </div>
          </Col>
        ))}
      </Row>
    )
  }

  // 渲染iOS风格的TOP用户表格
  const renderTopUsersTable = () => {
    if (!analyticsData?.users?.topUsers || analyticsData.users.topUsers.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">
            <UserOutlined />
          </div>
          <div className="empty-state-text">{t('admin.analytics.noData')}</div>
        </div>
      )
    }

    const columns = [
      {
        title: t('admin.analytics.rank'),
        dataIndex: 'rank',
        key: 'rank',
        width: 80,
        render: (_, __, index) => {
          const rank = index + 1
          return (
            <div className={`rank-badge rank-${rank <= 3 ? rank : 'other'}`}>
              {rank <= 3 ? <TrophyOutlined /> : rank}
            </div>
          )
        }
      },
      {
        title: t('admin.analytics.username'),
        dataIndex: 'username',
        key: 'username',
        render: (text) => <span style={{ fontWeight: 600 }}>{text}</span>
      },
      {
        title: t('admin.analytics.group'),
        dataIndex: 'group_name',
        key: 'group_name',
        render: (text) => text ? (
          <Tag style={{ 
            borderRadius: 8,
            background: 'rgba(0, 122, 255, 0.08)',
            border: '1px solid rgba(0, 122, 255, 0.2)',
            color: iosColors.blue
          }}>{text}</Tag>
        ) : '-'
      },
      {
        title: t('admin.analytics.tags'),
        dataIndex: 'tags',
        key: 'tags',
        render: (tags) => tags ? (
          <Tag style={{
            borderRadius: 8,
            background: 'rgba(88, 86, 214, 0.08)',
            border: '1px solid rgba(88, 86, 214, 0.2)',
            color: iosColors.purple
          }}>{tags}</Tag>
        ) : '-'
      },
      {
        title: t('admin.analytics.creditsConsumed'),
        dataIndex: 'total_credits_consumed',
        key: 'total_credits_consumed',
        sorter: (a, b) => a.total_credits_consumed - b.total_credits_consumed,
        render: (value) => (
          <span style={{ 
            fontWeight: 600,
            fontSize: 16,
            color: iosColors.blue
          }}>
            {value.toLocaleString()}
          </span>
        )
      },
      {
        title: t('admin.analytics.activeDays'),
        dataIndex: 'active_days',
        key: 'active_days',
        render: (value) => (
          <Badge 
            count={value} 
            style={{ 
              backgroundColor: iosColors.green,
              boxShadow: '0 2px 8px rgba(52, 199, 89, 0.3)'
            }} 
          />
        )
      }
    ]

    return (
      <div className="ios-table">
        <Table
          columns={columns}
          dataSource={analyticsData.users.topUsers}
          rowKey="id"
          pagination={{ 
            pageSize: 10,
            showSizeChanger: false,
            showQuickJumper: false
          }}
        />
      </div>
    )
  }

  // 加载动画
  if (loading) {
    return (
      <div className="analytics-container">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <div className="loading-text">正在加载数据...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-container">
      {/* 页面标题和操作区 */}
      <div className="ios-card" style={{ marginBottom: 24 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <h1 className="analytics-title">
              <DashboardOutlined style={{ marginRight: 12 }} />
              {t('admin.analytics.title')}
            </h1>
          </Col>
          <Col>
            <Space>
              <Button 
                className="ios-button"
                icon={<ReloadOutlined />} 
                onClick={handleRefresh}
                style={{ borderRadius: 12 }}
              >
                {t('admin.analytics.refresh')}
              </Button>
              <Button 
                className="export-button"
                icon={<ExportOutlined />} 
                onClick={handleExport}
              >
                {t('admin.analytics.export')}
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* 筛选条件 */}
      <div className="ios-card filter-section" style={{ marginBottom: 24 }}>
        <Space wrap size={16}>
          <RangePicker
            value={[
              filters.startDate ? dayjs(filters.startDate) : null,
              filters.endDate ? dayjs(filters.endDate) : null
            ]}
            onChange={handleDateRangeChange}
            format="YYYY-MM-DD"
            placeholder={[t('admin.analytics.startDate'), t('admin.analytics.endDate')]}
            style={{ borderRadius: 12 }}
            allowClear
          />
          
          {isSuperAdmin && (
            <Select
              style={{ width: 200, borderRadius: 12 }}
              placeholder={t('admin.analytics.selectGroup')}
              value={filters.groupId}
              onChange={handleGroupChange}
              allowClear
            >
              {userGroups.map(group => (
                <Option key={group.id} value={group.id}>
                  {group.name}
                </Option>
              ))}
            </Select>
          )}
          
          <Radio.Group 
            value={filters.timeGranularity} 
            onChange={handleGranularityChange}
            buttonStyle="solid"
            style={{ borderRadius: 12 }}
          >
            <Radio.Button value="day" style={{ borderRadius: '12px 0 0 12px' }}>
              {t('admin.analytics.daily')}
            </Radio.Button>
            <Radio.Button value="week">
              {t('admin.analytics.weekly')}
            </Radio.Button>
            <Radio.Button value="month" style={{ borderRadius: '0 12px 12px 0' }}>
              {t('admin.analytics.monthly')}
            </Radio.Button>
          </Radio.Group>
        </Space>
      </div>

      {/* 数据展示区 */}
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        className="ios-tabs"
      >
        <TabPane tab={t('admin.analytics.overview')} key="overview">
          {/* 概览卡片 */}
          {renderOverviewCards()}
          
          {/* 时间趋势图 */}
          <div className="ios-card chart-container" style={{ marginTop: 24 }}>
            <div className="chart-title">
              {t('admin.analytics.timeTrend')}
            </div>
            {analyticsData?.timeSeries?.length > 0 ? (
              <ReactECharts option={getTimeSeriesOption()} style={{ height: 400 }} />
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <LineChartOutlined />
                </div>
                <div className="empty-state-text">{t('admin.analytics.noData')}</div>
              </div>
            )}
          </div>
        </TabPane>

        <TabPane tab={t('admin.analytics.userAnalysis')} key="users">
          {/* TOP用户表格 */}
          <div className="ios-card">
            <div className="chart-title">
              {t('admin.analytics.topUsers')}
            </div>
            {renderTopUsersTable()}
          </div>
        </TabPane>

        <TabPane tab={t('admin.analytics.modelAnalysis')} key="models">
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              {/* 模型使用饼图 */}
              <div className="ios-card">
                <div className="chart-title">
                  {t('admin.analytics.modelUsage')}
                </div>
                {analyticsData?.models?.chatModels?.length > 0 ? (
                  <ReactECharts option={getModelPieOption()} style={{ height: 400 }} />
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <PieChartOutlined />
                    </div>
                    <div className="empty-state-text">{t('admin.analytics.noData')}</div>
                  </div>
                )}
              </div>
            </Col>
            <Col xs={24} lg={12}>
              {/* 功能模块柱状图 */}
              <div className="ios-card">
                <div className="chart-title">
                  {t('admin.analytics.moduleUsage')}
                </div>
                {analyticsData?.modules?.length > 0 ? (
                  <ReactECharts option={getModuleBarOption()} style={{ height: 400 }} />
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <BarChartOutlined />
                    </div>
                    <div className="empty-state-text">{t('admin.analytics.noData')}</div>
                  </div>
                )}
              </div>
            </Col>
          </Row>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default Analytics
