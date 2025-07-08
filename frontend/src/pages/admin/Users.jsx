import React, { useEffect, useState } from 'react'
import { 
  Card, 
  Table, 
  Button, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Select, 
  InputNumber,
  message,
  Tooltip,
  Popconfirm,
  Drawer
} from 'antd'
import { 
  UserAddOutlined, 
  EditOutlined, 
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'

const Users = () => {
  const { user: currentUser, hasPermission } = useAuthStore()
  const {
    users,
    userDetail,
    loading,
    getUsers,
    getUserDetail,
    createUser,
    updateUser,
    deleteUser
  } = useAdminStore()

  const [form] = Form.useForm()
  const [searchForm] = Form.useForm()
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [isDetailVisible, setIsDetailVisible] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })

  // 加载用户列表
  const loadUsers = async (params = {}) => {
    try {
      const result = await getUsers({
        page: pagination.current,
        limit: pagination.pageSize,
        ...params
      })
      setPagination(prev => ({
        ...prev,
        total: result.pagination.total
      }))
    } catch (error) {
      message.error('获取用户列表失败')
    }
  }

  // 组件加载时获取数据
  useEffect(() => {
    if (hasPermission('user.manage')) {
      loadUsers()
    }
  }, [pagination.current, pagination.pageSize])

  // 搜索用户
  const handleSearch = (values) => {
    setPagination(prev => ({ ...prev, current: 1 }))
    loadUsers(values)
  }

  // 创建用户
  const handleCreateUser = async (values) => {
    try {
      await createUser(values)
      setIsModalVisible(false)
      form.resetFields()
      message.success('用户创建成功')
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '用户创建失败')
    }
  }

  // 更新用户
  const handleUpdateUser = async (values) => {
    try {
      await updateUser(editingUser.id, values)
      setIsModalVisible(false)
      setEditingUser(null)
      form.resetFields()
      message.success('用户更新成功')
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '用户更新失败')
    }
  }

  // 删除用户
  const handleDeleteUser = async (userId) => {
    try {
      await deleteUser(userId)
      message.success('用户删除成功')
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '用户删除失败')
    }
  }

  // 查看用户详情
  const handleViewDetail = async (userId) => {
    try {
      await getUserDetail(userId)
      setIsDetailVisible(true)
    } catch (error) {
      message.error('获取用户详情失败')
    }
  }

  // 编辑用户
  const handleEditUser = (user) => {
    setEditingUser(user)
    form.setFieldsValue({
      username: user.username,
      role: user.role,
      status: user.status,
      token_quota: user.token_quota
    })
    setIsModalVisible(true)
  }

  // 角色和状态映射
  const roleNames = {
    super_admin: '超级管理员',
    admin: '管理员', 
    user: '普通用户'
  }

  const roleColors = {
    super_admin: 'red',
    admin: 'blue',
    user: 'green'
  }

  const statusColors = {
    active: 'green',
    inactive: 'red'
  }

  // 表格列定义
  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username'
    },
    {
      title: '邮箱',
      dataIndex: 'email', 
      key: 'email'
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <Tag color={roleColors[role]}>{roleNames[role]}</Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={statusColors[status]}>
          {status === 'active' ? '正常' : '禁用'}
        </Tag>
      )
    },
    {
      title: 'Token配额',
      dataIndex: 'token_quota',
      key: 'token_quota',
      render: (quota) => quota?.toLocaleString()
    },
    {
      title: '已使用',
      dataIndex: 'used_tokens',
      key: 'used_tokens',
      render: (used) => used?.toLocaleString()
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time) => new Date(time).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space>
          <Tooltip title="查看详情">
            <Button 
              size="small" 
              icon={<EyeOutlined />}
              onClick={() => handleViewDetail(record.id)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button 
              size="small" 
              icon={<EditOutlined />}
              onClick={() => handleEditUser(record)}
            />
          </Tooltip>
          {record.id !== currentUser?.id && (
            <Popconfirm
              title="确定要删除这个用户吗？"
              onConfirm={() => handleDeleteUser(record.id)}
              okText="删除"
              cancelText="取消"
            >
              <Tooltip title="删除">
                <Button 
                  size="small" 
                  danger 
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ]

  if (!hasPermission('user.manage')) {
    return (
      <div className="page-container">
        <Card>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3>权限不足</h3>
            <p>您没有访问用户管理的权限</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* 搜索区域 */}
      <Card style={{ marginBottom: 16 }}>
        <Form
          form={searchForm}
          layout="inline"
          onFinish={handleSearch}
        >
          <Form.Item name="search">
            <Input placeholder="搜索用户名或邮箱" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="role">
            <Select placeholder="角色" style={{ width: 120 }} allowClear>
              <Select.Option value="super_admin">超级管理员</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
              <Select.Option value="user">普通用户</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" style={{ width: 100 }} allowClear>
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="inactive">禁用</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                搜索
              </Button>
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => {
                  searchForm.resetFields()
                  loadUsers()
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 用户列表 */}
      <Card 
        title="用户管理"
        extra={
          <Button 
            type="primary" 
            icon={<UserAddOutlined />}
            onClick={() => {
              setEditingUser(null)
              form.resetFields()
              setIsModalVisible(true)
            }}
          >
            添加用户
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
            onChange: (page, pageSize) => {
              setPagination(prev => ({ ...prev, current: page, pageSize }))
            }
          }}
        />
      </Card>

      {/* 创建/编辑用户弹窗 */}
      <Modal
        title={editingUser ? '编辑用户' : '创建用户'}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          setEditingUser(null)
          form.resetFields()
        }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingUser ? handleUpdateUser : handleCreateUser}
        >
          {!editingUser && (
            <>
              <Form.Item
                name="email"
                label="邮箱地址"
                rules={[
                  { required: true, message: '请输入邮箱地址' },
                  { type: 'email', message: '请输入有效的邮箱地址' }
                ]}
              >
                <Input placeholder="请输入邮箱地址" />
              </Form.Item>

              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 6, message: '密码至少6位' }
                ]}
              >
                <Input.Password placeholder="请输入密码" />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            initialValue="user"
          >
            <Select placeholder="请选择角色">
              <Select.Option value="user">普通用户</Select.Option>
              {currentUser?.role === 'super_admin' && (
                <>
                  <Select.Option value="admin">管理员</Select.Option>
                  <Select.Option value="super_admin">超级管理员</Select.Option>
                </>
              )}
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            initialValue="active"
          >
            <Select>
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="inactive">禁用</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="token_quota"
            label="Token配额"
            rules={[{ required: true, message: '请设置Token配额' }]}
            initialValue={10000}
          >
            <InputNumber 
              placeholder="Token配额"
              min={0}
              style={{ width: '100%' }}
              formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={value => value.replace(/\$\s?|(,*)/g, '')}
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingUser ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setIsModalVisible(false)
                setEditingUser(null)
                form.resetFields()
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 用户详情抽屉 */}
      <Drawer
        title="用户详情"
        width={600}
        open={isDetailVisible}
        onClose={() => setIsDetailVisible(false)}
      >
        {userDetail && (
          <div>
            <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <strong>ID:</strong> {userDetail.user.id}
                </div>
                <div>
                  <strong>用户名:</strong> {userDetail.user.username}
                </div>
                <div>
                  <strong>邮箱:</strong> {userDetail.user.email}
                </div>
                <div>
                  <strong>角色:</strong> 
                  <Tag color={roleColors[userDetail.user.role]} style={{ marginLeft: 8 }}>
                    {roleNames[userDetail.user.role]}
                  </Tag>
                </div>
                <div>
                  <strong>状态:</strong>
                  <Tag color={statusColors[userDetail.user.status]} style={{ marginLeft: 8 }}>
                    {userDetail.user.status === 'active' ? '正常' : '禁用'}
                  </Tag>
                </div>
                <div>
                  <strong>创建时间:</strong> {new Date(userDetail.user.created_at).toLocaleString()}
                </div>
              </div>
            </Card>

            <Card title="Token使用情况" size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1677ff' }}>
                    {userDetail.user.token_quota?.toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>Token配额</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>
                    {userDetail.user.used_tokens?.toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>已使用</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
                    {(userDetail.user.token_quota - userDetail.user.used_tokens)?.toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>剩余Token</div>
                </div>
              </div>
            </Card>

            <Card title="对话统计" size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <strong>总对话数:</strong> {userDetail.stats?.total_conversations || 0}
                </div>
                <div>
                  <strong>总消息数:</strong> {userDetail.stats?.total_messages || 0}
                </div>
                <div>
                  <strong>总Token消耗:</strong> {userDetail.stats?.total_tokens?.toLocaleString() || 0}
                </div>
                <div>
                  <strong>最后对话:</strong> 
                  {userDetail.stats?.last_conversation_at ? 
                    new Date(userDetail.stats.last_conversation_at).toLocaleString() : 
                    '无'
                  }
                </div>
              </div>
            </Card>

            <Card title="权限列表" size="small">
              <div>
                {userDetail.permissions?.map(permission => (
                  <Tag key={permission} style={{ marginBottom: 4 }}>
                    {permission}
                  </Tag>
                )) || '无特殊权限'}
              </div>
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default Users
