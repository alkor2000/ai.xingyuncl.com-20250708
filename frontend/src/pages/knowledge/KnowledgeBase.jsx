/**
 * 知识模块管理页面 - Apple风格设计
 */

import React, { useState, useEffect } from 'react'
import { 
  Layout, 
  Tabs, 
  Button, 
  Space, 
  Card, 
  message,
  Spin,
  Empty,
  Row,
  Col,
  Typography,
  Badge,
  Segmented,
  FloatButton
} from 'antd'
import { 
  PlusOutlined,
  AppstoreOutlined,
  GroupOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  LoadingOutlined,
  AppstoreAddOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'
import useModuleStore from '../../stores/moduleStore'
import KnowledgeModuleList from '../../components/knowledge/KnowledgeModuleList'
import ModuleCombinationList from '../../components/knowledge/ModuleCombinationList'
import KnowledgeModuleFormModal from '../../components/knowledge/KnowledgeModuleFormModal'
import ModuleCombinationFormModal from '../../components/knowledge/ModuleCombinationFormModal'
import './KnowledgeBase.less'

const { Content } = Layout
const { Title, Text } = Typography

const KnowledgeBase = () => {
  const { t } = useTranslation()
  const { user, hasRole } = useAuthStore()
  const { 
    modules, 
    combinations, 
    loading,
    getModules,
    getCombinations 
  } = useKnowledgeStore()
  const { fetchUserGroups } = useAdminStore()
  const { getModuleByName } = useModuleStore()
  
  const [activeTab, setActiveTab] = useState('modules')
  const [moduleModalVisible, setModuleModalVisible] = useState(false)
  const [combinationModalVisible, setCombinationModalVisible] = useState(false)
  const [editingModule, setEditingModule] = useState(null)
  const [editingCombination, setEditingCombination] = useState(null)
  const [stats, setStats] = useState({
    totalModules: 0,
    personalModules: 0,
    teamModules: 0,
    systemModules: 0,
    totalCombinations: 0,
    totalUsage: 0
  })

  // 判断是否可以创建团队模块
  const canCreateTeamModule = hasRole(['super_admin', 'admin'])
  // 判断是否可以创建系统模块
  const canCreateSystemModule = hasRole(['super_admin'])

  // 获取当前模块的显示名称（动态）
  const currentModule = getModuleByName('knowledge')
  const moduleDisplayName = currentModule?.display_name || '知识库'

  // 加载数据
  useEffect(() => {
    loadData()
    // 如果是超级管理员，加载用户组列表
    if (canCreateSystemModule) {
      fetchUserGroups()
    }
  }, [canCreateSystemModule])

  // 计算统计数据
  useEffect(() => {
    if (modules && combinations) {
      const personalCount = modules.filter(m => m.module_scope === 'personal').length
      const teamCount = modules.filter(m => m.module_scope === 'team').length
      const systemCount = modules.filter(m => m.module_scope === 'system').length
      const totalUsage = modules.reduce((sum, m) => sum + (m.usage_count || 0), 0) +
                        combinations.reduce((sum, c) => sum + (c.usage_count || 0), 0)
      
      setStats({
        totalModules: modules.length,
        personalModules: personalCount,
        teamModules: teamCount,
        systemModules: systemCount,
        totalCombinations: combinations.length,
        totalUsage
      })
    }
  }, [modules, combinations])

  const loadData = async () => {
    try {
      await Promise.all([
        getModules(false),      // 只获取激活的模块
        getCombinations(false)  // 只获取激活的组合
      ])
    } catch (error) {
      message.error('加载数据失败')
    }
  }

  // 处理创建/编辑模块
  const handleModuleEdit = (module = null) => {
    setEditingModule(module)
    setModuleModalVisible(true)
  }

  // 处理创建/编辑组合
  const handleCombinationEdit = (combination = null) => {
    setEditingCombination(combination)
    setCombinationModalVisible(true)
  }

  // 模块操作成功回调
  const handleModuleSuccess = () => {
    setModuleModalVisible(false)
    setEditingModule(null)
    getModules(false)
  }

  // 组合操作成功回调
  const handleCombinationSuccess = () => {
    setCombinationModalVisible(false)
    setEditingCombination(null)
    getCombinations(false)
  }

  // 统计卡片数据
  const statsCards = [
    { 
      title: '总模块数', 
      value: stats.totalModules, 
      icon: <AppstoreOutlined />,
      color: '#007AFF'
    },
    { 
      title: '个人模块', 
      value: stats.personalModules, 
      icon: <UserOutlined />,
      color: '#5856D6'
    },
    { 
      title: '团队模块', 
      value: stats.teamModules, 
      icon: <TeamOutlined />,
      color: '#34C759'
    },
    { 
      title: '系统模块', 
      value: stats.systemModules, 
      icon: <GlobalOutlined />,
      color: '#FF9500'
    },
    { 
      title: '模块组合', 
      value: stats.totalCombinations, 
      icon: <GroupOutlined />,
      color: '#00C7BE'
    },
    { 
      title: '总使用次数', 
      value: stats.totalUsage, 
      icon: <ThunderboltOutlined />,
      color: '#FF3B30'
    }
  ]

  return (
    <Layout className="knowledge-base-apple">
      <Content className="knowledge-content-apple">
        {/* 简洁的页面标题 */}
        <div className="page-header-apple">
          <div className="header-wrapper">
            <div className="header-left">
              <AppstoreOutlined className="header-icon" />
              <Title level={3} className="header-title">{moduleDisplayName}</Title>
            </div>
          </div>
        </div>

        {/* 统计卡片 - 苹果风格 */}
        <div className="stats-grid-apple">
          {statsCards.map((stat, index) => (
            <div key={index} className="stat-card-apple">
              <div className="stat-icon" style={{ color: stat.color }}>
                {stat.icon}
              </div>
              <div className="stat-content">
                <div className="stat-value">{stat.value}</div>
                <div className="stat-title">{stat.title}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 主内容区域 - 使用Segmented替代Tabs */}
        <div className="content-wrapper-apple">
          <div className="content-header">
            <Segmented
              value={activeTab}
              onChange={setActiveTab}
              options={[
                {
                  label: (
                    <span className="segment-label">
                      <AppstoreOutlined />
                      <span>知识模块</span>
                      <Badge count={stats.totalModules} className="segment-badge" />
                    </span>
                  ),
                  value: 'modules'
                },
                {
                  label: (
                    <span className="segment-label">
                      <GroupOutlined />
                      <span>模块组合</span>
                      <Badge count={stats.totalCombinations} className="segment-badge" />
                    </span>
                  ),
                  value: 'combinations'
                }
              ]}
              size="large"
              className="tab-segmented"
            />
          </div>

          <div className="content-body">
            <Spin 
              spinning={loading}
              indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />}
            >
              {activeTab === 'modules' ? (
                modules.length > 0 ? (
                  <KnowledgeModuleList 
                    modules={modules}
                    onEdit={handleModuleEdit}
                    onRefresh={() => getModules(false)}
                    canCreateTeam={canCreateTeamModule}
                    canCreateSystem={canCreateSystemModule}
                  />
                ) : (
                  <Empty
                    className="empty-state-apple"
                    image={
                      <div className="empty-icon-apple">
                        <FileTextOutlined />
                      </div>
                    }
                    description={
                      <div className="empty-text-apple">
                        <div className="empty-title">暂无知识模块</div>
                        <div className="empty-desc">创建您的第一个知识模块，开始构建智能助手</div>
                      </div>
                    }
                  >
                    <Button 
                      type="primary" 
                      size="large"
                      icon={<PlusOutlined />}
                      onClick={() => handleModuleEdit()}
                      className="empty-btn-apple"
                    >
                      创建第一个模块
                    </Button>
                  </Empty>
                )
              ) : (
                combinations.length > 0 ? (
                  <ModuleCombinationList 
                    combinations={combinations}
                    modules={modules}
                    onEdit={handleCombinationEdit}
                    onRefresh={() => getCombinations(false)}
                  />
                ) : (
                  <Empty
                    className="empty-state-apple"
                    image={
                      <div className="empty-icon-apple">
                        <GroupOutlined />
                      </div>
                    }
                    description={
                      <div className="empty-text-apple">
                        <div className="empty-title">暂无模块组合</div>
                        <div className="empty-desc">
                          {modules.length > 0 
                            ? '组合多个模块，创建更强大的智能助手'
                            : '请先创建知识模块'}
                        </div>
                      </div>
                    }
                  >
                    {modules.length > 0 ? (
                      <Button 
                        type="primary" 
                        size="large"
                        icon={<GroupOutlined />}
                        onClick={() => handleCombinationEdit()}
                        className="empty-btn-apple"
                      >
                        创建第一个组合
                      </Button>
                    ) : (
                      <Button 
                        size="large"
                        onClick={() => setActiveTab('modules')}
                        className="empty-btn-secondary"
                      >
                        先去创建模块
                      </Button>
                    )}
                  </Empty>
                )
              )}
            </Spin>
          </div>
        </div>

        {/* 悬浮创建按钮 - 更显眼 */}
        <FloatButton.Group
          shape="circle"
          style={{ right: 24, bottom: 24 }}
        >
          {activeTab === 'modules' ? (
            <FloatButton
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => handleModuleEdit()}
              tooltip="创建模块"
              style={{
                width: 56,
                height: 56
              }}
            />
          ) : (
            <FloatButton
              icon={<GroupOutlined />}
              type="primary"
              onClick={() => handleCombinationEdit()}
              tooltip="创建组合"
              style={{
                width: 56,
                height: 56
              }}
            />
          )}
        </FloatButton.Group>

        {/* 模块表单弹窗 */}
        <KnowledgeModuleFormModal
          visible={moduleModalVisible}
          module={editingModule}
          onCancel={() => {
            setModuleModalVisible(false)
            setEditingModule(null)
          }}
          onSuccess={handleModuleSuccess}
          canCreateTeam={canCreateTeamModule}
          canCreateSystem={canCreateSystemModule}
        />

        {/* 组合表单弹窗 */}
        <ModuleCombinationFormModal
          visible={combinationModalVisible}
          combination={editingCombination}
          modules={modules}
          onCancel={() => {
            setCombinationModalVisible(false)
            setEditingCombination(null)
          }}
          onSuccess={handleCombinationSuccess}
        />
      </Content>
    </Layout>
  )
}

export default KnowledgeBase
