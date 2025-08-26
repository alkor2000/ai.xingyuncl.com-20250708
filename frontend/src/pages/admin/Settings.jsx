/**
 * 系统设置主页面 - 支持组管理员权限控制和系统配置持久化
 */

import React, { useEffect, useState } from 'react'
import { Card, Button, Tabs, Form, message, Space, Tag } from 'antd'
import {
  BarChartOutlined,
  RobotOutlined,
  SettingOutlined,
  PlusOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  FileImageOutlined,
  FileTextOutlined,
  LockOutlined,
  GlobalOutlined,
  HeartOutlined,
  MailOutlined,
  ApiOutlined,
  BgColorsOutlined,
  HistoryOutlined,
  PictureOutlined,
  KeyOutlined,
  CodeOutlined,
  CloudServerOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import useSystemConfigStore from '../../stores/systemConfigStore'
import { ROLES, hasPermission } from '../../utils/permissions'

// 导入子组件
import {
  SystemStats,
  AIModelTable,
  AIModelFormModal,
  SystemModuleTable,
  SystemModuleFormModal,
  BasicSettings,
  CustomHomepage,
  SystemHealthMonitor,
  EmailSettings,
  APIServiceTable,
  RateLimitSettings,
  ThemeSettings,
  SystemPromptSettings,
  UsageLogs,
  ImageModelSettings,
  SSOSettings,
  HtmlEditorSettings,
  OSSSettings
} from '../../components/admin/settings'

// 自定义Tab样式，实现两排显示
const customTabBarStyle = {
  '.ant-tabs-nav-wrap': {
    flexWrap: 'wrap',
    height: 'auto',
  },
  '.ant-tabs-nav-list': {
    flexWrap: 'wrap',
    height: 'auto',
  },
  '.ant-tabs-tab': {
    marginBottom: '8px',
  }
}

const Settings = () => {
  const { t } = useTranslation()
  const { user, hasRole } = useAuthStore()
  const { updateSystemConfig } = useSystemConfigStore()
  const {
    aiModels,
    modules,
    apiServices,
    systemStats,
    systemSettings,
    loading,
    getAIModels,
    createAIModel,
    updateAIModel,
    deleteAIModel,
    testAIModel,
    getModules,
    createModule,
    updateModule,
    deleteModule,
    toggleModuleStatus,
    checkModuleHealth,
    getApiServices,
    deleteApiService,
    getSystemStats,
    getSystemSettings,
    updateSystemSettings,
    getUserGroups,
    userGroups,
    getSystemHealth
  } = useAdminStore()

  // 表单实例
  const [settingsForm] = Form.useForm()
  const [modelForm] = Form.useForm()
  const [moduleForm] = Form.useForm()
  
  // 状态管理
  const [isModelModalVisible, setIsModelModalVisible] = useState(false)
  const [isModuleModalVisible, setIsModuleModalVisible] = useState(false)
  const [editingModel, setEditingModel] = useState(null)
  const [editingModule, setEditingModule] = useState(null)
  const [testingModelId, setTestingModelId] = useState(null)
  const [checkingModuleId, setCheckingModuleId] = useState(null)
  const [settingsLoading, setSettingsLoading] = useState(false)

  const userRole = user?.role || ROLES.USER
  const isSuperAdmin = userRole === ROLES.SUPER_ADMIN
  const isGroupAdmin = userRole === ROLES.ADMIN
  const canViewSettings = isSuperAdmin || isGroupAdmin

  // 初始化加载数据
  useEffect(() => {
    if (canViewSettings) {
      getSystemStats()
      getAIModels()
      getUserGroups()
      if (isSuperAdmin) {
        getModules()
        getApiServices()
      }
      getSystemSettings()
    }
  }, [canViewSettings, isSuperAdmin])

  // 设置表单初始值
  useEffect(() => {
    if (systemSettings && Object.keys(systemSettings).length > 0) {
      settingsForm.setFieldsValue(systemSettings)
    }
  }, [systemSettings, settingsForm])

  // 设置默认模型
  useEffect(() => {
    if (aiModels.length > 0 && systemSettings?.ai && !systemSettings.ai.default_model) {
      const firstActiveModel = aiModels.find(m => m.is_active)
      if (firstActiveModel) {
        settingsForm.setFieldValue(['ai', 'default_model'], firstActiveModel.name)
      }
    }
  }, [aiModels, systemSettings, settingsForm])

  // 保存系统设置（只有超级管理员可以）
  const handleSaveSettings = async (values) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      setSettingsLoading(true)
      
      // 同时更新后端和前端Store
      await updateSystemSettings(values)
      const result = await updateSystemConfig(values)
      
      if (result.success) {
        message.success(t('admin.settings.save.success'))
      } else {
        message.error(result.error || t('admin.settings.save.failed'))
      }
    } catch (error) {
      message.error(t('admin.settings.save.failed'))
    } finally {
      setSettingsLoading(false)
    }
  }

  // AI模型相关方法（只有超级管理员可以创建/更新/删除）
  const handleCreateModel = async (values) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await createAIModel(values)
      setIsModelModalVisible(false)
      modelForm.resetFields()
      message.success(t('admin.models.success.create'))
      await getAIModels() // 刷新列表
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.models.error.create'))
    }
  }

  const handleUpdateModel = async (values) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      // 过滤掉空的api_key和api_endpoint，避免覆盖原有值
      const updateData = { ...values }
      if (!updateData.api_key) {
        delete updateData.api_key
      }
      if (!updateData.api_endpoint) {
        delete updateData.api_endpoint
      }
      
      await updateAIModel(editingModel.id, updateData)
      setIsModelModalVisible(false)
      setEditingModel(null)
      modelForm.resetFields()
      message.success(t('admin.models.success.update'))
      await getAIModels() // 刷新列表
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.models.error.update'))
    }
  }

  const handleDeleteModel = async (modelId) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await deleteAIModel(modelId)
      message.success(t('admin.models.success.delete'))
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.models.error.delete'))
    }
  }

  const handleTestModel = async (modelId) => {
    setTestingModelId(modelId)
    try {
      const result = await testAIModel(modelId)
      if (result.success && result.data) {
        if (result.data.success) {
          message.success(t('admin.models.test.success'))
        } else {
          message.warning(t('admin.models.test.failed', { message: result.data.message }))
        }
        await getAIModels()
      } else {
        message.error(result.message || t('admin.models.test.error'))
      }
    } catch (error) {
      console.error('测试失败:', error)
      message.error(error.message || t('admin.models.test.error'))
    } finally {
      setTestingModelId(null)
    }
  }

  const handleEditModel = (model) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    setEditingModel(model)
    // 不设置api_key和api_endpoint，让用户选择是否更新
    modelForm.setFieldsValue({
      name: model.name,
      display_name: model.display_name,
      // 不设置 api_key 和 api_endpoint，保持为空
      stream_enabled: model.stream_enabled !== undefined ? model.stream_enabled : true,
      image_upload_enabled: model.image_upload_enabled !== undefined ? model.image_upload_enabled : false,
      document_upload_enabled: model.document_upload_enabled !== undefined ? model.document_upload_enabled : false,
      credits_per_chat: model.credits_per_chat,
      is_active: model.is_active,
      sort_order: model.sort_order,
      test_temperature: model.model_config?.test_temperature || 1
    })
    setIsModelModalVisible(true)
  }

  const handleToggleStreamEnabled = async (modelId, streamEnabled) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await updateAIModel(modelId, { stream_enabled: streamEnabled })
      message.success(t('admin.models.success.update'))
      await getAIModels() // 刷新列表
    } catch (error) {
      message.error(t('admin.models.error.update'))
    }
  }

  const handleToggleImageUploadEnabled = async (modelId, imageUploadEnabled) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await updateAIModel(modelId, { image_upload_enabled: imageUploadEnabled })
      message.success(t('admin.models.success.update'))
      await getAIModels() // 刷新列表
    } catch (error) {
      message.error(t('admin.models.error.update'))
    }
  }

  const handleToggleDocumentUploadEnabled = async (modelId, documentUploadEnabled) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await updateAIModel(modelId, { document_upload_enabled: documentUploadEnabled })
      message.success(t('admin.models.success.update'))
      await getAIModels() // 刷新列表
    } catch (error) {
      message.error(t('admin.models.error.update'))
    }
  }

  // 系统模块相关方法（只有超级管理员可以管理）
  const handleCreateModule = async (values) => {
    try {
      await createModule(values)
      setIsModuleModalVisible(false)
      moduleForm.resetFields()
      message.success(t('admin.modules.success.create'))
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.modules.error.create'))
    }
  }

  const handleUpdateModule = async (values) => {
    try {
      await updateModule(editingModule.id, values)
      setIsModuleModalVisible(false)
      setEditingModule(null)
      moduleForm.resetFields()
      message.success(t('admin.modules.success.update'))
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.modules.error.update'))
    }
  }

  const handleDeleteModule = async (moduleId) => {
    try {
      await deleteModule(moduleId)
      message.success(t('admin.modules.success.delete'))
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.modules.error.delete'))
    }
  }

  const handleEditModule = (module) => {
    // 只设置editingModule，让子组件自己处理表单值
    setEditingModule(module)
    setIsModuleModalVisible(true)
  }

  const handleCheckModuleHealth = async (moduleId) => {
    setCheckingModuleId(moduleId)
    try {
      const result = await checkModuleHealth(moduleId)
      if (result.success) {
        message.success(t('admin.modules.checkHealth.success'))
      } else {
        message.warning(t('admin.modules.checkHealth.failed'))
      }
    } catch (error) {
      message.error(t('admin.modules.checkHealth.error'))
    } finally {
      setCheckingModuleId(null)
    }
  }

  const handleToggleModuleStatus = async (moduleId, isActive) => {
    try {
      await toggleModuleStatus(moduleId, isActive)
      message.success(t('admin.modules.success.update'))
    } catch (error) {
      message.error(t('admin.modules.error.update'))
    }
  }

  // API服务相关方法（只有超级管理员可以管理）
  const handleDeleteApiService = async (serviceId) => {
    if (!isSuperAdmin) {
      message.warning(t('admin.noPermission'))
      return
    }
    
    try {
      await deleteApiService(serviceId)
      message.success(t('admin.apiServices.success.delete'))
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.apiServices.error.delete'))
    }
  }

  // 权限检查 - 使用角色判断而不是权限
  if (!canViewSettings) {
    return (
      <div className="page-container">
        <Card>
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <p>{t('admin.noPermission')}</p>
          </div>
        </Card>
      </div>
    )
  }

  // Tab配置项 - 使用items属性（Ant Design 5.x）
  const tabItems = [
    // 第一组：基础功能
    {
      key: 'statistics',
      label: (
        <span>
          <BarChartOutlined />
          {t('admin.settings.tabs.statistics')}
        </span>
      ),
      children: <SystemStats systemStats={systemStats} />
    },
    {
      key: 'usageLogs',
      label: (
        <span>
          <HistoryOutlined />
          {t('admin.settings.tabs.usageLogs')}
        </span>
      ),
      children: <UsageLogs />
    },
    // 只有超级管理员可见的系统健康监控
    ...(isSuperAdmin ? [{
      key: 'health',
      label: (
        <span>
          <HeartOutlined />
          {t('admin.settings.tabs.systemHealth')}
        </span>
      ),
      children: <SystemHealthMonitor onRefresh={getSystemHealth} />
    }] : []),
    {
      key: 'models',
      label: (
        <span>
          <RobotOutlined />
          {t('admin.settings.tabs.models')}
        </span>
      ),
      children: (
        <Card 
          title={
            <Space>
              <RobotOutlined />
              <span>{t('admin.models.config')}</span>
              <Tag color="blue">💰 {t('admin.models.creditsSystem')}</Tag>
              <Tag color="processing" icon={<ThunderboltOutlined />}>
                🚀 {t('admin.models.streamOutput')}
              </Tag>
              <Tag color="success" icon={<FileImageOutlined />}>
                🖼️ {t('admin.models.imageUpload')}
              </Tag>
              <Tag color="orange" icon={<FileTextOutlined />}>
                📄 {t('admin.models.documentUpload')}
              </Tag>
              <Tag color="green">🔓 {t('admin.models.noOutputLimit')}</Tag>
            </Space>
          }
          extra={
            isSuperAdmin && (
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingModel(null)
                  modelForm.resetFields()
                  setIsModelModalVisible(true)
                }}
              >
                {t('admin.models.addModel')}
              </Button>
            )
          }
        >
          <AIModelTable
            models={aiModels}
            loading={loading}
            testingModelId={testingModelId}
            onTest={handleTestModel}
            onEdit={handleEditModel}
            onDelete={handleDeleteModel}
            onToggleStreamEnabled={handleToggleStreamEnabled}
            onToggleImageUploadEnabled={handleToggleImageUploadEnabled}
            onToggleDocumentUploadEnabled={handleToggleDocumentUploadEnabled}
          />
        </Card>
      )
    },
    // 只有超级管理员可见的Tab
    ...(isSuperAdmin ? [
      {
        key: 'imageModels',
        label: (
          <span>
            <PictureOutlined />
            图像生成模型
          </span>
        ),
        children: <ImageModelSettings />
      },
      {
        key: 'systemPrompts',
        label: (
          <span>
            <FileTextOutlined />
            {t('admin.settings.tabs.systemPrompts')}
          </span>
        ),
        children: <SystemPromptSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'modules',
        label: (
          <span>
            <AppstoreOutlined />
            {t('admin.settings.tabs.modules')}
          </span>
        ),
        children: (
          <Card
            title={t('admin.modules.title')}
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingModule(null)
                  moduleForm.resetFields()
                  setIsModuleModalVisible(true)
                }}
              >
                {t('admin.modules.addModule')}
              </Button>
            }
          >
            <SystemModuleTable
              modules={modules}
              loading={loading}
              checkingModuleId={checkingModuleId}
              onCheckHealth={handleCheckModuleHealth}
              onToggleStatus={handleToggleModuleStatus}
              onEdit={handleEditModule}
              onDelete={handleDeleteModule}
            />
          </Card>
        )
      },
      {
        key: 'apiServices',
        label: (
          <span>
            <ApiOutlined />
            {t('admin.settings.tabs.apiServices')}
          </span>
        ),
        children: (
          <Card title={t('admin.settings.apiServices.title')}>
            <APIServiceTable
              services={apiServices}
              loading={loading}
              onRefresh={getApiServices}
              onDelete={handleDeleteApiService}
              adminStore={useAdminStore.getState()}
            />
          </Card>
        )
      },
      {
        key: 'ossSettings',
        label: (
          <span>
            <CloudServerOutlined />
            OSS存储配置
          </span>
        ),
        children: <OSSSettings />
      }
    ] : []),
    {
      key: 'settings',
      label: (
        <span>
          <SettingOutlined />
          {t('admin.settings.tabs.basic')}
        </span>
      ),
      children: (
        <BasicSettings
          form={settingsForm}
          aiModels={aiModels}
          loading={settingsLoading}
          onSubmit={handleSaveSettings}
          disabled={!isSuperAdmin}
        />
      )
    },
    // 只有超级管理员可见的配置Tab
    ...(isSuperAdmin ? [
      {
        key: 'htmlEditor',
        label: (
          <span>
            <CodeOutlined />
            HTML编辑器
          </span>
        ),
        children: <HtmlEditorSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'theme',
        label: (
          <span>
            <BgColorsOutlined />
            {t('admin.settings.tabs.theme')}
          </span>
        ),
        children: <ThemeSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'rateLimit',
        label: (
          <span>
            <ThunderboltOutlined />
            {t('admin.settings.tabs.rateLimit')}
          </span>
        ),
        children: <RateLimitSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'email',
        label: (
          <span>
            <MailOutlined />
            {t('admin.settings.tabs.email')}
          </span>
        ),
        children: <EmailSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'sso',
        label: (
          <span>
            <KeyOutlined />
            {t('admin.settings.tabs.sso')}
          </span>
        ),
        children: <SSOSettings />
      },
      {
        key: 'customHomepage',
        label: (
          <span>
            <GlobalOutlined />
            {t('admin.settings.tabs.customHomepage')}
          </span>
        ),
        children: <CustomHomepage disabled={!isSuperAdmin} />
      }
    ] : [])
  ]
  
  return (
    <div className="page-container">
      <style>
        {`
          /* 自定义Tab样式，实现自适应多排显示 */
          .settings-tabs .ant-tabs-nav-wrap {
            flex-wrap: wrap !important;
            height: auto !important;
          }
          .settings-tabs .ant-tabs-nav-list {
            flex-wrap: wrap !important;
            height: auto !important;
          }
          .settings-tabs .ant-tabs-tab {
            margin-bottom: 8px !important;
          }
          .settings-tabs .ant-tabs-ink-bar {
            display: none !important;
          }
          .settings-tabs .ant-tabs-nav::before {
            border-bottom: none !important;
          }
        `}
      </style>
      
      <Tabs 
        defaultActiveKey="statistics" 
        type="card"
        className="settings-tabs"
        items={tabItems}
      />

      {/* AI模型弹窗（只有超级管理员可以使用） */}
      {isSuperAdmin && (
        <AIModelFormModal
          visible={isModelModalVisible}
          editingModel={editingModel}
          form={modelForm}
          loading={loading}
          onSubmit={editingModel ? handleUpdateModel : handleCreateModel}
          onCancel={() => {
            setIsModelModalVisible(false)
            setEditingModel(null)
            modelForm.resetFields()
          }}
        />
      )}

      {/* 系统模块弹窗（只有超级管理员可以使用） */}
      {isSuperAdmin && (
        <SystemModuleFormModal
          visible={isModuleModalVisible}
          editingModule={editingModule}
          form={moduleForm}
          loading={loading}
          onSubmit={editingModule ? handleUpdateModule : handleCreateModule}
          onCancel={() => {
            setIsModuleModalVisible(false)
            setEditingModule(null)
            moduleForm.resetFields()
          }}
        />
      )}
    </div>
  )
}

export default Settings
