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
  Empty
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
  ExclamationCircleOutlined
} from '@ant-design/icons'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'

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
    loading,
    typing,
    getConversations,
    createConversation,
    selectConversation,
    sendMessage,
    updateConversation,
    deleteConversation,
    getAIModels
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

  // 组件加载时获取数据
  useEffect(() => {
    getConversations()
    getAIModels()
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

  // 创建新会话
  const handleCreateConversation = async (values) => {
    try {
      await createConversation({
        title: values.title || 'New Chat',
        model_name: values.model_name || 'gpt-3.5-turbo',
        system_prompt: values.system_prompt
      })
      setIsModalVisible(false)
      form.resetFields()
      message.success('会话创建成功')
    } catch (error) {
      message.error('会话创建失败')
    }
  }

  // 发送消息
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !currentConversation) {
      return
    }

    try {
      await sendMessage(messageInput.trim())
      setMessageInput('')
      // 发送后立即滚动到底部
      setTimeout(scrollToBottom, 100)
    } catch (error) {
      message.error('消息发送失败')
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
      system_prompt: conversation.system_prompt
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
    console.log('🗑️ 删除会话被调用:', conversationId)
    console.log('🔧 deleteConversation 方法:', typeof deleteConversation)
    
    const targetConversation = conversations.find(c => c.id === conversationId)
    console.log('📦 目标会话:', targetConversation)
    
    setConversationToDelete(targetConversation)
    setDeleteModalVisible(true)
    console.log('✅ 删除确认对话框应该显示了')
  }

  // 确认删除会话
  const confirmDeleteConversation = async () => {
    if (!conversationToDelete) return
    
    try {
      console.log('🚀 开始执行删除操作:', conversationToDelete.id)
      setDeleting(true)
      
      await deleteConversation(conversationToDelete.id)
      
      console.log('✅ 删除操作成功')
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
    console.log('❌ 用户取消删除操作')
    setDeleteModalVisible(false)
    setConversationToDelete(null)
  }

  // 会话菜单
  const getConversationMenu = (conversation) => {
    console.log('🎯 生成会话菜单:', conversation.id)
    return {
      items: [
        {
          key: 'edit',
          label: '编辑会话',
          icon: <EditOutlined />,
          onClick: (e) => {
            console.log('✏️ 编辑会话被点击:', conversation.id)
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
            console.log('🗑️ 删除菜单项被点击:', conversation.id)
            e?.domEvent?.stopPropagation()
            handleDeleteConversation(conversation.id)
          }
        }
      ]
    }
  }

  // 渲染消息
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
        bodyStyle={{ padding: '8px 12px' }}
      >
        <div style={{ fontSize: 13, lineHeight: '1.5' }}>
          {msg.content}
        </div>
        {msg.tokens > 0 && (
          <div style={{ 
            fontSize: 11, 
            marginTop: 4, 
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

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 侧边栏 - 会话列表 */}
      <Sider width={350} style={{ backgroundColor: 'white', borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px' }}>
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
        
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ height: '100%', overflowY: 'auto', padding: '0 8px' }}>
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
                renderItem={conv => (
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
                      avatar={<MessageOutlined style={{ color: '#1677ff' }} />}
                      title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>
                            {conv.title}
                          </span>
                          <Dropdown 
                            menu={getConversationMenu(conv)} 
                            trigger={['click']}
                            placement="bottomRight"
                            onOpenChange={(open) => console.log('📖 Dropdown 状态:', open, conv.id)}
                          >
                            <Button 
                              type="text" 
                              size="small" 
                              icon={<MoreOutlined />}
                              onClick={e => {
                                e.stopPropagation()
                                console.log('🔘 更多按钮被点击:', conv.id)
                              }}
                            />
                          </Dropdown>
                        </div>
                      }
                      description={
                        <div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            {conv.model_name} • {conv.message_count} 条消息
                          </div>
                          <div style={{ fontSize: 11, color: '#ccc' }}>
                            {new Date(conv.updated_at).toLocaleString()}
                          </div>
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      </Sider>

      {/* 聊天区域 - 优化布局结构 */}
      <Content style={{ 
        display: 'flex', 
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden'
      }}>
        {currentConversation ? (
          <>
            {/* 会话头部 - 固定高度 */}
            <div style={{ 
              padding: '16px 24px', 
              borderBottom: '1px solid #f0f0f0',
              backgroundColor: 'white',
              flexShrink: 0  // 防止被压缩
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    {currentConversation.title}
                  </Title>
                  <Text type="secondary">
                    {currentConversation.model_name} • {messages.length} 条消息
                  </Text>
                </div>
              </div>
            </div>

            {/* 消息列表 - 可滚动区域 */}
            <div 
              ref={messagesContainerRef}
              style={{ 
                flex: 1, 
                padding: '16px 24px', 
                overflowY: 'auto',
                backgroundColor: '#fafafa',
                position: 'relative'
              }}
            >
              {messages.length === 0 ? (
                <Empty 
                  description="开始新的对话吧"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              ) : (
                <div>
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

            {/* 输入框 - 固定底部，增加高度 */}
            <div style={{ 
              padding: '16px 24px', 
              borderTop: '1px solid #f0f0f0',
              backgroundColor: 'white',
              flexShrink: 0  // 防止被压缩
            }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <TextArea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="输入消息... (Enter发送，Shift+Enter换行)"
                  autoSize={{ minRows: 3, maxRows: 8 }}  // 增加最小高度到3行
                  onKeyDown={handleKeyPress}
                  disabled={typing}
                  style={{ 
                    flex: 1,
                    resize: 'none',
                    fontSize: '14px',
                    lineHeight: '1.5'
                  }}
                />
                <Button 
                  type="primary" 
                  icon={<SendOutlined />}
                  loading={typing}
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim() || typing}
                  style={{
                    height: 'auto',
                    minHeight: '40px',
                    padding: '8px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  发送
                </Button>
              </div>
              {/* 输入提示 */}
              <div style={{ 
                marginTop: '8px', 
                fontSize: '12px', 
                color: '#999',
                textAlign: 'center'
              }}>
                Enter 发送 • Shift + Enter 换行 • 支持多行输入
              </div>
            </div>
          </>
        ) : (
          /* 无会话选择时的空状态 */
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            flexDirection: 'column'
          }}>
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

      {/* 创建/编辑会话对话框 */}
      <Modal
        title={editingConversation ? '编辑会话' : '创建新会话'}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          setEditingConversation(null)
          form.resetFields()
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingConversation ? handleUpdateConversation : handleCreateConversation}
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
                  {model.display_name}
                </Select.Option>
              ))}
            </Select>
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

      {/* 删除确认对话框 */}
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
