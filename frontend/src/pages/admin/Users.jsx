/**
 * 用户管理主页面 - 包含组积分池功能、账号有效期管理和站点配置
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Card, Button, Space, Alert, Form, message, Statistic, Row, Col } from 'antd'
import { 
  UserAddOutlined, 
  PlusOutlined,
  LockOutlined,
  WalletOutlined,
  GiftOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import moment from 'moment'
import { formatDate } from '../../utils/dateFormat'

// 导入子组件
import {
  UserSearchForm,
  UserTable,
  UserFormModal,
  UserDetailDrawer,
  UserGroupTable,
  UserGroupFormModal
} from '../../components/admin/users'

// 导入模型限制管理组件
import UserModelRestrictModal from '../../components/admin/users/UserModelRestrictModal'

// 导入积分池相关组件
import GroupCreditsPoolModal from '../../components/admin/users/GroupCreditsPoolModal'
import DistributeCreditsModal from '../../components/admin/users/DistributeCreditsModal'
import GroupUserLimitModal from '../../components/admin/users/GroupUserLimitModal'

// 导入组有效期管理组件
import GroupExpireDateModal from '../../components/admin/users/GroupExpireDateModal'

// 导入组站点配置组件
import GroupSiteConfigModal from '../../components/admin/users/GroupSiteConfigModal'

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
    removeUserFromGroup,
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
    resetUserPassword,
    setGroupCreditsPool,
    distributeGroupCredits,
    setGroupUserLimit,
    setGroupExpireDate,
    syncGroupExpireDateToUsers,
    setUserAccountExpireDate,
    extendUserAccountExpireDate,
    syncUserAccountExpireWithGroup,
    toggleGroupSiteCustomization,
    updateGroupSiteConfig
  } = useAdminStore()

  // 表单实例
  const [userForm] = Form.useForm()
  const [groupForm] = Form.useForm()
  
  // 状态管理
  const [isUserModalVisible, setIsUserModalVisible] = useState(false)
  const [isGroupModalVisible, setIsGroupModalVisible] = useState(false)
  const [isDetailVisible, setIsDetailVisible] = useState(false)
  const [isModelRestrictModalVisible, setIsModelRestrictModalVisible] = useState(false)
  const [isCreditsPoolModalVisible, setIsCreditsPoolModalVisible] = useState(false)
  const [isDistributeModalVisible, setIsDistributeModalVisible] = useState(false)
  const [isUserLimitModalVisible, setIsUserLimitModalVisible] = useState(false)
  const [isExpireDateModalVisible, setIsExpireDateModalVisible] = useState(false)
  const [isSiteConfigModalVisible, setIsSiteConfigModalVisible] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [modelRestrictUser, setModelRestrictUser] = useState(null)
  const [creditsPoolGroup, setCreditsPoolGroup] = useState(null)
  const [distributeUser, setDistributeUser] = useState(null)
  const [userLimitGroup, setUserLimitGroup] = useState(null)
  const [expireDateGroup, setExpireDateGroup] = useState(null)
  const [siteConfigGroup, setSiteConfigGroup] = useState(null)
  const [activeTab, setActiveTab] = useState('users')
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })
  const [creditHistoryData, setCreditHistoryData] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  
  // 积分相关状态 - 用于优化积分加载
  const [loadingCredits, setLoadingCredits] = useState(false)
  
  // 判断用户权限
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isGroupAdmin = currentUser?.role === 'admin'
  
  // 获取当前组信息
  const currentGroupInfo = userGroups.find(g => g.id === currentUser?.group_id)
  
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

  // 加载积分历史 - 使用防抖避免重复请求
  const loadCreditHistory = useCallback(async (userId) => {
    if (historyLoading) return;
    
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
  }, [getUserCreditsHistory, historyLoading])

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
      if (values.credits_expire_at && typeof values.credits_expire_at.diff === 'function') {
        const days = values.credits_expire_at.diff(moment(), 'days')
        credits_expire_days = Math.max(1, days)
      }
      
      // 处理账号有效期
      let account_expire_days = null
      if (values.expire_at) {
        // 如果expire_at是字符串（YYYY-MM-DD格式）
        if (typeof values.expire_at === 'string' && values.expire_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const expireMoment = moment(values.expire_at)
          const days = expireMoment.diff(moment(), 'days')
          account_expire_days = Math.max(1, days)
        }
      }
      
      await createUser({
        ...values,
        credits_expire_days,
        account_expire_days
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
        expire_at,
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
      
      // 处理账号有效期
      if (expire_at !== undefined) {
        if (expire_at === '' || expire_at === null) {
          updateData.expire_at = null // 清除有效期
        } else if (typeof expire_at === 'string' && expire_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
          updateData.expire_at = expire_at // 已经是正确格式
        }
      }
      
      await updateUser(editingUser.id, updateData)
      
      // 延长账号有效期
      if (extend_days > 0) {
        await extendUserAccountExpireDate(editingUser.id, extend_days)
        message.success(`账号有效期已延长 ${extend_days} 天`)
      }
      
      // 积分操作
      if (creditsOperation && creditsAmount && creditsReason) {
        setLoadingCredits(true)
        try {
          switch (creditsOperation) {
            case 'recharge':
              await addUserCredits(editingUser.id, creditsAmount, creditsReason, extend_days)
              message.success(t('admin.credits.recharge.success', { amount: creditsAmount }))
              break
            case 'deduct':
              await deductUserCredits(editingUser.id, creditsAmount, creditsReason)
              message.success(t('admin.credits.deduct.success', { amount: creditsAmount }))
              break
            case 'set':
              await setUserCreditsQuota(editingUser.id, creditsAmount, creditsReason)
              message.success(t('admin.credits.setQuota.success', { amount: creditsAmount }))
              break
          }
          await getUserCredits(editingUser.id)
          await loadCreditHistory(editingUser.id)
        } catch (error) {
          message.error(error.response?.data?.message || t('admin.credits.failed'))
        } finally {
          setLoadingCredits(false)
        }
      }
      
      // 积分有效期设置
      if (credits_expire_at && typeof credits_expire_at.format === 'function') {
        await setUserCreditsExpire(editingUser.id, { 
          expire_at: credits_expire_at.format('YYYY-MM-DD HH:mm:ss') 
        })
      }
      
      // 密码重置
      if (newPassword && confirmPassword) {
        if (newPassword !== confirmPassword) {
          message.error(t('admin.users.password.mismatch'))
          return
        }
        await resetUserPassword(editingUser.id, newPassword)
        message.success(t('admin.users.password.reset.success'))
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
      message.success('用户状态更新成功')
      loadUsers()
    } catch (error) {
      message.error('用户状态更新失败')
    }
  }

  // 查看用户详情 - 修复：接收userId而不是user对象
  const handleViewDetail = async (userId) => {
    try {
      const detail = await getUserDetail(userId)
      setIsDetailVisible(true)
    } catch (error) {
      message.error('获取用户详情失败')
    }
  }

  // 编辑用户
  const handleEditUser = async (user) => {
    setEditingUser(user)
    userForm.setFieldsValue({
      ...user,
      credits_expire_at: user.credits_expire_at ? moment(user.credits_expire_at) : null,
      expire_at: formatDate(user.expire_at) || '' // 格式化日期为 YYYY-MM-DD
    })
    
    // 加载用户积分信息
    if (!isGroupAdmin || user.group_id === currentUser.group_id) {
      setLoadingCredits(true)
      try {
        await getUserCredits(user.id)
        await loadCreditHistory(user.id)
      } catch (error) {
        console.error('加载用户积分信息失败:', error)
      } finally {
        setLoadingCredits(false)
      }
    }
    
    setIsUserModalVisible(true)
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

  // 管理用户模型权限
  const handleManageModels = (user) => {
    setModelRestrictUser(user)
    setIsModelRestrictModalVisible(true)
  }

  // 挪出用户
  const handleRemoveFromGroup = async (user) => {
    try {
      const result = await removeUserFromGroup(user.id)
      message.success(
        `用户 ${user.username} 已成功挪出到默认组${
          result.returnedCredits > 0 
            ? `，返还 ${result.returnedCredits} 积分到组积分池` 
            : ''
        }`
      )
      // 刷新用户列表和组信息
      loadUsers()
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '挪出用户失败')
    }
  }

  // 创建分组
  const handleCreateGroup = async (values) => {
    try {
      await createUserGroup(values)
      setIsGroupModalVisible(false)
      groupForm.resetFields()
      message.success('分组创建成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '分组创建失败')
    }
  }

  // 更新分组
  const handleUpdateGroup = async (values) => {
    try {
      await updateUserGroup(editingGroup.id, values)
      setIsGroupModalVisible(false)
      setEditingGroup(null)
      groupForm.resetFields()
      message.success('分组更新成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '分组更新失败')
    }
  }

  // 删除分组
  const handleDeleteGroup = async (groupId) => {
    try {
      await deleteUserGroup(groupId)
      message.success('分组删除成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '分组删除失败')
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
      sort_order: group.sort_order,
      expire_date: formatDate(group.expire_date) || '' // 格式化日期为 YYYY-MM-DD
    })
    setIsGroupModalVisible(true)
  }

  // 设置组积分池
  const handleSetCreditsPool = (group) => {
    setCreditsPoolGroup(group)
    setIsCreditsPoolModalVisible(true)
  }

  const handleSubmitCreditsPool = async (groupId, creditsPool) => {
    try {
      await setGroupCreditsPool(groupId, creditsPool)
      setIsCreditsPoolModalVisible(false)
      setCreditsPoolGroup(null)
      message.success('组积分池设置成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '设置失败')
    }
  }

  // 分配积分
  const handleDistributeCredits = (user) => {
    setDistributeUser(user)
    setIsDistributeModalVisible(true)
  }

  const handleSubmitDistribute = async (userId, amount, reason, operation = 'distribute') => {
    try {
      await distributeGroupCredits(currentUser.group_id, userId, amount, reason, operation)
      setIsDistributeModalVisible(false)
      setDistributeUser(null)
      message.success(operation === 'distribute' ? '积分分配成功' : '积分回收成功')
      loadUsers()
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || (operation === 'distribute' ? '分配失败' : '回收失败'))
    }
  }

  // 设置组员上限
  const handleSetUserLimit = (group) => {
    setUserLimitGroup(group)
    setIsUserLimitModalVisible(true)
  }

  const handleSubmitUserLimit = async (groupId, userLimit) => {
    try {
      await setGroupUserLimit(groupId, userLimit)
      setIsUserLimitModalVisible(false)
      setUserLimitGroup(null)
      message.success('组员上限设置成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '设置失败')
    }
  }

  // 设置组有效期
  const handleSetExpireDate = (group) => {
    setExpireDateGroup(group)
    setIsExpireDateModalVisible(true)
  }

  const handleSubmitExpireDate = async (groupId, expireDate, syncToUsers) => {
    try {
      await setGroupExpireDate(groupId, expireDate, syncToUsers)
      setIsExpireDateModalVisible(false)
      setExpireDateGroup(null)
      message.success('组有效期设置成功')
      loadUserGroups()
      if (syncToUsers) {
        loadUsers() // 如果同步到用户，刷新用户列表
      }
    } catch (error) {
      message.error(error.response?.data?.message || '设置失败')
    }
  }

  // 切换组站点自定义开关
  const handleToggleSiteCustomization = async (group, enabled) => {
    try {
      await toggleGroupSiteCustomization(group.id, enabled)
      message.success(enabled ? '已开启站点自定义功能' : '已关闭站点自定义功能')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '设置失败')
    }
  }

  // 编辑组站点配置
  const handleEditSiteConfig = (group) => {
    setSiteConfigGroup(group)
    setIsSiteConfigModalVisible(true)
  }

  const handleSubmitSiteConfig = async (values) => {
    try {
      await updateGroupSiteConfig(siteConfigGroup.id, values)
      setIsSiteConfigModalVisible(false)
      setSiteConfigGroup(null)
      message.success('站点配置更新成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '更新失败')
    }
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
          {/* 用户搜索表单 */}
          <Card style={{ marginBottom: 16 }}>
            <UserSearchForm
              userGroups={userGroups}
              onSearch={handleSearch}
              isGroupAdmin={isGroupAdmin}
              currentUser={currentUser}
            />
          </Card>

          {/* 组管理员看到的组积分池信息 */}
          {isGroupAdmin && currentGroupInfo && (
            <Card style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="组积分池总额"
                    value={currentGroupInfo.credits_pool || 0}
                    prefix={<WalletOutlined />}
                    suffix="积分"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="已分配积分"
                    value={currentGroupInfo.credits_pool_used || 0}
                    prefix={<GiftOutlined />}
                    suffix="积分"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="剩余可分配"
                    value={currentGroupInfo.credits_pool_remaining || 0}
                    valueStyle={{ color: currentGroupInfo.credits_pool_remaining > 0 ? '#3f8600' : '#cf1322' }}
                    suffix="积分"
                  />
                </Col>
              </Row>
              {/* 显示组站点配置信息 */}
              {currentGroupInfo.site_customization_enabled && (
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={24}>
                    <Alert
                      message="站点自定义"
                      description={
                        <Space direction="vertical">
                          <span>
                            <GlobalOutlined /> 站点名称：{currentGroupInfo.site_name || '使用系统默认'}
                          </span>
                          {currentGroupInfo.site_logo && <span>已配置自定义Logo</span>}
                        </Space>
                      }
                      type="info"
                      showIcon
                    />
                  </Col>
                </Row>
              )}
            </Card>
          )}

          {/* 用户列表 */}
          <Card 
            title={t('admin.users.title')}
            extra={
              <Button 
                type="primary" 
                icon={<UserAddOutlined />}
                onClick={() => {
                  setEditingUser(null)
                  userForm.resetFields()
                  setIsUserModalVisible(true)
                }}
              >
                {t('admin.users.addUser')}
              </Button>
            }
          >
            <UserTable
              users={users}
              loading={loading || loadingCredits}
              pagination={pagination}
              currentUser={currentUser}
              isGroupAdmin={isGroupAdmin}
              onPageChange={(page, pageSize) => {
                setPagination(prev => ({ ...prev, current: page, pageSize }))
              }}
              onViewDetail={handleViewDetail}
              onEdit={handleEditUser}
              onToggleStatus={handleToggleUserStatus}
              onDelete={handleDeleteUser}
              onManageModels={handleManageModels}
              onDistributeCredits={handleDistributeCredits}
              onRemoveFromGroup={handleRemoveFromGroup}
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
                description={
                  <div>
                    <p>管理员只能查看所在分组信息，不能创建或修改分组。</p>
                    {currentGroupInfo?.site_customization_enabled && (
                      <p>您的组已开启站点自定义功能，可以配置专属的站点名称和Logo。</p>
                    )}
                  </div>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <UserGroupTable
              groups={userGroups}
              loading={loading}
              isGroupAdmin={isGroupAdmin}
              isSuperAdmin={isSuperAdmin}
              currentUser={currentUser}
              onEdit={handleEditGroup}
              onDelete={handleDeleteGroup}
              onSetCreditsPool={handleSetCreditsPool}
              onSetUserLimit={handleSetUserLimit}
              onSetExpireDate={handleSetExpireDate}
              onToggleSiteCustomization={handleToggleSiteCustomization}
              onEditSiteConfig={handleEditSiteConfig}
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

      {/* 用户模型限制管理弹窗 */}
      <UserModelRestrictModal
        visible={isModelRestrictModalVisible}
        user={modelRestrictUser}
        onCancel={() => {
          setIsModelRestrictModalVisible(false)
          setModelRestrictUser(null)
        }}
        onSuccess={() => {
          loadUsers()
        }}
      />

      {/* 组积分池设置弹窗 */}
      {isSuperAdmin && (
        <GroupCreditsPoolModal
          visible={isCreditsPoolModalVisible}
          group={creditsPoolGroup}
          loading={loading}
          onSubmit={handleSubmitCreditsPool}
          onCancel={() => {
            setIsCreditsPoolModalVisible(false)
            setCreditsPoolGroup(null)
          }}
        />
      )}

      {/* 积分分配弹窗 */}
      {(isGroupAdmin || isSuperAdmin) && (
        <DistributeCreditsModal
          visible={isDistributeModalVisible}
          user={distributeUser}
          groupInfo={currentGroupInfo}
          loading={loading}
          onSubmit={handleSubmitDistribute}
          onCancel={() => {
            setIsDistributeModalVisible(false)
            setDistributeUser(null)
          }}
        />
      )}

      {/* 组员上限设置弹窗 */}
      {isSuperAdmin && (
        <GroupUserLimitModal
          visible={isUserLimitModalVisible}
          group={userLimitGroup}
          loading={loading}
          onSubmit={handleSubmitUserLimit}
          onCancel={() => {
            setIsUserLimitModalVisible(false)
            setUserLimitGroup(null)
          }}
        />
      )}

      {/* 组有效期设置弹窗 */}
      {isSuperAdmin && (
        <GroupExpireDateModal
          visible={isExpireDateModalVisible}
          group={expireDateGroup}
          loading={loading}
          onSubmit={handleSubmitExpireDate}
          onCancel={() => {
            setIsExpireDateModalVisible(false)
            setExpireDateGroup(null)
          }}
        />
      )}

      {/* 组站点配置弹窗 */}
      {(isGroupAdmin || isSuperAdmin) && (
        <GroupSiteConfigModal
          visible={isSiteConfigModalVisible}
          group={siteConfigGroup}
          loading={loading}
          onSubmit={handleSubmitSiteConfig}
          onCancel={() => {
            setIsSiteConfigModalVisible(false)
            setSiteConfigGroup(null)
          }}
        />
      )}
    </div>
  )
}

export default Users
