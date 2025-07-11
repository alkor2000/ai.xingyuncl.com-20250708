import React, { useEffect, useState, useRef } from 'react'
import { 
  Layout, 
  Card, 
  Input, 
  Button, 
  List, 
  Typography, 
  Space, 
  Avatar,
  Dropdown,
  Modal,
  Form,
  Select,
  message,
  Spin,
  Empty,
  Tag,
  Alert,
  InputNumber,
  Tooltip
} from 'antd'
import {
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  RobotOutlined,
  UserOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  FireOutlined
} from '@ant-design/icons'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'
import MessageContent from '../../components/chat/MessageContent'

const { Sider, Content } = Layout
const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

const Chat = () => {
  const { user } = useAuthStore()
  const {
    conversations,
    currentConversation,
    messages,
    aiModels,
    userCredits,
    loading,
    typing,
    creditsLoading,
    getConversations,
    createConversation,
    selectConversation,
    sendMessage,
    updateConversation,
    deleteConversation,
    getAIModels,
    getUserCredits,
    checkCreditsForModel,
    getModelCredits
  } = useChatStore()

  const [messageInput, setMessageInput] = useState('')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [editingConversation, setEditingConversation] = useState(null)
  
  // 添加删除确认对话框状态
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  
  // 消息列表自动滚动引用
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)

  // 组件加载时获取数据 - 移除积分自动获取
  useEffect(() => {
    getConversations()
    getAIModels()
    // 移除: getUserCredits() - 只在需要时获取
  }, [])

  // 自动滚动到消息底部
  useEffect(() => {
    scrollToBottom()
  }, [messages, typing])

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'
      })
    }
  }

  // 创建新会话 - 保留积分检查但不显示详细信息
  const handleCreateConversation = async (values) => {
    try {
      // 静默检查积分是否足够
      if (!checkCreditsForModel(values.model_name)) {
        // 此时获取一次积分状态用于错误提示
        await getUserCredits()
        const requiredCredits = getModelCredits(values.model_name)
        message.error(`积分不足，无法创建会话`)
        return
      }

      await createConversation({
        title: values.title || 'New Chat',
        model_name: values.model_name || 'gpt-3.5-turbo',
        system_prompt: values.system_prompt,
        context_length: values.context_length || 20,
        ai_temperature: values.ai_temperature !== undefined ? values.ai_temperature : 0.0
      })
      setIsModalVisible(false)
      form.resetFields()
      message.success('会话创建成功')
    } catch (error) {
      message.error(error.response?.data?.message || '会话创建失败')
    }
  }

  // 发送消息 - 保留积分检查但简化提示
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !currentConversation) {
      return
    }

    // 静默检查积分是否充足
    if (!checkCreditsForModel(currentConversation.model_name)) {
      message.error('积分不足，无法发送消息')
      return
    }

    try {
      const response = await sendMessage(messageInput.trim())
      setMessageInput('')
      
      // 简化成功提示 - 不显示具体积分数量
      message.success('消息发送成功！')
      
      // 发送后立即滚动到底部
      setTimeout(scrollToBottom, 100)
    } catch (error) {
      const errorMessage = error.response?.data?.message || '消息发送失败'
      message.error(errorMessage)
      
      // 如果是积分相关错误，静默刷新积分状态
      if (errorMessage.includes('积分')) {
        getUserCredits()
      }
    }
  }

  // 处理Enter键发送
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift+Enter 换行，保持默认行为
        return
      } else {
        // Enter 发送消息
        e.preventDefault()
        handleSendMessage()
      }
    }
  }

  // 编辑会话
  const handleEditConversation = (conversation) => {
    setEditingConversation(conversation)
    form.setFieldsValue({
      title: conversation.title,
      model_name: conversation.model_name,
      system_prompt: conversation.system_prompt,
      context_length: conversation.context_length || 20,
      ai_temperature: conversation.ai_temperature !== undefined ? conversation.ai_temperature : 0.0
    })
    setIsModalVisible(true)
  }

  // 更新会话
  const handleUpdateConversation = async (values) => {
    try {
      await updateConversation(editingConversation.id, values)
      setIsModalVisible(false)
      setEditingConversation(null)
      form.resetFields()
      message.success('会话更新成功')
    } catch (error) {
      message.error('会话更新失败')
    }
  }

  // 删除会话 - 显示自定义确认对话框
  const handleDeleteConversation = (conversationId) => {
    const targetConversation = conversations.find(c => c.id === conversationId)
    setConversationToDelete(targetConversation)
    setDeleteModalVisible(true)
  }

  // 确认删除会话
  const confirmDeleteConversation = async () => {
    if (!conversationToDelete) return
    
    try {
      setDeleting(true)
      await deleteConversation(conversationToDelete.id)
      
      setDeleteModalVisible(false)
      setConversationToDelete(null)
      setDeleting(false)
      message.success('会话删除成功')
      
      // 手动刷新会话列表
      await getConversations()
      
    } catch (error) {
      console.error('❌ 删除操作失败:', error)
      setDeleting(false)
      message.error(`会话删除失败: ${error.message || '未知错误'}`)
    }
  }

  // 取消删除
  const cancelDeleteConversation = () => {
    setDeleteModalVisible(false)
    setConversationToDelete(null)
  }

  // 会话菜单
  const getConversationMenu = (conversation) => {
    return {
      items: [
        {
          key: 'edit',
          label: '编辑会话',
          icon: <EditOutlined />,
          onClick: (e) => {
            e?.domEvent?.stopPropagation()
            handleEditConversation(conversation)
          }
        },
        {
          key: 'delete',
          label: '删除会话',
          icon: <DeleteOutlined />,
          danger: true,
          onClick: (e) => {
            e?.domEvent?.stopPropagation()
            handleDeleteConversation(conversation.id)
          }
        }
      ]
    }
  }

  // 渲染消息 - 使用新的MessageContent组件支持代码高亮
  const renderMessage = (msg) => (
    <div 
      key={msg.id} 
      style={{ 
        display: 'flex', 
        marginBottom: 16,
        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
      }}
    >
      {msg.role === 'assistant' && (
        <Avatar 
          icon={<RobotOutlined />} 
          style={{ 
            backgroundColor: '#1677ff',
            marginRight: 8,
            alignSelf: 'flex-start'
          }} 
        />
      )}
      
      <Card
        size="small"
        style={{
          maxWidth: '70%',
          backgroundColor: msg.role === 'user' ? '#1677ff' : '#f6f6f6',
          color: msg.role === 'user' ? 'white' : 'inherit'
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {/* 使用MessageContent组件渲染消息内容，支持markdown和代码高亮 */}
        <MessageContent content={msg.content} role={msg.role} />
        
        {msg.tokens > 0 && (
          <div style={{ 
            fontSize: 11, 
            marginTop: 8, 
            opacity: 0.7,
            textAlign: 'right'
          }}>
            {msg.tokens} tokens
          </div>
        )}
      </Card>
      
      {msg.role === 'user' && (
        <Avatar 
          icon={<UserOutlined />} 
          style={{ 
            backgroundColor: '#52c41a',
            marginLeft: 8,
            alignSelf: 'flex-start'
          }} 
        />
      )}
    </div>
  )

  // 检查是否可以发送消息
  const canSendMessage = () => {
    if (!currentConversation || !messageInput.trim() || typing) return false
    return checkCreditsForModel(currentConversation.model_name)
  }

  // 获取temperature标签颜色
  const getTemperatureTagColor = (temp) => {
    if (temp === 0) return 'purple'
    if (temp <= 0.3) return 'blue'
    if (temp <= 0.7) return 'cyan'
    return 'volcano'
  }

  // 获取temperature描述
  const getTemperatureDesc = (temp) => {
    if (temp === 0) return '严格模式'
    if (temp <= 0.3) return '精准模式'
    if (temp <= 0.7) return '平衡模式'
    return '创意模式'
  }

  return (
    <Layout className="chat-layout">
      {/* 侧边栏 - 会话列表 */}
      <Sider width={350} className="chat-sidebar">
        {/* 新建对话按钮 */}
        <div style={{ padding: '16px 16px 16px 16px' }}>
          <Button 
            type="primary" 
            block 
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingConversation(null)
              form.resetFields()
              setIsModalVisible(true)
            }}
          >
            新建对话
          </Button>
        </div>
        
        <div className="chat-conversations-container">
          <div className="chat-conversations-list">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Spin />
              </div>
            ) : conversations.length === 0 ? (
              <Empty 
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无对话"
                style={{ marginTop: '50px' }}
              />
            ) : (
              <List
                dataSource={conversations}
                renderItem={conv => {
                  // 🔥 移除temperature相关变量，不再在列表中显示
                  // const temperature = conv.ai_temperature !== undefined ? conv.ai_temperature : 0.0
                  return (
                    <List.Item
                      style={{ 
                        marginBottom: 8,
                        background: currentConversation?.id === conv.id ? '#f0f7ff' : 'transparent',
                        borderRadius: 6,
                        cursor: 'pointer',
                        padding: '8px',
                        border: currentConversation?.id === conv.id ? '1px solid #d9ecff' : '1px solid transparent'
                      }}
                      onClick={() => selectConversation(conv.id)}
                    >
                      <List.Item.Meta
                        avatar={
                          // 移除积分标签，只保留消息图标
                          <MessageOutlined style={{ color: '#1677ff', fontSize: 18 }} />
                        }
                        title={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 14, fontWeight: 500 }}>
                              {conv.title}
                            </span>
                            <Dropdown 
                              menu={getConversationMenu(conv)} 
                              trigger={['click']}
                              placement="bottomRight"
                            >
                              <Button 
                                type="text" 
                                size="small" 
                                icon={<MoreOutlined />}
                                onClick={e => e.stopPropagation()}
                              />
                            </Dropdown>
                          </div>
                        }
                        description={
                          <div>
                            <div style={{ fontSize: 12, color: '#999' }}>
                              {conv.model_name} • {conv.message_count} 条消息
                              {conv.context_length && (
                                <span> • 上下文{conv.context_length}条</span>
                              )}
                            </div>
                            {/* 🔥 移除Temperature标签显示 */}
                            {/* <div style={{ marginTop: 4 }}>
                              <Tag color={getTemperatureTagColor(temperature)} size="small" icon={<FireOutlined />}>
                                {getTemperatureDesc(temperature)} {temperature}
                              </Tag>
                            </div> */}
                            <div style={{ fontSize: 11, color: '#ccc' }}>
                              {new Date(conv.updated_at).toLocaleString()}
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  )
                }}
              />
            )}
          </div>
        </div>
      </Sider>

      {/* 聊天区域 - 新的固定布局结构 */}
      <Content className="chat-main">
        {currentConversation ? (
          <>
            {/* 会话头部 - 固定在顶部，简化显示 */}
            <div className="chat-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    {currentConversation.title}
                  </Title>
                  <Space>
                    <Text type="secondary">
                      {currentConversation.model_name} • {messages.length} 条消息
                    </Text>
                    <Tooltip title="当前对话携带的上下文数量，影响AI的记忆长度">
                      <Tag color="cyan" icon={<HistoryOutlined />}>
                        上下文 {currentConversation.context_length || 20} 条
                      </Tag>
                    </Tooltip>
                    {/* 🔥 移除Temperature标签显示 */}
                    {/* <Tooltip title="AI创造性参数：0=严格，0.3=精准，0.7=平衡，1.0=最创意">
                      <Tag 
                        color={getTemperatureTagColor(currentConversation.ai_temperature || 0.0)} 
                        icon={<FireOutlined />}
                      >
                        {getTemperatureDesc(currentConversation.ai_temperature || 0.0)} {currentConversation.ai_temperature || 0.0}
                      </Tag>
                    </Tooltip> */}
                  </Space>
                </div>
              </div>
            </div>

            {/* 消息列表 - 固定可滚动区域 */}
            <div className="chat-messages" ref={messagesContainerRef}>
              <div className="chat-messages-content">
                {messages.length === 0 ? (
                  <div className="chat-empty">
                    <Empty 
                      description="开始新的对话吧"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  </div>
                ) : (
                  <div className="chat-messages-list">
                    {messages.map(renderMessage)}
                    {typing && (
                      <div style={{ textAlign: 'left', marginTop: 16 }}>
                        <Spin size="small" />
                        <span style={{ marginLeft: 8, color: '#999' }}>AI 正在思考...</span>
                      </div>
                    )}
                    {/* 滚动锚点 */}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* 输入框 - 固定在底部 */}
            <div className="chat-input">
              {/* 积分不足警告 - 简化显示*/}
              {currentConversation && !checkCreditsForModel(currentConversation.model_name) && (
                <Alert
                  message="积分不足，无法发送消息"
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  action={
                    <Button size="small" type="primary" ghost>
                      联系管理员
                    </Button>
                  }
                />
              )}

              <div className="chat-input-container">
                <TextArea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="输入消息... (Enter发送，Shift+Enter换行)"
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  onKeyDown={handleKeyPress}
                  disabled={typing}
                  className="chat-input-textarea"
                />
                <Button 
                  type="primary" 
                  icon={<SendOutlined />}
                  loading={typing}
                  onClick={handleSendMessage}
                  disabled={!canSendMessage()}
                  className="chat-input-send-button"
                >
                  发送
                </Button>
              </div>
              
              {/* 输入提示 - 进一步简化 */}
              <div className="chat-input-tip">
                <span>Enter 发送 • Shift + Enter 换行 • 支持多行输入</span>
                {currentConversation && (
                  <span>
                    上下文: {currentConversation.context_length || 20} 条
                    {/* 🔥 移除Temperature显示 */}
                    {/* • {getTemperatureDesc(currentConversation.ai_temperature || 0.0)}: {currentConversation.ai_temperature || 0.0} */}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="chat-empty-state">
            <Empty 
              description="选择一个对话开始聊天"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              style={{ marginTop: 16 }}
              onClick={() => {
                setEditingConversation(null)
                form.resetFields()
                setIsModalVisible(true)
              }}
            >
              创建新对话
            </Button>
          </div>
        )}
      </Content>

      {/* 创建/编辑会话对话框 - 保留Temperature设置但不在列表显示 */}
      <Modal
        title={editingConversation ? '编辑会话' : '创建新会话'}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          setEditingConversation(null)
          form.resetFields()
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingConversation ? handleUpdateConversation : handleCreateConversation}
          initialValues={{
            context_length: 20,
            ai_temperature: 0.0
          }}
        >
          <Form.Item
            name="title"
            label="会话标题"
            rules={[{ required: true, message: '请输入会话标题' }]}
          >
            <Input placeholder="输入会话标题" />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="AI模型"
            rules={[{ required: true, message: '请选择AI模型' }]}
          >
            <Select placeholder="选择AI模型">
              {aiModels.map(model => (
                <Select.Option key={model.name} value={model.name}>
                  <span>{model.display_name}</span>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {/* 上下文数量设置 */}
          <Form.Item
            name="context_length"
            label={
              <Space>
                <span>上下文数量</span>
                <Tooltip title="设置AI对话时携带的历史消息数量。数量越多，AI记忆越长，但可能消耗更多Token。每轮对话（一问一答）算1条。">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[
              { required: true, message: '请设置上下文数量' },
              { type: 'number', min: 0, max: 1000, message: '上下文数量范围：0-1000' }
            ]}
            extra={
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                推荐设置：短对话 10-20 条，长对话 50-100 条，复杂任务 200-500 条。设置为 0 表示不携带历史消息。
              </div>
            }
          >
            <InputNumber
              min={0}
              max={1000}
              style={{ width: '100%' }}
              placeholder="设置携带的上下文消息数量"
              formatter={value => `${value} 条`}
              parser={value => value.replace(' 条', '')}
            />
          </Form.Item>

          {/* Temperature设置 - 保留在创建/编辑对话框中 */}
          <Form.Item
            name="ai_temperature"
            label={
              <Space>
                <FireOutlined style={{ color: '#ff7a00' }} />
                <span>AI创造性 (Temperature)</span>
                <Tooltip title="控制AI回复的创造性和随机性。0=最严格精准，0.3=保守准确，0.7=平衡，1.0=最有创意。推荐：翻译、代码0-0.3；问答0.3-0.7；创作0.7-1.0">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[
              { required: true, message: '请设置AI创造性参数' },
              { type: 'number', min: 0, max: 1, message: 'Temperature范围：0.0-1.0' }
            ]}
            extra={
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  <span><span style={{ color: '#722ed1' }}>●</span> 0.0 严格模式：翻译、代码生成</span>
                  <span><span style={{ color: '#1677ff' }}>●</span> 0.1-0.3 精准模式：技术问答</span>
                  <span><span style={{ color: '#13c2c2' }}>●</span> 0.4-0.7 平衡模式：日常对话</span>
                  <span><span style={{ color: '#fa541c' }}>●</span> 0.8-1.0 创意模式：创意写作</span>
                </div>
              </div>
            }
          >
            <InputNumber
              min={0}
              max={1}
              step={0.1}
              precision={1}
              placeholder="0.0"
              style={{ width: 200 }}
              addonAfter={
                <Tooltip title="常用值快速设置">
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button 
                      size="small" 
                      type="text" 
                      style={{ padding: '0 4px', fontSize: 11, color: '#722ed1' }}
                      onClick={() => form.setFieldValue('ai_temperature', 0.0)}
                    >
                      严格
                    </Button>
                    <Button 
                      size="small" 
                      type="text" 
                      style={{ padding: '0 4px', fontSize: 11, color: '#1677ff' }}
                      onClick={() => form.setFieldValue('ai_temperature', 0.3)}
                    >
                      精准
                    </Button>
                    <Button 
                      size="small" 
                      type="text" 
                      style={{ padding: '0 4px', fontSize: 11, color: '#13c2c2' }}
                      onClick={() => form.setFieldValue('ai_temperature', 0.7)}
                    >
                      平衡
                    </Button>
                    <Button 
                      size="small" 
                      type="text" 
                      style={{ padding: '0 4px', fontSize: 11, color: '#fa541c' }}
                      onClick={() => form.setFieldValue('ai_temperature', 1.0)}
                    >
                      创意
                    </Button>
                  </div>
                </Tooltip>
              }
            />
          </Form.Item>

          <Form.Item
            name="system_prompt"
            label="系统提示词"
          >
            <TextArea 
              placeholder="可选：设置AI的角色和行为方式"
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingConversation ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setIsModalVisible(false)
                setEditingConversation(null)
                form.resetFields()
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 删除确认对话框 - 移除Temperature显示 */}
      <Modal
        title="删除会话"
        open={deleteModalVisible}
        onOk={confirmDeleteConversation}
        onCancel={cancelDeleteConversation}
        okText="确认删除"
        cancelText="取消"
        okType="danger"
        confirmLoading={deleting}
        centered
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 22, marginRight: 8 }} />
          <span>确定要删除会话吗？</span>
        </div>
        {conversationToDelete && (
          <div>
            <p><strong>会话标题:</strong> {conversationToDelete.title}</p>
            <p><strong>消息数量:</strong> {conversationToDelete.message_count} 条</p>
            <p><strong>上下文设置:</strong> {conversationToDelete.context_length || 20} 条</p>
            {/* 🔥 移除Temperature显示 */}
            {/* <p><strong>创造性设置:</strong> {getTemperatureDesc(conversationToDelete.ai_temperature || 0.0)} ({conversationToDelete.ai_temperature || 0.0})</p> */}
            <p style={{ color: '#ff4d4f', marginTop: 16 }}>
              <strong>注意：此操作无法撤销，所有聊天记录将被永久删除！</strong>
            </p>
          </div>
        )}
      </Modal>
    </Layout>
  )
}

export default Chat
