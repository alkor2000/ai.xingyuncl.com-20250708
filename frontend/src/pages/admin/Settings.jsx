import React, { useEffect, useState } from 'react'
import {
  Card,
  Form,
  Input,
  Button,
  Switch,
  InputNumber,
  Select,
  Table,
  Modal,
  Space,
  Row,
  Col,
  Statistic,
  Typography,
  Tag,
  Tabs,
  message,
  Tooltip,
  Popconfirm,
  Badge
} from 'antd'
import {
  SaveOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  SettingOutlined,
  RobotOutlined,
  BarChartOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ApiOutlined,
  WalletOutlined,
  DollarOutlined
} from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'

const { TextArea } = Input
const { TabPane } = Tabs
const { Title, Text } = Typography

const Settings = () => {
  const { hasPermission } = useAuthStore()
  const {
    aiModels,
    modules,
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
    checkModuleHealth,
    getSystemStats,
    getSystemSettings,
    updateSystemSettings
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
  const [showApiKey, setShowApiKey] = useState({})

  useEffect(() => {
    if (hasPermission('system.all')) {
      getSystemStats()
      getAIModels()
      getModules()
      getSystemSettings()
    }
  }, [hasPermission])

  useEffect(() => {
    if (systemSettings && Object.keys(systemSettings).length > 0) {
      settingsForm.setFieldsValue(systemSettings)
    }
  }, [systemSettings, settingsForm])

  // 保存系统设置
  const handleSaveSettings = async (values) => {
    try {
      await updateSystemSettings(values)
      message.success('系统设置保存成功')
    } catch (error) {
      message.error('系统设置保存失败')
    }
  }

  // 创建AI模型
  const handleCreateModel = async (values) => {
    try {
      await createAIModel(values)
      setIsModelModalVisible(false)
      modelForm.resetFields()
      message.success('AI模型创建成功')
    } catch (error) {
      message.error(error.response?.data?.message || 'AI模型创建失败')
    }
  }

  // 更新AI模型
  const handleUpdateModel = async (values) => {
    try {
      await updateAIModel(editingModel.id, values)
      setIsModelModalVisible(false)
      setEditingModel(null)
      modelForm.resetFields()
      message.success('AI模型更新成功')
    } catch (error) {
      message.error(error.response?.data?.message || 'AI模型更新失败')
    }
  }

  // 删除AI模型
  const handleDeleteModel = async (modelId) => {
    try {
      await deleteAIModel(modelId)
      message.success('AI模型删除成功')
    } catch (error) {
      message.error(error.response?.data?.message || 'AI模型删除失败')
    }
  }

  // 测试AI模型
  const handleTestModel = async (modelId) => {
    setTestingModelId(modelId)
    try {
      const result = await testAIModel(modelId)
      if (result.success && result.data) {
        if (result.data.success) {
          message.success('连通性测试成功')
        } else {
          message.warning(`连通性测试失败：${result.data.message}`)
        }
        await getAIModels()
      } else {
        message.error(result.message || '测试失败')
      }
    } catch (error) {
      console.error('测试失败:', error)
      message.error(error.message || '连通性测试出错')
    } finally {
      setTestingModelId(null)
    }
  }

  // 编辑AI模型
  const handleEditModel = (model) => {
    setEditingModel(model)
    modelForm.setFieldsValue({
      name: model.name,
      display_name: model.display_name,
      api_key: '',
      api_endpoint: '',
      credits_per_chat: model.credits_per_chat,
      is_active: model.is_active,
      sort_order: model.sort_order
    })
    setIsModelModalVisible(true)
  }

  // 创建系统模块
  const handleCreateModule = async (values) => {
    try {
      await createModule(values)
      setIsModuleModalVisible(false)
      moduleForm.resetFields()
      message.success('系统模块创建成功')
    } catch (error) {
      message.error(error.response?.data?.message || '系统模块创建失败')
    }
  }

  // 更新系统模块
  const handleUpdateModule = async (values) => {
    try {
      await updateModule(editingModule.id, values)
      setIsModuleModalVisible(false)
      setEditingModule(null)
      moduleForm.resetFields()
      message.success('系统模块更新成功')
    } catch (error) {
      message.error(error.response?.data?.message || '系统模块更新失败')
    }
  }

  // 删除系统模块
  const handleDeleteModule = async (moduleId) => {
    try {
      await deleteModule(moduleId)
      message.success('系统模块删除成功')
    } catch (error) {
      message.error(error.response?.data?.message || '系统模块删除失败')
    }
  }

  // 编辑系统模块
  const handleEditModule = (module) => {
    setEditingModule(module)
    moduleForm.setFieldsValue({
      name: module.name,
      display_name: module.display_name,
      description: module.description,
      module_type: module.module_type,
      api_endpoint: module.api_endpoint,
      frontend_url: module.frontend_url,
      proxy_path: module.proxy_path,
      auth_mode: module.auth_mode,
      is_active: module.is_active,
      permissions: module.permissions || [],
      config: module.config || {},
      health_check_url: module.health_check_url
    })
    setIsModuleModalVisible(true)
  }

  // 检查模块健康状态
  const handleCheckModuleHealth = async (moduleId) => {
    setCheckingModuleId(moduleId)
    try {
      const result = await checkModuleHealth(moduleId)
      if (result.success) {
        message.success(`健康检查完成：${result.data.message}`)
      } else {
        message.warning('健康检查失败')
      }
    } catch (error) {
      message.error('健康检查出错')
    } finally {
      setCheckingModuleId(null)
    }
  }

  // 切换模块启用状态
  const handleToggleModuleStatus = async (moduleId, isActive) => {
    try {
      await updateModule(moduleId, { is_active: isActive })
      message.success(isActive ? '模块已启用' : '模块已禁用')
    } catch (error) {
      message.error('操作失败')
    }
  }

  // 渲染测试状态
  const renderTestStatus = (status, lastTestedAt, modelId) => {
    if (testingModelId === modelId) {
      return (
        <Tag icon={<ClockCircleOutlined />} color="processing">
          测试中...
        </Tag>
      )
    }

    switch (status) {
      case 'success':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            正常
          </Tag>
        )
      case 'failed':
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            失败
          </Tag>
        )
      default:
        return (
          <Tag icon={<QuestionCircleOutlined />} color="default">
            未测试
          </Tag>
        )
    }
  }

  // 渲染模块状态
  const renderModuleStatus = (status) => {
    switch (status) {
      case 'online':
        return <Tag color="success">在线</Tag>
      case 'offline':
        return <Tag color="error">离线</Tag>
      case 'error':
        return <Tag color="error">错误</Tag>
      default:
        return <Tag color="default">未知</Tag>
    }
  }

  // AI模型表格列 (增强积分配置显示)
  const modelColumns = [
    {
      title: '模型名称',
      dataIndex: 'name',
      key: 'name',
      width: 150
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      key: 'display_name'
    },
    {
      title: '积分消费',
      dataIndex: 'credits_per_chat',
      key: 'credits_per_chat',
      width: 120,
      render: (credits) => (
        <Space>
          <WalletOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontWeight: 'bold', color: '#1677ff' }}>
            {credits}/次
          </span>
        </Space>
      )
    },
    {
      title: 'API密钥',
      dataIndex: 'api_key',
      key: 'api_key',
      render: (apiKey, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 100 }}>
            {showApiKey[record.id] ? 
              (apiKey ? `${apiKey.substring(0, 20)}...` : '未配置') : 
              '••••••••••••••••••••'
            }
          </span>
          <Button
            type="text"
            size="small"
            icon={showApiKey[record.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setShowApiKey(prev => ({ ...prev, [record.id]: !prev[record.id] }))}
          />
        </div>
      )
    },
    {
      title: '状态',
      key: 'status',
      render: (_, record) => (
        <Space>
          {record.is_active ? (
            <Tag color="success">启用</Tag>
          ) : (
            <Tag color="default">禁用</Tag>
          )}
          {renderTestStatus(record.test_status, record.last_tested_at, record.id)}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="测试连通性">
            <Button
              type="text"
              size="small"
              icon={<ExperimentOutlined />}
              loading={testingModelId === record.id}
              onClick={() => handleTestModel(record.id)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditModel(record)}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Popconfirm
              title="确定删除这个AI模型吗？"
              onConfirm={() => handleDeleteModel(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      )
    }
  ]

  // 系统模块表格列
  const moduleColumns = [
    {
      title: '模块名称',
      dataIndex: 'display_name', 
      key: 'display_name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{record.name}</div>
        </div>
      )
    },
    {
      title: '类型',
      dataIndex: 'module_type',
      key: 'module_type',
      render: (type) => {
        const typeMap = {
          'frontend': { color: 'blue', text: '前端' },
          'backend': { color: 'green', text: '后端' },
          'fullstack': { color: 'purple', text: '全栈' }
        }
        const config = typeMap[type] || { color: 'default', text: type }
        return <Tag color={config.color}>{config.text}</Tag>
      }
    },
    {
      title: '代理路径',
      dataIndex: 'proxy_path',
      key: 'proxy_path',
      render: (path) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>
          {path}
        </span>
      )
    },
    {
      title: '状态',
      key: 'status',
      render: (_, record) => (
        <Space>
          <Badge 
            status={record.is_active ? 'success' : 'default'} 
            text={record.is_active ? '启用' : '禁用'} 
          />
          {renderModuleStatus(record.status)}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="健康检查">
            <Button
              type="text"
              size="small"
              icon={<ApiOutlined />}
              loading={checkingModuleId === record.id}
              onClick={() => handleCheckModuleHealth(record.id)}
            />
          </Tooltip>
          <Tooltip title={record.is_active ? '禁用' : '启用'}>
            <Button
              type="text"
              size="small"
              icon={record.is_active ? <StopOutlined /> : <PlayCircleOutlined />}
              onClick={() => handleToggleModuleStatus(record.id, !record.is_active)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditModule(record)}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Popconfirm
              title="确定删除这个模块吗？"
              onConfirm={() => handleDeleteModule(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      )
    }
  ]

  // 权限检查
  if (!hasPermission('system.all')) {
    return (
      <div className="page-container">
        <Card>
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <p>您没有访问系统设置的权限</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Tabs defaultActiveKey="statistics" type="card">
        {/* 系统统计 (增强积分统计) */}
        <TabPane tab={<span><BarChartOutlined />系统统计</span>} key="statistics">
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="用户统计" size="small">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic 
                      title="总用户数" 
                      value={systemStats.users?.total_users || 0} 
                      valueStyle={{ color: '#1677ff' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="活跃用户" 
                      value={systemStats.users?.active_users || 0} 
                      valueStyle={{ color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="总积分配额" 
                      value={systemStats.users?.total_credits_quota || 0} 
                      valueStyle={{ color: '#722ed1' }}
                      formatter={value => value?.toLocaleString()}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="已用积分" 
                      value={systemStats.users?.total_credits_used || 0} 
                      valueStyle={{ color: '#fa8c16' }}
                      formatter={value => value?.toLocaleString()}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="对话统计" size="small">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic 
                      title="总对话数" 
                      value={systemStats.conversations?.total_conversations || 0} 
                      valueStyle={{ color: '#1677ff' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="总消息数" 
                      value={systemStats.conversations?.total_messages || 0} 
                      valueStyle={{ color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={24}>
                    <Statistic 
                      title="平均每会话消息" 
                      value={systemStats.conversations?.avg_messages_per_conversation || 0} 
                      precision={1}
                      valueStyle={{ color: '#fa8c16' }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>

            <Col xs={24}>
              <Card title="AI模型使用排行" size="small">
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {systemStats.models?.map((model, index) => (
                    <div key={model.model_name} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: index < systemStats.models.length - 1 ? '1px solid #f0f0f0' : 'none'
                    }}>
                      <Space>
                        <span>#{index + 1} {model.model_name}</span>
                        {model.credits_per_chat && (
                          <Tag color="blue" size="small">
                            💰 {model.credits_per_chat} 积分/次
                          </Tag>
                        )}
                      </Space>
                      <Space>
                        <span>{model.conversation_count} 次对话</span>
                        {model.total_credits_consumed && (
                          <span style={{ color: '#722ed1' }}>
                            🪙 {model.total_credits_consumed?.toLocaleString()} 积分
                          </span>
                        )}
                        <span style={{ color: '#999' }}>
                          {model.total_tokens?.toLocaleString()} tokens
                        </span>
                      </Space>
                    </div>
                  )) || <div style={{ color: '#999' }}>暂无数据</div>}
                </div>
              </Card>
            </Col>
          </Row>
        </TabPane>

        {/* AI模型管理 (增强积分配置) */}
        <TabPane tab={<span><RobotOutlined />AI模型管理</span>} key="models">
          <Card 
            title={
              <Space>
                <RobotOutlined />
                <span>AI模型配置</span>
                <Tag color="blue">💰 积分计费</Tag>
              </Space>
            }
            extra={
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingModel(null)
                  modelForm.resetFields()
                  setIsModelModalVisible(true)
                }}
              >
                添加模型
              </Button>
            }
          >
            <Table
              columns={modelColumns}
              dataSource={aiModels}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </TabPane>

        {/* 模块接入 */}
        <TabPane tab={<span><AppstoreOutlined />模块接入</span>} key="modules">
          <Card
            title="系统模块管理"
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
                添加模块
              </Button>
            }
          >
            <Table
              columns={moduleColumns}
              dataSource={modules}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </TabPane>

        {/* 基础设置 (增强积分设置) */}
        <TabPane tab={<span><SettingOutlined />基础设置</span>} key="settings">
          <Form
            form={settingsForm}
            layout="vertical"
            onFinish={handleSaveSettings}
          >
            <Row gutter={24}>
              <Col xs={24} lg={12}>
                <Card title="站点设置" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item name={['site', 'name']} label="站点名称">
                    <Input placeholder="AI Platform" />
                  </Form.Item>
                  
                  <Form.Item name={['site', 'description']} label="站点描述">
                    <TextArea rows={3} placeholder="企业级AI应用聚合平台" />
                  </Form.Item>
                </Card>

                <Card title="用户设置" size="small">
                  <Form.Item name={['user', 'allow_register']} label="允许用户注册" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  
                  <Form.Item name={['user', 'email_verification']} label="邮箱验证" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  
                  <Form.Item name={['user', 'default_token_quota']} label="默认Token配额">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>

                  <Form.Item name={['user', 'default_credits_quota']} label="默认积分配额">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="AI设置" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item name={['ai', 'default_model']} label="默认AI模型">
                    <Select>
                      {aiModels.filter(m => m.is_active).map(model => (
                        <Select.Option key={model.name} value={model.name}>
                          <Space>
                            <span>{model.display_name}</span>
                            <Tag color="blue" size="small">{model.credits_per_chat}积分</Tag>
                          </Space>
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  
                  <Form.Item name={['ai', 'max_tokens']} label="默认最大Token数">
                    <InputNumber style={{ width: '100%' }} min={1} max={32768} />
                  </Form.Item>
                  
                  <Form.Item name={['ai', 'temperature']} label="默认Temperature">
                    <InputNumber style={{ width: '100%' }} min={0} max={2} step={0.1} />
                  </Form.Item>
                </Card>

                <Card title="积分设置" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item name={['credits', 'enable_credits']} label="启用积分系统" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  
                  <Form.Item name={['credits', 'default_credits']} label="新用户默认积分">
                    <InputNumber 
                      style={{ width: '100%' }} 
                      min={0} 
                      max={100000}
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Form.Item>
                  
                  <Form.Item name={['credits', 'min_credits_for_chat']} label="对话最低积分要求">
                    <InputNumber style={{ width: '100%' }} min={1} max={100} />
                  </Form.Item>
                </Card>

                <Card title="安全设置" size="small">
                  <Form.Item name={['security', 'session_timeout']} label="会话超时时间(分钟)">
                    <InputNumber style={{ width: '100%' }} min={5} max={1440} />
                  </Form.Item>
                  
                  <Form.Item name={['security', 'max_login_attempts']} label="最大登录尝试次数">
                    <InputNumber style={{ width: '100%' }} min={1} max={10} />
                  </Form.Item>
                  
                  <Form.Item name={['security', 'enable_rate_limit']} label="启用访问限流" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Card>
              </Col>
            </Row>

            <Form.Item style={{ textAlign: 'center', marginTop: 24 }}>
              <Space>
                <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={loading}>
                  保存设置
                </Button>
                <Button onClick={() => settingsForm.resetFields()}>
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </TabPane>
      </Tabs>

      {/* AI模型创建/编辑弹窗 (增强积分配置) */}
      <Modal
        title={editingModel ? '编辑AI模型' : '创建AI模型'}
        open={isModelModalVisible}
        onCancel={() => {
          setIsModelModalVisible(false)
          setEditingModel(null)
          modelForm.resetFields()
        }}
        footer={null}
        destroyOnClose
        width={700}
      >
        <Form
          form={modelForm}
          layout="vertical"
          onFinish={editingModel ? handleUpdateModel : handleCreateModel}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="模型名称"
                rules={[{ required: true, message: '请输入模型名称' }]}
              >
                <Input placeholder="如: gpt-3.5-turbo" disabled={!!editingModel} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="display_name"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="如: GPT-3.5 Turbo" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="api_key"
                label="API密钥"
                rules={[{ required: !editingModel, message: '请输入API密钥' }]}
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="api_endpoint"
                label="API端点"
                rules={[{ required: !editingModel, message: '请输入API端点' }]}
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
            </Col>
          </Row>

          {/* 积分配置区域 */}
          <Row gutter={16}>
            <Col span={24}>
              <Card 
                title={
                  <Space>
                    <WalletOutlined style={{ color: '#1677ff' }} />
                    <span>积分消费配置</span>
                  </Space>
                } 
                size="small" 
                style={{ marginBottom: 16 }}
              >
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      name="credits_per_chat"
                      label="每次对话积分消费"
                      rules={[{ required: true, message: '请设置积分消费' }]}
                      initialValue={10}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        max={1000}
                        addonAfter="积分/次"
                        formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value.replace(/\$\s?|(,*)/g, '')}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <div style={{ 
                      marginTop: 30, 
                      padding: '8px 12px',
                      backgroundColor: '#f6f8fa',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#586069'
                    }}>
                      💡 建议范围：基础模型1-20积分，高级模型20-100积分
                    </div>
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="is_active" label="启用状态" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sort_order" label="排序">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => {
                setIsModelModalVisible(false)
                setEditingModel(null)
                modelForm.resetFields()
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingModel ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 系统模块创建/编辑弹窗 (保持不变) */}
      <Modal
        title={editingModule ? '编辑系统模块' : '创建系统模块'}
        open={isModuleModalVisible}
        onCancel={() => {
          setIsModuleModalVisible(false)
          setEditingModule(null)
          moduleForm.resetFields()
        }}
        footer={null}
        destroyOnClose
        width={800}
      >
        <Form
          form={moduleForm}
          layout="vertical"
          onFinish={editingModule ? handleUpdateModule : handleCreateModule}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="模块标识"
                rules={[{ required: true, message: '请输入模块标识' }]}
              >
                <Input placeholder="如: ai-image-generator" disabled={!!editingModule} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="display_name"
                label="显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="如: AI图像生成" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="模块描述">
            <TextArea rows={2} placeholder="描述模块的功能和用途" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="module_type" label="模块类型" rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="frontend">前端模块</Select.Option>
                  <Select.Option value="backend">后端模块</Select.Option>
                  <Select.Option value="fullstack">全栈模块</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="auth_mode" label="认证模式" rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="jwt">JWT认证</Select.Option>
                  <Select.Option value="oauth">OAuth认证</Select.Option>
                  <Select.Option value="none">无认证</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="proxy_path"
                label="代理路径"
                rules={[{ required: true, message: '请输入代理路径' }]}
              >
                <Input placeholder="/image-generation" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="api_endpoint" label="后端API地址">
                <Input placeholder="http://localhost:5000/api" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="frontend_url" label="前端地址">
                <Input placeholder="http://localhost:5001" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="health_check_url" label="健康检查地址">
            <Input placeholder="http://localhost:5000/health" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="permissions" label="所需权限">
                <Select mode="tags" placeholder="添加权限标识">
                  <Select.Option value="image.generate">image.generate</Select.Option>
                  <Select.Option value="image.view">image.view</Select.Option>
                  <Select.Option value="code.generate">code.generate</Select.Option>
                  <Select.Option value="document.process">document.process</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="is_active" label="启用状态" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => {
                setIsModuleModalVisible(false)
                setEditingModule(null)
                moduleForm.resetFields()
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingModule ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Settings
