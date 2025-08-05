/**
 * 万智台 - 知识模块管理页面
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
  Empty
} from 'antd'
import { 
  PlusOutlined,
  AppstoreOutlined,
  GroupOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useKnowledgeStore from '../../stores/knowledgeStore'
import useAuthStore from '../../stores/authStore'
import useAdminStore from '../../stores/adminStore'
import KnowledgeModuleList from '../../components/knowledge/KnowledgeModuleList'
import ModuleCombinationList from '../../components/knowledge/ModuleCombinationList'
import KnowledgeModuleFormModal from '../../components/knowledge/KnowledgeModuleFormModal'
import ModuleCombinationFormModal from '../../components/knowledge/ModuleCombinationFormModal'
import './KnowledgeBase.less'

const { Content } = Layout
const { TabPane } = Tabs

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
  
  const [activeTab, setActiveTab] = useState('modules')
  const [moduleModalVisible, setModuleModalVisible] = useState(false)
  const [combinationModalVisible, setCombinationModalVisible] = useState(false)
  const [editingModule, setEditingModule] = useState(null)
  const [editingCombination, setEditingCombination] = useState(null)

  // 判断是否可以创建团队模块
  const canCreateTeamModule = hasRole(['super_admin', 'admin'])
  // 判断是否可以创建系统模块
  const canCreateSystemModule = hasRole(['super_admin'])

  // 加载数据
  useEffect(() => {
    loadData()
    // 如果是超级管理员，加载用户组列表
    if (canCreateSystemModule) {
      fetchUserGroups()
    }
  }, [canCreateSystemModule])

  const loadData = async () => {
    try {
      await Promise.all([
        getModules(true),
        getCombinations(true)
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
    getModules(true)
  }

  // 组合操作成功回调
  const handleCombinationSuccess = () => {
    setCombinationModalVisible(false)
    setEditingCombination(null)
    getCombinations(true)
  }

  return (
    <Layout className="knowledge-base-layout">
      <Content className="knowledge-base-content">
        <Card 
          title={
            <Space>
              <AppstoreOutlined style={{ fontSize: 20 }} />
              <span style={{ fontSize: 18 }}>万智台</span>
            </Space>
          }
          extra={
            <Space>
              {activeTab === 'modules' && (
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={() => handleModuleEdit()}
                >
                  创建模块
                </Button>
              )}
              {activeTab === 'combinations' && (
                <Button 
                  type="primary" 
                  icon={<GroupOutlined />}
                  onClick={() => handleCombinationEdit()}
                >
                  创建组合
                </Button>
              )}
            </Space>
          }
        >
          <Tabs 
            activeKey={activeTab} 
            onChange={setActiveTab}
            className="knowledge-tabs"
          >
            <TabPane 
              tab={
                <Space>
                  <AppstoreOutlined />
                  知识模块
                </Space>
              } 
              key="modules"
            >
              <Spin spinning={loading}>
                {modules.length > 0 ? (
                  <KnowledgeModuleList 
                    modules={modules}
                    onEdit={handleModuleEdit}
                    onRefresh={() => getModules(true)}
                    canCreateTeam={canCreateTeamModule}
                    canCreateSystem={canCreateSystemModule}
                  />
                ) : (
                  <Empty
                    description="暂无知识模块"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button 
                      type="primary" 
                      onClick={() => handleModuleEdit()}
                    >
                      创建第一个模块
                    </Button>
                  </Empty>
                )}
              </Spin>
            </TabPane>
            
            <TabPane 
              tab={
                <Space>
                  <GroupOutlined />
                  模块组合
                </Space>
              } 
              key="combinations"
            >
              <Spin spinning={loading}>
                {combinations.length > 0 ? (
                  <ModuleCombinationList 
                    combinations={combinations}
                    modules={modules}
                    onEdit={handleCombinationEdit}
                    onRefresh={() => getCombinations(true)}
                  />
                ) : (
                  <Empty
                    description="暂无模块组合"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    {modules.length > 0 ? (
                      <Button 
                        type="primary" 
                        onClick={() => handleCombinationEdit()}
                      >
                        创建第一个组合
                      </Button>
                    ) : (
                      <div style={{ color: '#999' }}>
                        请先创建知识模块
                      </div>
                    )}
                  </Empty>
                )}
              </Spin>
            </TabPane>
          </Tabs>
        </Card>

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
