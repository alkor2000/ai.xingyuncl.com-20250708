import React, { useEffect, useState } from 'react'
import { 
  Card, 
  Form, 
  Input, 
  Switch, 
  Button, 
  Space, 
  Divider, 
  InputNumber,
  message,
  Tabs,
  Table,
  Modal,
  Select,
  Tag,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Tooltip
} from 'antd'
import { 
  SettingOutlined, 
  SaveOutlined, 
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  RobotOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'

const { TextArea } = Input
const { TabPane } = Tabs

const Settings = () => {
  const { hasPermission } = useAuthStore()
  const {
    aiModels,
    systemStats,
    systemSettings,
    loading,
    getAIModels,
    createAIModel,
    updateAIModel,
    deleteAIModel,
    testAIModel,
    getSystemStats,
    getSystemSettings,
    updateSystemSettings
  } = useAdminStore()

  const [settingsForm] = Form.useForm()
  const [modelForm] = Form.useForm()
  const [isModelModalVisible, setIsModelModalVisible] = useState(false)
  const [editingModel, setEditingModel] = useState(null)
  const [testingModelId, setTestingModelId] = useState(null)
  const [showApiKey, setShowApiKey] = useState({})
  const [showApiEndpoint, setShowApiEndpoint] = useState({})

  // 组件加载时获取数据
  useEffect(() => {
    if (hasPermission('system.all')) {
      getAIModels()
      getSystemStats()
      getSystemSettings()
    }
  }, [])

  // 当系统设置加载完成后，设置表单值
  useEffect(() => {
    if (systemSettings && Object.keys(systemSettings).length > 0) {
      settingsForm.setFieldsValue(systemSettings)
    }
  }, [systemSettings])

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
        // 重新获取模型列表以更新状态
        await getAIModels()
      } else {
        message.error(result.message || '测试失败')
      }
    } catch (error) {
      console.error('测试失败:', error)
      if (error.message === '认证失败，请重新登录') {
        message.error('认证失败，请刷新页面重新登录')
      } else {
        message.error(error.message || '连通性测试出错')
      }
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
      api_key: '', // 不回显API密钥
      api_endpoint: '', // 不回显API端点
      is_active: model.is_active,
      sort_order: model.sort_order
    })
    setIsModelModalVisible(true)
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
          <Tooltip title={`最后测试时间: ${new Date(lastTestedAt).toLocaleString()}`}>
            <Tag icon={<CheckCircleOutlined />} color="success">
              已测试
            </Tag>
          </Tooltip>
        )
      case 'failed':
        return (
          <Tooltip title={`最后测试时间: ${new Date(lastTestedAt).toLocaleString()}`}>
            <Tag icon={<CloseCircleOutlined />} color="error">
              测试失败
            </Tag>
          </Tooltip>
        )
      default:
        return (
          <Tag icon={<QuestionCircleOutlined />} color="default">
            未测试
          </Tag>
        )
    }
  }

  // AI模型表格列
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
      title: 'API密钥',
      dataIndex: 'api_key',
      key: 'api_key',
      render: (apiKey, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 100 }}>
            {showApiKey[record.id] ? 
              (apiKey && apiKey !== '***已配置***' ? apiKey : '未配置') : 
              (apiKey ? '***已配置***' : '未配置')
            }
          </span>
          {apiKey && (
            <Button
              type="text"
              size="small"
              icon={showApiKey[record.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => {
                setShowApiKey(prev => ({
                  ...prev,
                  [record.id]: !prev[record.id]
                }))
              }}
            />
          )}
        </div>
      )
    },
    {
      title: 'API端点',
      dataIndex: 'api_endpoint',
      key: 'api_endpoint',
      render: (endpoint, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 100 }}>
            {showApiEndpoint[record.id] ? 
              (endpoint && endpoint !== '***已配置***' ? endpoint : '未配置') : 
              (endpoint ? '***已配置***' : '未配置')
            }
          </span>
          {endpoint && (
            <Button
              type="text"
              size="small"
              icon={showApiEndpoint[record.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => {
                setShowApiEndpoint(prev => ({
                  ...prev,
                  [record.id]: !prev[record.id]
                }))
              }}
            />
          )}
        </div>
      )
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '测试状态',
      key: 'test_status',
      render: (_, record) => renderTestStatus(record.test_status, record.last_tested_at, record.id)
    },
    {
      title: '使用次数',
      dataIndex: 'usage_count',
      key: 'usage_count',
      render: (count) => count?.toLocaleString() || 0
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order'
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button 
            size="small" 
            icon={<ExperimentOutlined />}
            loading={testingModelId === record.id}
            onClick={() => handleTestModel(record.id)}
            title="测试连通性"
            type={testingModelId === record.id ? 'primary' : 'default'}
          >
            测试
          </Button>
          <Button 
            size="small" 
            icon={<EditOutlined />}
            onClick={() => handleEditModel(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个模型吗？"
            onConfirm={() => handleDeleteModel(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button 
              size="small" 
              danger 
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  if (!hasPermission('system.all')) {
    return (
      <div className="page-container">
        <Card>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3>权限不足</h3>
            <p>您没有访问系统设置的权限</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Tabs defaultActiveKey="statistics" type="card">
        {/* 系统统计 */}
        <TabPane tab={<span><BarChartOutlined />系统统计</span>} key="statistics">
          <Row gutter={[16, 16]}>
            {/* 用户统计 */}
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
                      title="今日新增" 
                      value={systemStats.users?.today_new_users || 0} 
                      valueStyle={{ color: '#722ed1' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="管理员" 
                      value={(systemStats.users?.admins || 0) + (systemStats.users?.super_admins || 0)} 
                      valueStyle={{ color: '#fa8c16' }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>

            {/* 对话统计 */}
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
                  <Col span={12}>
                    <Statistic 
                      title="今日对话" 
                      value={systemStats.conversations?.today_conversations || 0} 
                      valueStyle={{ color: '#722ed1' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="今日活跃" 
                      value={systemStats.active?.daily_active_users || 0} 
                      valueStyle={{ color: '#fa8c16' }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>

            {/* Token统计 */}
            <Col xs={24} lg={12}>
              <Card title="Token使用统计" size="small">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic 
                      title="总配额" 
                      value={systemStats.tokens?.total_quota_tokens || 0} 
                      valueStyle={{ color: '#1677ff' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic 
                      title="已使用" 
                      value={systemStats.tokens?.total_used_tokens || 0} 
                      valueStyle={{ color: '#ff4d4f' }}
                    />
                  </Col>
                  <Col span={24}>
                    <Statistic 
                      title="平均使用率" 
                      value={systemStats.tokens?.total_quota_tokens ? 
                        ((systemStats.tokens.total_used_tokens / systemStats.tokens.total_quota_tokens) * 100).toFixed(2) : 0
                      } 
                      suffix="%" 
                      valueStyle={{ color: '#fa541c' }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>

            {/* 模型使用统计 */}
            <Col xs={24} lg={12}>
              <Card title="模型使用排行" size="small">
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {systemStats.models?.map((model, index) => (
                    <div key={model.model_name} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      padding: '8px 0',
                      borderBottom: index < systemStats.models.length - 1 ? '1px solid #f0f0f0' : 'none'
                    }}>
                      <span>{model.model_name}</span>
                      <Space>
                        <span>{model.conversation_count} 次</span>
                        <span style={{ color: '#999' }}>{model.total_tokens?.toLocaleString()} tokens</span>
                      </Space>
                    </div>
                  )) || <div style={{ color: '#999' }}>暂无数据</div>}
                </div>
              </Card>
            </Col>
          </Row>
        </TabPane>

        {/* AI模型管理 */}
        <TabPane tab={<span><RobotOutlined />AI模型管理</span>} key="models">
          <Card 
            title="AI模型配置"
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

        {/* 系统设置 */}
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
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="AI设置" size="small" style={{ marginBottom: 16 }}>
                  <Form.Item name={['ai', 'default_model']} label="默认AI模型">
                    <Select>
                      {aiModels.filter(m => m.is_active).map(model => (
                        <Select.Option key={model.name} value={model.name}>
                          {model.display_name}
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

                <Card title="安全设置" size="small">
                  <Form.Item name={['security', 'session_timeout']} label="会话超时时间(分钟)">
                    <InputNumber style={{ width: '100%' }} min={5} max={1440} />
                  </Form.Item>
                  
                  <Form.Item name={['security', 'max_login_attempts']} label="最大登录尝试次数">
                    <InputNumber style={{ width: '100%' }} min={3} max={10} />
                  </Form.Item>
                  
                  <Form.Item name={['security', 'enable_rate_limit']} label="启用API限流" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Card>
              </Col>
            </Row>

            <Divider />
            
            <Form.Item>
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

      {/* AI模型创建/编辑弹窗 */}
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
        width={600}
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

          <Form.Item
            name="api_key"
            label="API密钥"
            rules={[
              editingModel ? 
                { required: false } : 
                { required: true, message: '请输入API密钥' }
            ]}
          >
            <Input.Password 
              placeholder={editingModel ? "留空则不修改" : "请输入API密钥"} 
              visibilityToggle={false}
            />
          </Form.Item>

          <Form.Item
            name="api_endpoint"
            label="API端点"
            rules={[
              editingModel ? 
                { required: false } : 
                { required: true, message: '请输入API端点' }
            ]}
          >
            <Input placeholder={editingModel ? "留空则不修改" : "如: https://api.openai.com/v1"} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sort_order" label="排序" initialValue={0}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="is_active" label="启用状态" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingModel ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setIsModelModalVisible(false)
                setEditingModel(null)
                modelForm.resetFields()
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Settings
