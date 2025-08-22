import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Typography, Space, Tag, Alert, Spin, Button, Input, message, Modal, Badge, Empty } from 'antd'
import {
  BankOutlined,
  DollarOutlined,
  FireOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  MessageOutlined,
  AppstoreOutlined,
  FileSearchOutlined,
  PictureOutlined,
  CodeOutlined,
  RocketOutlined,
  CalendarOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import * as Icons from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../stores/authStore'
import useModuleStore from '../../stores/moduleStore'
import apiClient from '../../utils/api'
import './Dashboard.less'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

// 图标映射
const iconMap = {
  'MessageOutlined': MessageOutlined,
  'AppstoreOutlined': AppstoreOutlined,
  'FileSearchOutlined': FileSearchOutlined,
  'PictureOutlined': PictureOutlined,
  'CodeOutlined': CodeOutlined,
  'RocketOutlined': RocketOutlined,
  'TeamOutlined': TeamOutlined
}

// 模块颜色映射 - 更柔和的颜色
const moduleColors = {
  'chat': { bg: '#e6f4ff', color: '#1677ff', icon: '#1677ff' },
  'knowledge': { bg: '#f9f0ff', color: '#722ed1', icon: '#722ed1' },
  'image': { bg: '#fff1f0', color: '#ff4d4f', icon: '#ff4d4f' },
  'html_editor': { bg: '#e6fffb', color: '#13c2c2', icon: '#13c2c2' },
  'admin_users': { bg: '#fff7e6', color: '#fa8c16', icon: '#fa8c16' },
  'admin_settings': { bg: '#f0f5ff', color: '#2f54eb', icon: '#2f54eb' }
}

const Dashboard = () => {
  const { user } = useAuthStore()
  const { userModules, getUserModules } = useModuleStore()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [creditsData, setCreditsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modulesLoading, setModulesLoading] = useState(true)
  const [announcement, setAnnouncement] = useState(null)
  const [announcementLoading, setAnnouncementLoading] = useState(true)
  const [isEditingAnnouncement, setIsEditingAnnouncement] = useState(false)
  const [editingContent, setEditingContent] = useState('')
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)

  const isSuperAdmin = user?.role === 'super_admin'
  
  // 获取当前时间段的问候语
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 6) return '凌晨好'
    if (hour < 12) return '早上好'
    if (hour < 14) return '中午好'
    if (hour < 18) return '下午好'
    if (hour < 22) return '晚上好'
    return '夜深了'
  }
  
  // 获取日期信息
  const getDateInfo = () => {
    const now = new Date()
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const month = now.getMonth() + 1
    const date = now.getDate()
    const weekDay = weekDays[now.getDay()]
    return `${month}月${date}日 ${weekDay}`
  }

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
  
  // 加载用户模块
  useEffect(() => {
    const fetchModules = async () => {
      try {
        setModulesLoading(true)
        await getUserModules()
      } catch (error) {
        console.error('获取模块失败:', error)
      } finally {
        setModulesLoading(false)
      }
    }
    
    fetchModules()
  }, [getUserModules])

  // 加载系统公告
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        setAnnouncementLoading(true)
        const response = await apiClient.get('/admin/announcement')
        if (response.data.success) {
          setAnnouncement(response.data.data)
        }
      } catch (error) {
        console.error('获取系统公告失败:', error)
      } finally {
        setAnnouncementLoading(false)
      }
    }

    fetchAnnouncement()
  }, [])

  // 开始编辑公告
  const handleEditAnnouncement = () => {
    setEditingContent(announcement?.content || '')
    setIsEditingAnnouncement(true)
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setIsEditingAnnouncement(false)
    setEditingContent('')
  }

  // 保存公告
  const handleSaveAnnouncement = async () => {
    try {
      setSavingAnnouncement(true)
      const response = await apiClient.put('/admin/announcement', {
        content: editingContent,
        enabled: true,
        format: 'markdown'
      })
      
      if (response.data.success) {
        setAnnouncement(response.data.data)
        setIsEditingAnnouncement(false)
        message.success('系统公告更新成功')
      }
    } catch (error) {
      console.error('更新系统公告失败:', error)
      message.error('更新系统公告失败')
    } finally {
      setSavingAnnouncement(false)
    }
  }

  // 显示Markdown预览
  const showPreview = () => {
    Modal.info({
      title: '公告预览',
      width: 600,
      content: (
        <div className="markdown-content" style={{ maxHeight: '400px', overflow: 'auto' }}>
          <ReactMarkdown>{editingContent || '（空）'}</ReactMarkdown>
        </div>
      ),
      okText: '关闭'
    })
  }
  
  // 获取模块图标
  const getModuleIcon = (iconName, module) => {
    // 优先使用映射的图标
    if (iconMap[iconName]) {
      const IconComponent = iconMap[iconName]
      return <IconComponent />
    }
    
    // 动态获取Ant Design图标
    const IconComponent = Icons[iconName]
    if (IconComponent) {
      return <IconComponent />
    }
    
    // 根据模块名称返回默认图标
    switch(module?.name) {
      case 'chat':
        return <MessageOutlined />
      case 'knowledge':
        return <FileSearchOutlined />
      case 'image':
        return <PictureOutlined />
      case 'html_editor':
        return <CodeOutlined />
      default:
        return <AppstoreOutlined />
    }
  }
  
  // 处理模块点击
  const handleModuleClick = (module) => {
    if (module.route_path) {
      navigate(module.route_path)
    } else if (module.module_url) {
      if (module.open_mode === 'new_tab') {
        window.open(module.module_url, '_blank')
      } else {
        navigate(`/module/${module.name}`)
      }
    }
  }
  
  // 过滤并排序模块 - 排除dashboard
  const getDisplayModules = () => {
    if (!userModules || userModules.length === 0) return []
    
    // 过滤出非管理员模块，并排除dashboard
    const displayModules = userModules.filter(m => 
      m.module_category === 'system' && 
      !m.name.startsWith('admin_') &&
      m.name !== 'dashboard' &&  // 排除工作台自己
      m.is_active
    )
    
    // 按sort_order排序
    return displayModules.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }

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
    <div className="dashboard-container">
      {/* 精简的欢迎区域 */}
      <div className="welcome-section-compact">
        <div className="welcome-left">
          <Title level={4} style={{ margin: 0 }}>
            {getGreeting()}，{user?.username || user?.email}！
          </Title>
        </div>
        <div className="welcome-right">
          <Space>
            <CalendarOutlined />
            <Text>{getDateInfo()}</Text>
            <ClockCircleOutlined />
            <Text>{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Text>
          </Space>
        </div>
      </div>

      {/* 功能模块区域 */}
      <Card 
        className="modules-card"
        title={
          <Space>
            <AppstoreOutlined style={{ color: '#1677ff' }} />
            <span>功能模块</span>
          </Space>
        }
        loading={modulesLoading}
        style={{ marginBottom: 20 }}
      >
        {getDisplayModules().length > 0 ? (
          <Row gutter={[16, 16]}>
            {getDisplayModules().map(module => {
              const colorScheme = moduleColors[module.name] || moduleColors['chat']
              return (
                <Col xs={12} sm={8} md={6} lg={4} key={module.id}>
                  <div 
                    className="module-card-new"
                    onClick={() => handleModuleClick(module)}
                    style={{
                      backgroundColor: colorScheme.bg,
                      borderColor: colorScheme.color
                    }}
                  >
                    <div className="module-icon" style={{ color: colorScheme.icon }}>
                      {getModuleIcon(module.menu_icon, module)}
                    </div>
                    <div className="module-name" style={{ color: colorScheme.color }}>
                      {module.display_name}
                    </div>
                    {module.description && (
                      <div className="module-desc" style={{ color: colorScheme.color }}>
                        {module.description}
                      </div>
                    )}
                  </div>
                </Col>
              )
            })}
          </Row>
        ) : (
          <Empty description="暂无可用模块" />
        )}
      </Card>

      {/* 精简的积分中心 */}
      <Card 
        className="credits-card-compact"
        title={
          <Space>
            <DollarOutlined style={{ color: '#52c41a' }} />
            {t('dashboard.creditsCenter.title')}
          </Space>
        }
        style={{ marginBottom: 20 }}
      >
        <Row gutter={16}>
          <Col xs={12} sm={6}>
            <div className="stat-item">
              <div className="stat-label">
                <BankOutlined /> {t('dashboard.creditsCenter.organization')}
              </div>
              <div className="stat-value">
                <Tag color={creditsData?.group_color || '#1677ff'}>
                  {creditsData?.group_name || t('dashboard.creditsCenter.defaultGroup')}
                </Tag>
              </div>
            </div>
          </Col>
          
          <Col xs={12} sm={6}>
            <div className="stat-item">
              <div className="stat-label">
                {t('dashboard.creditsCenter.totalCredits')}
              </div>
              <div className="stat-value" style={{ color: '#1677ff' }}>
                <DollarOutlined /> {creditsData?.credits_total || 0}
              </div>
            </div>
          </Col>
          
          <Col xs={12} sm={6}>
            <div className="stat-item">
              <div className="stat-label">
                {t('dashboard.creditsCenter.currentCredits')}
              </div>
              <div className="stat-value" style={{ 
                color: creditsData?.credits_remaining > 0 ? '#52c41a' : '#ff4d4f' 
              }}>
                <DollarOutlined /> {creditsData?.credits_remaining || 0}
              </div>
            </div>
          </Col>
          
          <Col xs={12} sm={6}>
            <div className="stat-item">
              <div className="stat-label">
                {t('dashboard.creditsCenter.todayConsumed')}
              </div>
              <div className="stat-value" style={{ color: '#fa8c16' }}>
                <FireOutlined /> {creditsData?.today_consumed || 0}
              </div>
            </div>
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

      {/* 公告区域 - 增大高度 */}
      <Row gutter={16}>
        <Col xs={24} md={12}>
          {/* 系统公告 */}
          <Card 
            className="announcement-card-large"
            title={
              <Space>
                <InfoCircleOutlined style={{ color: '#1677ff' }} />
                {t('dashboard.announcement.system')}
              </Space>
            }
            extra={
              isSuperAdmin && !isEditingAnnouncement && (
                <Button 
                  type="link" 
                  icon={<EditOutlined />} 
                  onClick={handleEditAnnouncement}
                >
                  编辑公告
                </Button>
              )
            }
            loading={announcementLoading}
          >
            {isEditingAnnouncement ? (
              <div>
                <TextArea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  placeholder="请输入系统公告内容，支持Markdown格式"
                  autoSize={{ minRows: 8, maxRows: 20 }}
                  style={{ marginBottom: 16 }}
                />
                <Space>
                  <Button 
                    type="primary" 
                    icon={<SaveOutlined />} 
                    onClick={handleSaveAnnouncement}
                    loading={savingAnnouncement}
                  >
                    保存
                  </Button>
                  <Button onClick={showPreview}>
                    预览
                  </Button>
                  <Button 
                    icon={<CloseOutlined />} 
                    onClick={handleCancelEdit}
                    disabled={savingAnnouncement}
                  >
                    取消
                  </Button>
                </Space>
                <div className="announcement-edit-tips">
                  <div>提示：支持Markdown格式</div>
                  <div className="example">
                    **粗体** *斜体* [链接](url) `代码` 
                    # 标题1
                    ## 标题2
                    - 列表项1
                    - 列表项2
                  </div>
                </div>
              </div>
            ) : (
              <>
                {announcement?.content ? (
                  <div className="markdown-content">
                    <ReactMarkdown>{announcement.content}</ReactMarkdown>
                  </div>
                ) : (
                  <Alert
                    message={t('dashboard.announcement.systemDefault')}
                    type="info"
                    showIcon={false}
                  />
                )}
              </>
            )}
          </Card>
        </Col>
        
        <Col xs={24} md={12}>
          {/* 组织公告 */}
          <Card 
            className="announcement-card-large"
            title={
              <Space>
                <TeamOutlined style={{ color: '#fa8c16' }} />
                <span>组织公告</span>
              </Space>
            }
          >
            <Alert
              message="暂无组织公告"
              type="warning"
              showIcon={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
