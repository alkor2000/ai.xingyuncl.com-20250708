/**
 * 用户标签管理组件 - 管理组内标签
 */

import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Table, 
  Button, 
  Tag, 
  Space, 
  Modal, 
  Form, 
  Input, 
  ColorPicker, 
  InputNumber,
  Select,
  message,
  Popconfirm,
  Tooltip,
  Empty,
  Spin
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TagsOutlined,
  TeamOutlined,
  BgColorsOutlined
} from '@ant-design/icons'
import apiClient from '../../../utils/api'

const { TextArea } = Input

const UserTagManager = ({ groupId, currentUser }) => {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTag, setEditingTag] = useState(null)
  const [form] = Form.useForm()

  // 判断权限
  const isGroupAdmin = currentUser?.role === 'admin'
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const canManage = isSuperAdmin || (isGroupAdmin && currentUser.group_id === parseInt(groupId))

  // 加载标签列表
  const loadTags = async () => {
    if (!groupId) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/user-tags/group/${groupId}`)
      setTags(response.data.data || [])
    } catch (error) {
      message.error('加载标签失败')
      console.error('加载标签失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTags()
  }, [groupId])

  // 创建或更新标签
  const handleSubmit = async (values) => {
    try {
      const tagData = {
        ...values,
        group_id: parseInt(groupId),
        color: typeof values.color === 'string' ? values.color : values.color?.toHexString()
      }

      if (editingTag) {
        await apiClient.put(`/admin/user-tags/${editingTag.id}`, tagData)
        message.success('标签更新成功')
      } else {
        await apiClient.post('/admin/user-tags', tagData)
        message.success('标签创建成功')
      }

      setModalVisible(false)
      form.resetFields()
      setEditingTag(null)
      loadTags()
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  // 删除标签
  const handleDelete = async (tagId) => {
    try {
      await apiClient.delete(`/admin/user-tags/${tagId}`)
      message.success('标签删除成功')
      loadTags()
    } catch (error) {
      message.error('删除标签失败')
    }
  }

  // 编辑标签
  const handleEdit = (tag) => {
    setEditingTag(tag)
    form.setFieldsValue({
      name: tag.name,
      color: tag.color,
      description: tag.description,
      icon: tag.icon,
      sort_order: tag.sort_order || 0
    })
    setModalVisible(true)
  }

  // 表格列定义
  const columns = [
    {
      title: '标签名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Tag 
          color={record.color}
          icon={record.icon === 'StarOutlined' ? <StarOutlined /> : <TagsOutlined />}
        >
          {text}
        </Tag>
      )
    },
    {
      title: '颜色',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div 
            style={{ 
              width: 24, 
              height: 24, 
              backgroundColor: color,
              borderRadius: 4,
              border: '1px solid #d9d9d9'
            }} 
          />
          <span style={{ fontSize: 12, color: '#666' }}>{color}</span>
        </div>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '使用人数',
      dataIndex: 'user_count',
      key: 'user_count',
      width: 100,
      render: (count) => (
        <Space>
          <TeamOutlined />
          <span>{count || 0}</span>
        </Space>
      )
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80
    },
    {
      title: '创建者',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 120
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => {
        if (!canManage) return null
        
        return (
          <Space>
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              />
            </Tooltip>
            <Popconfirm
              title="确定删除该标签吗？"
              description={`删除后，${record.user_count || 0}个用户将失去此标签`}
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Tooltip title="删除">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      }
    }
  ]

  return (
    <Card 
      title={
        <Space>
          <TagsOutlined />
          <span>标签管理</span>
        </Space>
      }
      extra={
        canManage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingTag(null)
              form.resetFields()
              setModalVisible(true)
            }}
          >
            新建标签
          </Button>
        )
      }
    >
      <Spin spinning={loading}>
        {tags.length > 0 ? (
          <Table
            dataSource={tags}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        ) : (
          <Empty 
            description="暂无标签"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Spin>

      {/* 标签表单弹窗 */}
      <Modal
        title={editingTag ? '编辑标签' : '新建标签'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setEditingTag(null)
        }}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="name"
            label="标签名称"
            rules={[
              { required: true, message: '请输入标签名称' },
              { max: 20, message: '标签名称最多20个字符' }
            ]}
          >
            <Input placeholder="如：核心成员、技术部门等" />
          </Form.Item>

          <Form.Item
            name="color"
            label="标签颜色"
            initialValue="#1677ff"
          >
            <ColorPicker showText />
          </Form.Item>

          <Form.Item
            name="description"
            label="标签描述"
          >
            <TextArea 
              rows={3} 
              placeholder="标签的说明信息"
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="icon"
            label="图标"
            initialValue="TagsOutlined"
          >
            <Select>
              <Select.Option value="TagsOutlined">
                <Space>
                  <TagsOutlined />
                  <span>标签</span>
                </Space>
              </Select.Option>
              <Select.Option value="StarOutlined">
                <Space>
                  <StarOutlined />
                  <span>星标</span>
                </Space>
              </Select.Option>
              <Select.Option value="TeamOutlined">
                <Space>
                  <TeamOutlined />
                  <span>团队</span>
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="sort_order"
            label="排序"
            initialValue={0}
          >
            <InputNumber 
              min={0} 
              max={999}
              style={{ width: '100%' }}
              placeholder="数值越小越靠前"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

// 导入需要的图标
const StarOutlined = () => <span>⭐</span>

export default UserTagManager
