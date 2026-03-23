/**
 * 系统设置主页面 - 支持组管理员权限控制和系统配置持久化
 * 
 * 版本更新：
 * - v2.0.0 (2026-03-23): 移除系统提示词管理Tab（功能废弃）
 * - v1.9.0 (2026-03-16): 新增论坛管理Tab
 * - v1.8.0 (2026-02-27): 更新模型后自动测试 + 保存并测试回调
 * - v1.7.0 (2026-02-27): 模型弹窗传递onTest+testingModelId支持弹窗内测试
 * - v1.6.0 (2026-02-27): 修复删除模型不刷新列表 + 新增拖拽排序
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
  CloudServerOutlined,
  DollarOutlined,
  VideoCameraOutlined,
  BankOutlined,
  ShareAltOutlined,
  ScanOutlined,
  CalendarOutlined,
  BookOutlined,
  RocketOutlined,
  CommentOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import useSystemConfigStore from '../../stores/systemConfigStore'
import { ROLES, hasPermission } from '../../utils/permissions'

/* 导入子组件（移除SystemPromptSettings） */
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
  UsageLogs,
  ImageModelSettings,
  VideoModelSettings,
  SSOSettings,
  HtmlEditorSettings,
  OSSSettings,
  StorageCreditsConfig,
  OrgApplicationManagement,
  MindmapCreditsConfig,
  OcrSettings,
  CalendarConfigSettings,
  TeachingManagement,
  SmartAppSettings,
  EmbeddingSettings,
  ForumManagement
} from '../../components/admin/settings'

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
    updateModelSortOrder,
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

  const [settingsForm] = Form.useForm()
  const [modelForm] = Form.useForm()
  const [moduleForm] = Form.useForm()
  
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
  const canManageTeaching = isSuperAdmin || isGroupAdmin

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

  useEffect(() => {
    if (systemSettings && Object.keys(systemSettings).length > 0) {
      settingsForm.setFieldsValue(systemSettings)
    }
  }, [systemSettings, settingsForm])

  useEffect(() => {
    if (aiModels.length > 0 && systemSettings?.ai && !systemSettings.ai.default_model) {
      const firstActiveModel = aiModels.find(m => m.is_active)
      if (firstActiveModel) {
        settingsForm.setFieldValue(['ai', 'default_model'], firstActiveModel.name)
      }
    }
  }, [aiModels, systemSettings, settingsForm])

  const handleSaveSettings = async (values) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try {
      setSettingsLoading(true)
      await updateSystemSettings(values)
      const result = await updateSystemConfig(values)
      if (result.success) { message.success(t('admin.settings.save.success')) }
      else { message.error(result.error || t('admin.settings.save.failed')) }
    } catch (error) { message.error(t('admin.settings.save.failed')) }
    finally { setSettingsLoading(false) }
  }

  const handleCreateModel = async (values) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try {
      await createAIModel(values)
      setIsModelModalVisible(false)
      modelForm.resetFields()
      message.success(t('admin.models.success.create'))
      await getAIModels()
    } catch (error) { message.error(error.response?.data?.message || t('admin.models.error.create')) }
  }

  const handleUpdateModel = async (values) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try {
      const updateData = { ...values }
      if (!updateData.api_key) delete updateData.api_key
      if (!updateData.api_endpoint) delete updateData.api_endpoint
      await updateAIModel(editingModel.id, updateData)
      setIsModelModalVisible(false)
      setEditingModel(null)
      modelForm.resetFields()
      message.success(t('admin.models.success.update'))
      await getAIModels()
      handleTestModel(editingModel.id)
    } catch (error) { message.error(error.response?.data?.message || t('admin.models.error.update')) }
  }

  const handleDeleteModel = async (modelId) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try {
      await deleteAIModel(modelId)
      message.success(t('admin.models.success.delete'))
      await getAIModels()
    } catch (error) { message.error(error.response?.data?.message || t('admin.models.error.delete')) }
  }

  const handleTestModel = async (modelId) => {
    setTestingModelId(modelId)
    try {
      const result = await testAIModel(modelId)
      if (result.success && result.data) {
        if (result.data.success) { message.success(t('admin.models.test.success')) }
        else { message.warning(t('admin.models.test.failed', { message: result.data.message })) }
        await getAIModels()
      } else { message.error(result.message || t('admin.models.test.error')) }
    } catch (error) { message.error(error.message || t('admin.models.test.error')) }
    finally { setTestingModelId(null) }
  }

  const handleSaveAndTest = async (values) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    const modelId = editingModel?.id
    if (!modelId) return
    try {
      const updateData = { ...values }
      if (!updateData.api_key) delete updateData.api_key
      if (!updateData.api_endpoint) delete updateData.api_endpoint
      await updateAIModel(modelId, updateData)
      setIsModelModalVisible(false)
      setEditingModel(null)
      modelForm.resetFields()
      message.success(t('admin.models.success.update'))
      await getAIModels()
      handleTestModel(modelId)
    } catch (error) { message.error(error.response?.data?.message || t('admin.models.error.update')) }
  }

  const handleEditModel = (model) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    setEditingModel(model)
    modelForm.setFieldsValue({
      name: model.name,
      display_name: model.display_name,
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
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try { await updateAIModel(modelId, { stream_enabled: streamEnabled }); message.success(t('admin.models.success.update')); await getAIModels() }
    catch (error) { message.error(t('admin.models.error.update')) }
  }

  const handleToggleImageUploadEnabled = async (modelId, imageUploadEnabled) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try { await updateAIModel(modelId, { image_upload_enabled: imageUploadEnabled }); message.success(t('admin.models.success.update')); await getAIModels() }
    catch (error) { message.error(t('admin.models.error.update')) }
  }

  const handleToggleDocumentUploadEnabled = async (modelId, documentUploadEnabled) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try { await updateAIModel(modelId, { document_upload_enabled: documentUploadEnabled }); message.success(t('admin.models.success.update')); await getAIModels() }
    catch (error) { message.error(t('admin.models.error.update')) }
  }

  const handleDragSort = async (sortedModels) => {
    try {
      const sortOrders = sortedModels.map((model, index) => ({ id: model.id, sort_order: index }))
      await updateModelSortOrder(sortOrders, sortedModels)
      message.success(t('admin.models.success.sort', { defaultValue: '模型排序已更新' }))
    } catch (error) { message.error(t('admin.models.error.sort', { defaultValue: '模型排序更新失败' })) }
  }

  const handleCreateModule = async (values) => {
    try { await createModule(values); setIsModuleModalVisible(false); moduleForm.resetFields(); message.success(t('admin.modules.success.create')) }
    catch (error) { message.error(error.response?.data?.message || t('admin.modules.error.create')) }
  }

  const handleUpdateModule = async (values) => {
    try { await updateModule(editingModule.id, values); setIsModuleModalVisible(false); setEditingModule(null); moduleForm.resetFields(); message.success(t('admin.modules.success.update')) }
    catch (error) { message.error(error.response?.data?.message || t('admin.modules.error.update')) }
  }

  const handleDeleteModule = async (moduleId) => {
    try { await deleteModule(moduleId); message.success(t('admin.modules.success.delete')) }
    catch (error) { message.error(error.response?.data?.message || t('admin.modules.error.delete')) }
  }

  const handleEditModule = (module) => { setEditingModule(module); setIsModuleModalVisible(true) }

  const handleCheckModuleHealth = async (moduleId) => {
    setCheckingModuleId(moduleId)
    try {
      const result = await checkModuleHealth(moduleId)
      if (result.success) { message.success(t('admin.modules.checkHealth.success')) }
      else { message.warning(t('admin.modules.checkHealth.failed')) }
    } catch (error) { message.error(t('admin.modules.checkHealth.error')) }
    finally { setCheckingModuleId(null) }
  }

  const handleToggleModuleStatus = async (moduleId, isActive) => {
    try { await toggleModuleStatus(moduleId, isActive); message.success(t('admin.modules.success.update')) }
    catch (error) { message.error(t('admin.modules.error.update')) }
  }

  const handleDeleteApiService = async (serviceId) => {
    if (!isSuperAdmin) { message.warning(t('admin.noPermission')); return }
    try { await deleteApiService(serviceId); message.success(t('admin.apiServices.success.delete')) }
    catch (error) { message.error(error.response?.data?.message || t('admin.apiServices.error.delete')) }
  }

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

  /* Tab配置项 — v2.0 移除系统提示词Tab */
  const tabItems = [
    {
      key: 'statistics',
      label: <span><BarChartOutlined />{t('admin.settings.tabs.statistics')}</span>,
      children: <SystemStats systemStats={systemStats} />
    },
    {
      key: 'usageLogs',
      label: <span><HistoryOutlined />{t('admin.settings.tabs.usageLogs')}</span>,
      children: <UsageLogs />
    },
    ...(canManageTeaching ? [{
      key: 'teaching',
      label: (
        <span>
          <BookOutlined />
          {t('admin.settings.tabs.teaching')}
          {isGroupAdmin && <Tag color="blue" style={{ marginLeft: 8 }}>{t('admin.settings.tabs.teaching.thisGroup')}</Tag>}
        </span>
      ),
      children: <TeachingManagement />
    }] : []),
    ...(isSuperAdmin ? [{
      key: 'health',
      label: <span><HeartOutlined />{t('admin.settings.tabs.systemHealth')}</span>,
      children: <SystemHealthMonitor onRefresh={getSystemHealth} />
    }] : []),
    {
      key: 'models',
      label: <span><RobotOutlined />{t('admin.settings.tabs.models')}</span>,
      children: (
        <Card 
          title={
            <Space>
              <RobotOutlined />
              <span>{t('admin.models.config')}</span>
              <Tag color="blue">💰 {t('admin.models.creditsSystem')}</Tag>
              <Tag color="processing" icon={<ThunderboltOutlined />}>🚀 {t('admin.models.streamOutput')}</Tag>
              <Tag color="success" icon={<FileImageOutlined />}>🖼️ {t('admin.models.imageUpload')}</Tag>
              <Tag color="orange" icon={<FileTextOutlined />}>📄 {t('admin.models.documentUpload')}</Tag>
              <Tag color="green">🔓 {t('admin.models.noOutputLimit')}</Tag>
            </Space>
          }
          extra={
            isSuperAdmin && (
              <Button type="primary" icon={<PlusOutlined />}
                onClick={() => { setEditingModel(null); modelForm.resetFields(); setIsModelModalVisible(true) }}>
                {t('admin.models.addModel')}
              </Button>
            )
          }
        >
          <AIModelTable
            models={aiModels} loading={loading} testingModelId={testingModelId}
            onTest={handleTestModel} onEdit={handleEditModel} onDelete={handleDeleteModel}
            onToggleStreamEnabled={handleToggleStreamEnabled}
            onToggleImageUploadEnabled={handleToggleImageUploadEnabled}
            onToggleDocumentUploadEnabled={handleToggleDocumentUploadEnabled}
            onDragSort={isSuperAdmin ? handleDragSort : undefined}
          />
        </Card>
      )
    },
    ...(isSuperAdmin ? [
      {
        key: 'smartApps',
        label: <span><RocketOutlined />{t('admin.settings.tabs.smartApps')}</span>,
        children: <SmartAppSettings />
      },
      {
        key: 'forumManagement',
        label: <span><CommentOutlined />{t('forum.admin.title')}</span>,
        children: <ForumManagement />
      },
      {
        key: 'imageModels',
        label: <span><PictureOutlined />{t('admin.settings.tabs.imageModels')}</span>,
        children: <ImageModelSettings />
      },
      {
        key: 'videoModels',
        label: <span><VideoCameraOutlined />{t('admin.settings.tabs.videoModels')}</span>,
        children: <VideoModelSettings />
      },
      {
        key: 'ocrSettings',
        label: <span><ScanOutlined />{t('admin.settings.tabs.ocrSettings')}</span>,
        children: <OcrSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'embeddingSettings',
        label: <span><ThunderboltOutlined />Embedding配置</span>,
        children: <EmbeddingSettings disabled={!isSuperAdmin} />
      },
      /* v2.0: 系统提示词Tab已移除 */
      {
        key: 'modules',
        label: <span><AppstoreOutlined />{t('admin.settings.tabs.modules')}</span>,
        children: (
          <Card
            title={t('admin.modules.title')}
            extra={
              <Button type="primary" icon={<PlusOutlined />}
                onClick={() => { setEditingModule(null); moduleForm.resetFields(); setIsModuleModalVisible(true) }}>
                {t('admin.modules.addModule')}
              </Button>
            }
          >
            <SystemModuleTable
              modules={modules} loading={loading} checkingModuleId={checkingModuleId}
              onCheckHealth={handleCheckModuleHealth} onToggleStatus={handleToggleModuleStatus}
              onEdit={handleEditModule} onDelete={handleDeleteModule}
            />
          </Card>
        )
      },
      {
        key: 'apiServices',
        label: <span><ApiOutlined />{t('admin.settings.tabs.apiServices')}</span>,
        children: (
          <Card title={t('admin.settings.apiServices.title')}>
            <APIServiceTable services={apiServices} loading={loading}
              onRefresh={getApiServices} onDelete={handleDeleteApiService}
              adminStore={useAdminStore.getState()} />
          </Card>
        )
      },
      {
        key: 'orgApplications',
        label: <span><BankOutlined />{t('admin.settings.tabs.orgApplications')}</span>,
        children: <OrgApplicationManagement />
      },
      {
        key: 'ossSettings',
        label: <span><CloudServerOutlined />{t('admin.settings.tabs.ossSettings')}</span>,
        children: <OSSSettings />
      },
      {
        key: 'storageCredits',
        label: <span><DollarOutlined />{t('admin.settings.tabs.storageCredits')}</span>,
        children: <StorageCreditsConfig />
      },
      {
        key: 'mindmapCredits',
        label: <span><ShareAltOutlined />{t('admin.settings.tabs.mindmapCredits')}</span>,
        children: <MindmapCreditsConfig />
      },
      {
        key: 'calendarConfig',
        label: <span><CalendarOutlined />{t('admin.settings.tabs.calendarConfig')}</span>,
        children: <CalendarConfigSettings />
      }
    ] : []),
    {
      key: 'settings',
      label: <span><SettingOutlined />{t('admin.settings.tabs.basic')}</span>,
      children: (
        <BasicSettings form={settingsForm} aiModels={aiModels} loading={settingsLoading}
          onSubmit={handleSaveSettings} disabled={!isSuperAdmin} />
      )
    },
    ...(isSuperAdmin ? [
      {
        key: 'htmlEditor',
        label: <span><CodeOutlined />{t('admin.settings.tabs.htmlEditor')}</span>,
        children: <HtmlEditorSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'theme',
        label: <span><BgColorsOutlined />{t('admin.settings.tabs.theme')}</span>,
        children: <ThemeSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'rateLimit',
        label: <span><ThunderboltOutlined />{t('admin.settings.tabs.rateLimit')}</span>,
        children: <RateLimitSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'email',
        label: <span><MailOutlined />{t('admin.settings.tabs.email')}</span>,
        children: <EmailSettings disabled={!isSuperAdmin} />
      },
      {
        key: 'sso',
        label: <span><KeyOutlined />{t('admin.settings.tabs.sso')}</span>,
        children: <SSOSettings />
      },
      {
        key: 'customHomepage',
        label: <span><GlobalOutlined />{t('admin.settings.tabs.customHomepage')}</span>,
        children: <CustomHomepage disabled={!isSuperAdmin} />
      }
    ] : [])
  ]
  
  return (
    <div className="page-container">
      <style>
        {`
          .settings-tabs .ant-tabs-nav-wrap { flex-wrap: wrap !important; height: auto !important; }
          .settings-tabs .ant-tabs-nav-list { flex-wrap: wrap !important; height: auto !important; }
          .settings-tabs .ant-tabs-tab { margin-bottom: 8px !important; }
          .settings-tabs .ant-tabs-ink-bar { display: none !important; }
          .settings-tabs .ant-tabs-nav::before { border-bottom: none !important; }
        `}
      </style>
      
      <Tabs defaultActiveKey="statistics" type="card" className="settings-tabs" items={tabItems} />

      {isSuperAdmin && (
        <AIModelFormModal
          visible={isModelModalVisible} editingModel={editingModel} form={modelForm} loading={loading}
          onSubmit={editingModel ? handleUpdateModel : handleCreateModel}
          onCancel={() => { setIsModelModalVisible(false); setEditingModel(null); modelForm.resetFields() }}
          onSaveAndTest={handleSaveAndTest} testingModelId={testingModelId}
        />
      )}

      {isSuperAdmin && (
        <SystemModuleFormModal
          visible={isModuleModalVisible} editingModule={editingModule} form={moduleForm} loading={loading}
          onSubmit={editingModule ? handleUpdateModule : handleCreateModule}
          onCancel={() => { setIsModuleModalVisible(false); setEditingModule(null); moduleForm.resetFields() }}
        />
      )}
    </div>
  )
}

export default Settings
