/**
 * 用户管理主页面 - 重构版（修复版）
 * 将原来4000+行的代码拆分成多个子组件
 */

import React, { useEffect, useState } from 'react'
import { Card, Button, Space, Alert, Form, message } from 'antd'
import { 
  UserAddOutlined, 
  PlusOutlined,
  LockOutlined 
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import moment from 'moment'

// 导入子组件
import {
  UserSearchForm,
  UserTable,
  UserFormModal,
  UserDetailDrawer,
  UserGroupTable,
  UserGroupFormModal
} from '../../components/admin/users'

const Users = () => {
  const { t } = useTranslation()
  const { user: currentUser, hasPermission } = useAuthStore()
  const {
    users,
    userDetail,
    userGroups,
    loading,
    userCredits,
    creditsHistory,
    getUsers,
    getUserDetail,
    createUser,
    updateUser,
    deleteUser,
    getUserGroups,
    createUserGroup,
    updateUserGroup,
    deleteUserGroup,
    getUserCredits,
    setUserCreditsQuota,
    addUserCredits,
    deductUserCredits,
    getUserCreditsHistory,
    setUserCreditsExpire,
    resetUserPassword
  } = useAdminStore()

  // 表单实例
  const [userForm] = Form.useForm()
  const [groupForm] = Form.useForm()
  
  // 状态管理
  const [isUserModalVisible, setIsUserModalVisible] = useState(false)
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
  const [creditHistoryData, setCreditHistoryData] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // 用户角色判断
  const isGroupAdmin = currentUser?.role === 'admin'
  const isSuperAdmin = currentUser?.role === 'super_admin'

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
      console.error('加载用户失败:', error)
    }
  }

  // 加载用户分组
  const loadUserGroups = async () => {
    try {
      await getUserGroups()
    } catch (error) {
      console.error('加载用户分组失败:', error)
    }
  }

  // 加载积分历史
  const loadCreditHistory = async (userId) => {
    setHistoryLoading(true)
    try {
      const result = await getUserCreditsHistory(userId, { page: 1, limit: 10 })
      setCreditHistoryData(result || [])
    } catch (error) {
      console.error('加载积分历史失败:', error)
      setCreditHistoryData([])
    } finally {
      setHistoryLoading(false)
    }
  }

  // 初始化加载
  useEffect(() => {
    if (hasPermission('user.manage') || hasPermission('user.manage.group')) {
      loadUsers()
      loadUserGroups()
    }
  }, [pagination.current, pagination.pageSize, hasPermission])

  // 用户搜索
  const handleSearch = (values) => {
    setPagination(prev => ({ ...prev, current: 1 }))
    loadUsers(values)
  }

  // 创建用户
  const handleCreateUser = async (values) => {
    try {
      let credits_expire_days = 365
      if (values.credits_expire_at) {
        const days = values.credits_expire_at.diff(moment(), 'days')
        credits_expire_days = Math.max(1, days)
      }
      
      await createUser({
        ...values,
        credits_expire_days
      })
      
      setIsUserModalVisible(false)
      userForm.resetFields()
      message.success(t('admin.users.create.success'))
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.users.create.failed'))
    }
  }

  // 更新用户
  const handleUpdateUser = async (values) => {
    try {
      const { 
        creditsOperation, 
        creditsAmount, 
        creditsReason, 
        newPassword, 
        confirmPassword,
        credits_expire_at,
        extend_days,
        ...updateData 
      } = values
      
      // 基础信息更新
      if (isGroupAdmin) {
        delete updateData.role
        delete updateData.group_id
        delete updateData.credits_quota
        delete updateData.token_quota
      }
      
      await updateUser(editingUser.id, updateData)
      
      // 密码重置
      if (newPassword) {
        await resetUserPassword(editingUser.id, newPassword)
      }
      
      // 积分操作（仅超级管理员）
      if (isSuperAdmin && creditsOperation && creditsAmount && creditsReason) {
        switch (creditsOperation) {
          case 'add':
            await addUserCredits(editingUser.id, creditsAmount, creditsReason, extend_days)
            break
          case 'deduct':
            await deductUserCredits(editingUser.id, creditsAmount, creditsReason)
            break
          case 'set':
            await setUserCreditsQuota(editingUser.id, creditsAmount, creditsReason)
            break
        }
      }
      
      // 积分有效期设置
      if (isSuperAdmin) {
        if (credits_expire_at) {
          await setUserCreditsExpire(editingUser.id, {
            expire_date: credits_expire_at.format('YYYY-MM-DD HH:mm:ss'),
            reason: creditsReason || '管理员设置积分有效期'
          })
        } else if (extend_days && !creditsOperation) {
          await setUserCreditsExpire(editingUser.id, {
            extend_days: extend_days,
            reason: creditsReason || '管理员延长积分有效期'
          })
        }
      }
      
      setIsUserModalVisible(false)
      setEditingUser(null)
      userForm.resetFields()
      message.success(t('admin.users.update.success'))
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.users.update.failed'))
    }
  }

  // 切换用户状态
  const handleToggleUserStatus = async (userId, currentStatus) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
      await updateUser(userId, { status: newStatus })
      message.success(
        newStatus === 'active' 
          ? t('admin.users.enable.success') 
          : t('admin.users.disable.success')
      )
      loadUsers()
    } catch (error) {
      message.error(
        error.response?.data?.message || 
        (currentStatus === 'active' 
          ? t('admin.users.disable.failed') 
          : t('admin.users.enable.failed'))
      )
    }
  }

  // 查看用户详情
  const handleViewDetail = async (userId) => {
    try {
      await getUserDetail(userId)
      await getUserCredits(userId)
      setIsDetailVisible(true)
    } catch (error) {
      message.error('获取用户详情失败')
    }
  }

  // 编辑用户
  const handleEditUser = async (user) => {
    setEditingUser(user)
    userForm.setFieldsValue({
      username: user.username,
      role: user.role,
      group_id: user.group_id,
      status: user.status,
      token_quota: user.token_quota,
      credits_quota: user.credits_quota,
      credits_expire_at: user.credits_expire_at ? moment(user.credits_expire_at) : null,
      remark: user.remark
    })
    
    if (isSuperAdmin) {
      await getUserCredits(user.id)
      await loadCreditHistory(user.id)
    }
    
    setIsUserModalVisible(true)
  }

  // 删除用户
  const handleDeleteUser = async (userId) => {
    try {
      await deleteUser(userId)
      message.success(t('admin.users.delete.success'))
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.users.delete.failed'))
    }
  }

  // 分组管理方法
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

  const handleDeleteGroup = async (groupId) => {
    try {
      await deleteUserGroup(groupId)
      message.success('用户分组删除成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '删除失败')
    }
  }

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

  // 权限检查
  if (!hasPermission('user.manage') && !hasPermission('user.manage.group')) {
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

  return (
    <div className="page-container">
      {/* 权限提示 */}
      {isGroupAdmin && (
        <Alert
          message="权限说明"
          description="作为组管理员，您可以查看和管理本组用户，可以重置密码、禁用/启用账户、修改用户备注，但不能修改积分相关设置。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          icon={<LockOutlined />}
        />
      )}

      {/* 标签切换 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Button 
            type={activeTab === 'users' ? 'primary' : 'default'}
            onClick={() => setActiveTab('users')}
          >
            {t('admin.users.title')}
          </Button>
          <Button 
            type={activeTab === 'groups' ? 'primary' : 'default'}
            onClick={() => setActiveTab('groups')}
          >
            {t('admin.groups.title')}
          </Button>
        </Space>
      </Card>

      {activeTab === 'users' ? (
        <>
          {/* 用户搜索 */}
          <Card style={{ marginBottom: 16 }}>
            <UserSearchForm
              onSearch={handleSearch}
              onReset={() => loadUsers()}
              userGroups={userGroups}
              isGroupAdmin={isGroupAdmin}
              isSuperAdmin={isSuperAdmin}
            />
          </Card>

          {/* 用户列表 */}
          <Card 
            title={t('admin.users.userList')}
            extra={
              <Button 
                type="primary" 
                icon={<UserAddOutlined />}
                onClick={() => {
                  setEditingUser(null)
                  userForm.resetFields()
                  setCreditHistoryData([])
                  setIsUserModalVisible(true)
                }}
              >
                {t('admin.users.addUser')}
              </Button>
            }
          >
            <UserTable
              users={users}
              loading={loading}
              pagination={pagination}
              currentUser={currentUser}
              onPageChange={(page, pageSize) => {
                setPagination(prev => ({ ...prev, current: page, pageSize }))
              }}
              onViewDetail={handleViewDetail}
              onEdit={handleEditUser}
              onToggleStatus={handleToggleUserStatus}
              onDelete={handleDeleteUser}
            />
          </Card>
        </>
      ) : (
        <>
          {/* 分组列表 */}
          <Card 
            title={t('admin.groups.title')}
            extra={
              isSuperAdmin && (
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingGroup(null)
                    groupForm.resetFields()
                    setIsGroupModalVisible(true)
                  }}
                >
                  {t('admin.groups.addGroup')}
                </Button>
              )
            }
          >
            {isGroupAdmin && (
              <Alert
                message="提示"
                description="管理员只能查看所在分组信息，不能创建或修改分组。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <UserGroupTable
              groups={userGroups}
              loading={loading}
              isGroupAdmin={isGroupAdmin}
              onEdit={handleEditGroup}
              onDelete={handleDeleteGroup}
            />
          </Card>
        </>
      )}

      {/* 用户表单弹窗 */}
      <UserFormModal
        visible={isUserModalVisible}
        editingUser={editingUser}
        userGroups={userGroups}
        currentUser={currentUser}
        userCredits={userCredits}
        creditHistory={creditHistoryData}
        historyLoading={historyLoading}
        form={userForm}
        loading={loading}
        onSubmit={editingUser ? handleUpdateUser : handleCreateUser}
        onCancel={() => {
          setIsUserModalVisible(false)
          setEditingUser(null)
          userForm.resetFields()
          setCreditHistoryData([])
        }}
        onLoadCreditHistory={loadCreditHistory}
      />

      {/* 分组表单弹窗 */}
      {isSuperAdmin && (
        <UserGroupFormModal
          visible={isGroupModalVisible}
          editingGroup={editingGroup}
          form={groupForm}
          loading={loading}
          onSubmit={editingGroup ? handleUpdateGroup : handleCreateGroup}
          onCancel={() => {
            setIsGroupModalVisible(false)
            setEditingGroup(null)
            groupForm.resetFields()
          }}
        />
      )}

      {/* 用户详情抽屉 */}
      <UserDetailDrawer
        visible={isDetailVisible}
        userDetail={userDetail}
        onClose={() => setIsDetailVisible(false)}
      />
    </div>
  )
}

export default Users
