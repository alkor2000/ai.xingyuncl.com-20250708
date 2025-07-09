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
  Drawer,
  Row,
  Col
} from 'antd'
import { 
  UserAddOutlined, 
  EditOutlined, 
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  TeamOutlined,
  PlusOutlined
} from '@ant-design/icons'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'

const Users = () => {
  const { user: currentUser, hasPermission } = useAuthStore()
  const {
    users,
    userDetail,
    userGroups,
    loading,
    getUsers,
    getUserDetail,
    createUser,
    updateUser,
    deleteUser,
    getUserGroups,
    createUserGroup,
    updateUserGroup,
    deleteUserGroup
  } = useAdminStore()

  const [form] = Form.useForm()
  const [groupForm] = Form.useForm()
  const [searchForm] = Form.useForm()
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [isGroupModalVisible, setIsGroupModalVisible] = useState(false)
  const [isDetailVisible, setIsDetailVisible] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [activeTab, setActiveTab] = useState('users')
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })

  // 加载数据
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
      console.error('加载用户失败:', error)
    }
  }

  const loadUserGroups = async () => {
    try {
      await getUserGroups()
    } catch (error) {
      console.error('加载用户分组失败:', error)
    }
  }

  useEffect(() => {
    if (hasPermission('user.manage')) {
      loadUsers()
      loadUserGroups()
    }
  }, [pagination.current, pagination.pageSize, hasPermission])

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
      message.error('用户删除失败')
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
      group_id: user.group_id,
      status: user.status,
      token_quota: user.token_quota
    })
    setIsModalVisible(true)
  }

  // 创建分组
  const handleCreateGroup = async (values) => {
    try {
      await createUserGroup(values)
      setIsGroupModalVisible(false)
      groupForm.resetFields()
      message.success('用户分组创建成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '用户分组创建失败')
    }
  }

  // 更新分组
  const handleUpdateGroup = async (values) => {
    try {
      await updateUserGroup(editingGroup.id, values)
      setIsGroupModalVisible(false)
      setEditingGroup(null)
      groupForm.resetFields()
      message.success('用户分组更新成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '用户分组更新失败')
    }
  }

  // 删除分组
  const handleDeleteGroup = async (groupId) => {
    try {
      await deleteUserGroup(groupId)
      message.success('用户分组删除成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '删除失败')
    }
  }

  // 编辑分组
  const handleEditGroup = (group) => {
    setEditingGroup(group)
    groupForm.setFieldsValue({
      name: group.name,
      description: group.description,
      color: group.color,
      is_active: group.is_active,
      sort_order: group.sort_order
    })
    setIsGroupModalVisible(true)
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

  // 用户表格列
  const userColumns = [
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
      title: '用户分组',
      dataIndex: 'group_name',
      key: 'group_name',
      render: (groupName, record) => (
        groupName ? (
          <Tag color={record.group_color || '#1677ff'}>{groupName}</Tag>
        ) : (
          <span style={{ color: '#999' }}>未分组</span>
        )
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
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />} 
              onClick={() => handleViewDetail(record.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} 
              onClick={() => handleEditUser(record)} />
          </Tooltip>
          {record.id !== currentUser?.id && (
            <Tooltip title="删除">
              <Popconfirm
                title="确定删除这个用户吗？"
                onConfirm={() => handleDeleteUser(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Tooltip>
          )}
        </Space>
      )
    }
  ]

  // 分组表格列
  const groupColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: '分组名称',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space>
          <Tag color={record.color}>{name}</Tag>
        </Space>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '用户数量',
      dataIndex: 'user_count',
      key: 'user_count',
      render: (count) => (
        <Space>
          <TeamOutlined />
          <span>{count || 0}</span>
        </Space>
      )
    },
    {
      title: '平均Token使用',
      dataIndex: 'avg_tokens_used',
      key: 'avg_tokens_used',
      render: (avg) => Math.round(avg || 0).toLocaleString()
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
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order'
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} 
              onClick={() => handleEditGroup(record)} />
          </Tooltip>
          <Tooltip title="删除">
            <Popconfirm
              title="确定删除这个分组吗？"
              description="分组下的用户将变为未分组状态"
              onConfirm={() => handleDeleteGroup(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Tooltip>
        </Space>
      )
    }
  ]

  // 权限检查
  if (!hasPermission('user.manage')) {
    return (
      <div className="page-container">
        <Card>
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <p>您没有访问用户管理的权限</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* 标签切换 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Button 
            type={activeTab === 'users' ? 'primary' : 'default'}
            onClick={() => setActiveTab('users')}
          >
            用户管理
          </Button>
          <Button 
            type={activeTab === 'groups' ? 'primary' : 'default'}
            onClick={() => setActiveTab('groups')}
          >
            分组管理
          </Button>
        </Space>
      </Card>

      {activeTab === 'users' ? (
        <>
          {/* 用户搜索区域 */}
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
              <Form.Item name="group_id">
                <Select placeholder="用户分组" style={{ width: 150 }} allowClear>
                  {userGroups.map(group => (
                    <Select.Option key={group.id} value={group.id}>
                      <Tag color={group.color} style={{ margin: 0 }}>{group.name}</Tag>
                    </Select.Option>
                  ))}
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
            title="用户列表"
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
              columns={userColumns}
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
        </>
      ) : (
        <>
          {/* 分组列表 */}
          <Card 
            title="用户分组列表"
            extra={
              hasPermission('group.manage') && (
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingGroup(null)
                    groupForm.resetFields()
                    setIsGroupModalVisible(true)
                  }}
                >
                  添加分组
                </Button>
              )
            }
          >
            <Table
              columns={groupColumns}
              dataSource={userGroups}
              rowKey="id"
              loading={loading}
              pagination={false}
            />
          </Card>
        </>
      )}

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
            name="group_id"
            label="用户分组"
          >
            <Select placeholder="请选择用户分组" allowClear>
              {userGroups.filter(g => g.is_active).map(group => (
                <Select.Option key={group.id} value={group.id}>
                  <Tag color={group.color} style={{ margin: 0 }}>{group.name}</Tag>
                </Select.Option>
              ))}
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

      {/* 创建/编辑分组弹窗 */}
      <Modal
        title={editingGroup ? '编辑用户分组' : '创建用户分组'}
        open={isGroupModalVisible}
        onCancel={() => {
          setIsGroupModalVisible(false)
          setEditingGroup(null)
          groupForm.resetFields()
        }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={groupForm}
          layout="vertical"
          onFinish={editingGroup ? handleUpdateGroup : handleCreateGroup}
        >
          <Form.Item
            name="name"
            label="分组名称"
            rules={[{ required: true, message: '请输入分组名称' }]}
          >
            <Input placeholder="如：VIP客户、内部员工" />
          </Form.Item>

          <Form.Item
            name="description"
            label="分组描述"
          >
            <Input.TextArea rows={3} placeholder="描述这个分组的用途和特点" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="color"
                label="标识颜色"
                initialValue="#1677ff"
              >
                <Select>
                  <Select.Option value="#1677ff">
                    <Tag color="#1677ff">蓝色</Tag>
                  </Select.Option>
                  <Select.Option value="#52c41a">
                    <Tag color="#52c41a">绿色</Tag>
                  </Select.Option>
                  <Select.Option value="#fa8c16">
                    <Tag color="#fa8c16">橙色</Tag>
                  </Select.Option>
                  <Select.Option value="#ff4d4f">
                    <Tag color="#ff4d4f">红色</Tag>
                  </Select.Option>
                  <Select.Option value="#722ed1">
                    <Tag color="#722ed1">紫色</Tag>
                  </Select.Option>
                  <Select.Option value="#13c2c2">
                    <Tag color="#13c2c2">青色</Tag>
                  </Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="sort_order"
                label="排序"
                initialValue={0}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="is_active"
            label="状态"
            initialValue={true}
            valuePropName="checked"
          >
            <Select>
              <Select.Option value={true}>启用</Select.Option>
              <Select.Option value={false}>禁用</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingGroup ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setIsGroupModalVisible(false)
                setEditingGroup(null)
                groupForm.resetFields()
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
              <Row gutter={16}>
                <Col span={12}>
                  <div><strong>ID:</strong> {userDetail.user.id}</div>
                </Col>
                <Col span={12}>
                  <div><strong>用户名:</strong> {userDetail.user.username}</div>
                </Col>
                <Col span={12}>
                  <div><strong>邮箱:</strong> {userDetail.user.email}</div>
                </Col>
                <Col span={12}>
                  <div>
                    <strong>角色:</strong> 
                    <Tag color={roleColors[userDetail.user.role]} style={{ marginLeft: 8 }}>
                      {roleNames[userDetail.user.role]}
                    </Tag>
                  </div>
                </Col>
                <Col span={12}>
                  <div>
                    <strong>分组:</strong>
                    {userDetail.user.group_name ? (
                      <Tag color={userDetail.user.group_color} style={{ marginLeft: 8 }}>
                        {userDetail.user.group_name}
                      </Tag>
                    ) : (
                      <span style={{ marginLeft: 8, color: '#999' }}>未分组</span>
                    )}
                  </div>
                </Col>
                <Col span={12}>
                  <div>
                    <strong>状态:</strong>
                    <Tag color={statusColors[userDetail.user.status]} style={{ marginLeft: 8 }}>
                      {userDetail.user.status === 'active' ? '正常' : '禁用'}
                    </Tag>
                  </div>
                </Col>
                <Col span={24}>
                  <div style={{ marginTop: 8 }}>
                    <strong>创建时间:</strong> {new Date(userDetail.user.created_at).toLocaleString()}
                  </div>
                </Col>
                <Col span={24}>
                  <div style={{ marginTop: 4 }}>
                    <strong>最后登录:</strong> {
                      userDetail.user.last_login_at 
                        ? new Date(userDetail.user.last_login_at).toLocaleString() 
                        : '从未登录'
                    }
                  </div>
                </Col>
              </Row>
            </Card>

            <Card title="Token使用情况" size="small" style={{ marginBottom: 16 }}>
              <Row gutter={16} style={{ textAlign: 'center' }}>
                <Col span={8}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1677ff' }}>
                    {userDetail.user.token_quota?.toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>Token配额</div>
                </Col>
                <Col span={8}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>
                    {userDetail.user.used_tokens?.toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>已使用</div>
                </Col>
                <Col span={8}>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
                    {((userDetail.user.token_quota || 0) - (userDetail.user.used_tokens || 0)).toLocaleString()}
                  </div>
                  <div style={{ color: '#666', fontSize: 12 }}>剩余</div>
                </Col>
              </Row>
            </Card>

            <Card title="权限信息" size="small">
              <div>
                {userDetail.permissions?.map(permission => (
                  <Tag key={permission} style={{ marginBottom: 4 }}>
                    {permission}
                  </Tag>
                ))}
              </div>
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default Users
