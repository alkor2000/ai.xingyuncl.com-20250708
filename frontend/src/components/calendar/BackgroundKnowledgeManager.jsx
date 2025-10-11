/**
 * 背景知识管理组件
 * 用于管理用户的个人背景信息，AI分析时会使用这些信息
 */

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  List, 
  Button, 
  Modal, 
  Form, 
  Input, 
  Switch, 
  Space, 
  Popconfirm, 
  Badge, 
  Tooltip,
  Empty,
  Spin,
  Typography
} from 'antd';
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  InfoCircleOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import useCalendarStore from '../../stores/calendarStore';

const { Text, Paragraph } = Typography;

const BackgroundKnowledgeManager = () => {
  // ========== 状态管理 ==========
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  
  // ========== Store数据 ==========
  const {
    backgroundKnowledge,
    backgroundKnowledgeLoading,
    fetchBackgroundKnowledge,
    createBackgroundKnowledge,
    updateBackgroundKnowledge,
    deleteBackgroundKnowledge
  } = useCalendarStore();
  
  // ========== 组件挂载时加载数据 ==========
  useEffect(() => {
    fetchBackgroundKnowledge();
  }, [fetchBackgroundKnowledge]);
  
  // ========== 打开创建/编辑模态框 ==========
  const handleOpenModal = (item = null) => {
    setEditingItem(item);
    if (item) {
      form.setFieldsValue({
        title: item.title,
        content: item.content,
        enabled: item.enabled
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        enabled: true,
        sort_order: backgroundKnowledge.length
      });
    }
    setIsModalVisible(true);
  };
  
  // ========== 关闭模态框 ==========
  const handleCloseModal = () => {
    setIsModalVisible(false);
    form.resetFields();
    setEditingItem(null);
  };
  
  // ========== 提交表单 ==========
  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const values = await form.validateFields();
      
      if (editingItem) {
        await updateBackgroundKnowledge(editingItem.id, values);
      } else {
        await createBackgroundKnowledge({
          ...values,
          sort_order: backgroundKnowledge.length
        });
      }
      
      handleCloseModal();
    } catch (error) {
      console.error('提交失败:', error);
    } finally {
      setSubmitting(false);
    }
  };
  
  // ========== 删除背景知识 ==========
  const handleDelete = async (id) => {
    await deleteBackgroundKnowledge(id);
  };
  
  // ========== 快速切换启用状态 ==========
  const handleToggleEnabled = async (item) => {
    await updateBackgroundKnowledge(item.id, {
      enabled: !item.enabled
    });
  };
  
  // ========== 统计信息 ==========
  const enabledCount = backgroundKnowledge.filter(k => k.enabled).length;
  const totalCount = backgroundKnowledge.length;
  
  return (
    <div className="background-knowledge-manager">
      <Card 
        title={
          <Space>
            <BookOutlined style={{ color: '#1890ff' }} />
            <span>背景知识</span>
            <Badge 
              count={enabledCount} 
              showZero
              style={{ backgroundColor: '#52c41a' }}
            />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              / {totalCount}
            </Text>
            <Tooltip title="AI分析时会参考已启用的背景知识，为您提供更个性化的时间管理建议">
              <InfoCircleOutlined style={{ color: '#1890ff', cursor: 'help' }} />
            </Tooltip>
          </Space>
        }
        extra={
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => handleOpenModal()}
            disabled={backgroundKnowledgeLoading}
          >
            添加背景知识
          </Button>
        }
        style={{ marginBottom: '16px' }}
      >
        {/* 提示信息 */}
        {totalCount === 0 && !backgroundKnowledgeLoading && (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center',
            background: '#f5f5f5',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" size={4}>
                  <Text>还没有添加背景知识</Text>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    添加您的职业背景、作息习惯等信息，让AI更了解您
                  </Text>
                </Space>
              }
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
                立即添加
              </Button>
            </Empty>
          </div>
        )}
        
        {/* 背景知识列表 */}
        <Spin spinning={backgroundKnowledgeLoading}>
          <List
            dataSource={backgroundKnowledge}
            locale={{ emptyText: '' }}
            renderItem={(item, index) => (
              <List.Item
                key={item.id}
                actions={[
                  <Tooltip title={item.enabled ? '点击禁用' : '点击启用'}>
                    <Button
                      type="text"
                      icon={item.enabled ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                      onClick={() => handleToggleEnabled(item)}
                      style={{ 
                        color: item.enabled ? '#52c41a' : '#d9d9d9'
                      }}
                    >
                      {item.enabled ? '已启用' : '已禁用'}
                    </Button>
                  </Tooltip>,
                  <Button 
                    type="link" 
                    icon={<EditOutlined />}
                    onClick={() => handleOpenModal(item)}
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    title="删除背景知识"
                    description="确定要删除这条背景知识吗？删除后无法恢复。"
                    onConfirm={() => handleDelete(item.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="link" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                ]}
                style={{
                  background: item.enabled ? '#fff' : '#fafafa',
                  padding: '16px',
                  marginBottom: '8px',
                  borderRadius: '8px',
                  border: '1px solid #f0f0f0'
                }}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: item.enabled ? '#e6f7ff' : '#f5f5f5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px'
                    }}>
                      {index + 1}
                    </div>
                  }
                  title={
                    <Space>
                      <Text strong style={{ fontSize: '15px' }}>
                        {item.title}
                      </Text>
                      {item.enabled && (
                        <Badge status="success" text="生效中" />
                      )}
                    </Space>
                  }
                  description={
                    <Paragraph
                      ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                      style={{ 
                        marginBottom: 0,
                        color: '#666',
                        fontSize: '13px'
                      }}
                    >
                      {item.content}
                    </Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        </Spin>
      </Card>
      
      {/* 创建/编辑模态框 */}
      <Modal
        title={
          <Space>
            <BookOutlined />
            {editingItem ? '编辑背景知识' : '添加背景知识'}
          </Space>
        }
        open={isModalVisible}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
        width={600}
        okText="确定"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ enabled: true }}
        >
          <Form.Item
            name="title"
            label={
              <Space>
                <span>标题</span>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  (最多100字符)
                </Text>
              </Space>
            }
            rules={[
              { required: true, message: '请输入标题' },
              { max: 100, message: '标题最多100字符' },
              { 
                validator: (_, value) => {
                  if (value && value.trim() === '') {
                    return Promise.reject(new Error('标题不能只包含空格'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input 
              placeholder="例如：我的职业背景、我的作息规律、我的工作习惯等" 
              maxLength={100}
              showCount
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="content"
            label={
              <Space>
                <span>内容</span>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  (最多2000字符)
                </Text>
              </Space>
            }
            rules={[
              { required: true, message: '请输入内容' },
              { max: 2000, message: '内容最多2000字符' },
              { 
                validator: (_, value) => {
                  if (value && value.trim() === '') {
                    return Promise.reject(new Error('内容不能只包含空格'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
            extra={
              <Text type="secondary" style={{ fontSize: '12px' }}>
                💡 提示：详细描述您的背景信息，AI会根据这些信息提供更精准的时间管理建议
              </Text>
            }
          >
            <Input.TextArea 
              placeholder="例如：&#10;我是一名全栈工程师，主要使用 React、Node.js、MySQL 技术栈，目前在开发企业级AI平台项目。工作时间通常是上午9点到晚上6点，习惯早上处理复杂任务，下午做代码审查和会议。周末喜欢学习新技术和阅读技术文章。"
              rows={10}
              maxLength={2000}
              showCount
            />
          </Form.Item>
          
          <Form.Item
            name="enabled"
            label="启用状态"
            valuePropName="checked"
            extra={
              <Text type="secondary" style={{ fontSize: '12px' }}>
                启用后，AI分析时会参考这条背景知识
              </Text>
            }
          >
            <Switch 
              checkedChildren="启用" 
              unCheckedChildren="禁用"
            />
          </Form.Item>
        </Form>
      </Modal>
      
      <style jsx>{`
        .background-knowledge-manager :global(.ant-list-item) {
          transition: all 0.3s ease;
        }
        
        .background-knowledge-manager :global(.ant-list-item:hover) {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
};

export default BackgroundKnowledgeManager;
