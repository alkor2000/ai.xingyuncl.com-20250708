import React, { useEffect, useState } from 'react'
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
  UserOutlined
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

  // 组件加载时获取数据
  useEffect(() => {
    getConversations()
    getAIModels()
  }, [])

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
    if (!messageInput.trim()) return
    
    if (!currentConversation) {
      // 如果没有当前会话，先创建一个
      try {
        const newConversation = await createConversation({
          title: messageInput.substring(0, 30),
          model_name: 'gpt-3.5-turbo'
        })
        // 会话创建后再发送消息
        setTimeout(() => {
          handleSendMessage()
        }, 100)
        return
      } catch (error) {
        message.error('创建会话失败')
        return
      }
    }

    const content = messageInput
    setMessageInput('')

    try {
      await sendMessage(content)
    } catch (error) {
      message.error(error.response?.data?.message || '消息发送失败')
      setMessageInput(content) // 恢复消息内容
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

  // 删除会话
  const handleDeleteConversation = (conversationId) => {
    Modal.confirm({
      title: '删除会话',
      content: '确定要删除这个会话吗？此操作无法撤销。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConversation(conversationId)
          message.success('会话删除成功')
        } catch (error) {
          message.error('会话删除失败')
        }
      }
    })
  }

  // 会话菜单
  const getConversationMenu = (conversation) => ({
    items: [
      {
        key: 'edit',
        label: '编辑会话',
        icon: <EditOutlined />,
        onClick: () => handleEditConversation(conversation)
      },
      {
        key: 'delete',
        label: '删除会话',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDeleteConversation(conversation.id)
      }
    ]
  })

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
            flexShrink: 0
          }} 
        />
      )}
      
      <div style={{ maxWidth: '70%' }}>
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            backgroundColor: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
            color: msg.role === 'user' ? 'white' : 'inherit',
            wordBreak: 'break-word'
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {msg.content}
          </div>
        </div>
        <div 
          style={{ 
            fontSize: 12, 
            color: '#999', 
            marginTop: 4,
            textAlign: msg.role === 'user' ? 'right' : 'left'
          }}
        >
          {new Date(msg.created_at).toLocaleTimeString()}
        </div>
      </div>

      {msg.role === 'user' && (
        <Avatar 
          icon={<UserOutlined />} 
          style={{ 
            backgroundColor: '#52c41a',
            marginLeft: 8,
            flexShrink: 0
          }} 
        />
      )}
    </div>
  )

  return (
    <div className="page-container" style={{ padding: 0, height: 'calc(100vh - 64px)' }}>
      <Layout style={{ height: '100%' }}>
        {/* 会话列表侧栏 */}
        <Sider width={320} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
          <div style={{ padding: 16 }}>
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              block
              onClick={() => {
                setEditingConversation(null)
                form.resetFields()
                setIsModalVisible(true)
              }}
            >
              新建会话
            </Button>
          </div>

          <div style={{ height: 'calc(100% - 80px)', overflowY: 'auto' }}>
            {loading && conversations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <Spin />
              </div>
            ) : conversations.length === 0 ? (
              <Empty 
                description="暂无会话"
                style={{ marginTop: 32 }}
              />
            ) : (
              <List
                dataSource={conversations}
                renderItem={conv => (
                  <List.Item
                    style={{ 
                      padding: '12px 16px',
                      cursor: 'pointer',
                      backgroundColor: currentConversation?.id === conv.id ? '#f6ffed' : 'transparent',
                      borderLeft: currentConversation?.id === conv.id ? '3px solid #52c41a' : '3px solid transparent'
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
                          <Dropdown menu={getConversationMenu(conv)} trigger={['click']}>
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
        </Sider>

        {/* 聊天区域 */}
        <Content style={{ display: 'flex', flexDirection: 'column' }}>
          {currentConversation ? (
            <>
              {/* 会话头部 */}
              <div style={{ 
                padding: '16px 24px', 
                borderBottom: '1px solid #f0f0f0',
                backgroundColor: 'white'
              }}>
                <Title level={5} style={{ margin: 0 }}>
                  {currentConversation.title}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentConversation.model_name} • Token: {currentConversation.total_tokens}
                </Text>
              </div>

              {/* 消息列表 */}
              <div style={{ 
                flex: 1, 
                padding: '16px 24px', 
                overflowY: 'auto',
                backgroundColor: '#fafafa'
              }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', marginTop: 32 }}>
                    <RobotOutlined style={{ fontSize: 48, color: '#ccc', marginBottom: 16 }} />
                    <div style={{ color: '#999' }}>开始与AI对话吧！</div>
                  </div>
                ) : (
                  <div>
                    {messages.map(renderMessage)}
                    {typing && (
                      <div style={{ display: 'flex', marginBottom: 16 }}>
                        <Avatar 
                          icon={<RobotOutlined />} 
                          style={{ backgroundColor: '#1677ff', marginRight: 8 }} 
                        />
                        <div style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          backgroundColor: '#f5f5f5'
                        }}>
                          <div className="typing-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 输入区域 */}
              <div style={{ 
                padding: '16px 24px', 
                borderTop: '1px solid #f0f0f0',
                backgroundColor: 'white'
              }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <TextArea
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    placeholder="输入您的消息..."
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    onPressEnter={(e) => {
                      if (e.shiftKey) return
                      e.preventDefault()
                      handleSendMessage()
                    }}
                    disabled={typing}
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleSendMessage}
                    loading={typing}
                    disabled={!messageInput.trim() || typing}
                  >
                    发送
                  </Button>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                  按 Enter 发送，Shift + Enter 换行
                </div>
              </div>
            </>
          ) : (
            // 未选择会话时的欢迎页面
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'center', 
              alignItems: 'center',
              height: '100%',
              backgroundColor: '#fafafa'
            }}>
              <RobotOutlined style={{ fontSize: 80, color: '#1677ff', marginBottom: 24 }} />
              <Title level={3}>欢迎使用AI Platform</Title>
              <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 32 }}>
                选择一个会话开始对话，或创建新的会话与AI助手交流
              </Paragraph>
              <Button 
                type="primary" 
                size="large"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingConversation(null)
                  form.resetFields()
                  setIsModalVisible(true)
                }}
              >
                创建新会话
              </Button>
            </div>
          )}
        </Content>
      </Layout>

      {/* 创建/编辑会话弹窗 */}
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
            <Input placeholder="请输入会话标题" />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="AI模型"
            rules={[{ required: true, message: '请选择AI模型' }]}
            initialValue="gpt-3.5-turbo"
          >
            <Select placeholder="请选择AI模型">
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
              rows={4} 
              placeholder="可选：设置AI助手的角色和行为规则"
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

      <style jsx>{`
        .typing-dots {
          display: flex;
          gap: 4px;
        }
        .typing-dots span {
          width: 6px;
          height: 6px;
          background: #999;
          border-radius: 50%;
          animation: typing 1.4s infinite both;
        }
        .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
        .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes typing {
          0%, 80%, 100% {
            transform: scale(0);
            opacity: 0.3;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

export default Chat
