/**
 * 用户管理主页面
 * 
 * 功能包含：
 * - 用户列表管理（搜索、分页、CRUD）
 * - 用户分组管理
 * - 组积分池管理
 * - 账号有效期管理
 * - 站点配置管理
 * - 邀请码管理
 * - 标签管理
 * - 批量创建用户（v1.1新增）
 * - 数据分析入口
 * 
 * 更新记录：
 * - v1.1: 新增批量创建用户功能
 */

import React, { useEffect, useState } from 'react'
import { Card, Button, Space, Alert, Form, message, Statistic, Row, Col, Tabs, Divider } from 'antd'
import { 
  UserAddOutlined, 
  PlusOutlined,
  LockOutlined,
  WalletOutlined,
  GiftOutlined,
  GlobalOutlined,
  TagsOutlined,
  PieChartOutlined,
  BarChartOutlined,
  DashboardOutlined,
  UsergroupAddOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
  UserGroupFormModal,
  GroupInvitationCodeModal,
  GroupInvitationLogsModal,
  BatchCreateUsersModal
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

// 导入标签管理组件
import { UserTagAssign, UserTagManager, TagStatistics } from '../../components/admin/tags'

const { TabPane } = Tabs

const Users = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
    removeUserFromGroup,
    getUserGroups,
    createUserGroup,
    updateUserGroup,
    deleteUserGroup,
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
    updateGroupSiteConfig,
    setGroupInvitationCode,
    getInvitationCodeLogs,
    batchCreateUsers
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
  const [isInvitationCodeModalVisible, setIsInvitationCodeModalVisible] = useState(false)
  const [isInvitationLogsModalVisible, setIsInvitationLogsModalVisible] = useState(false)
  const [isTagAssignModalVisible, setIsTagAssignModalVisible] = useState(false)
  const [isBatchCreateModalVisible, setIsBatchCreateModalVisible] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [modelRestrictUser, setModelRestrictUser] = useState(null)
  const [creditsPoolGroup, setCreditsPoolGroup] = useState(null)
  const [distributeUser, setDistributeUser] = useState(null)
  const [userLimitGroup, setUserLimitGroup] = useState(null)
  const [expireDateGroup, setExpireDateGroup] = useState(null)
  const [siteConfigGroup, setSiteConfigGroup] = useState(null)
  const [invitationCodeGroup, setInvitationCodeGroup] = useState(null)
  const [invitationLogsGroup, setInvitationLogsGroup] = useState(null)
  const [tagAssignUser, setTagAssignUser] = useState(null)
  const [activeTab, setActiveTab] = useState('users')
  const [activeGroupTab, setActiveGroupTab] = useState('info')
  const [batchCreateLoading, setBatchCreateLoading] = useState(false)
  
  // 搜索状态管理
  const [currentSearchParams, setCurrentSearchParams] = useState({})
  
  // 用户分页状态
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  })

  // 用户组分页状态
  const [groupPagination, setGroupPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  })
  
  // 判断用户权限
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isGroupAdmin = currentUser?.role === 'admin'
  
  // 获取当前组信息
  const currentGroupInfo = userGroups.find(g => g.id === currentUser?.group_id)
  
  // 统一的加载用户列表函数
  const loadUsers = async (searchParams = {}, pageParams = {}) => {
    try {
      const finalParams = {
        ...currentSearchParams,
        ...searchParams,
        page: pageParams.current || pagination.current,
        limit: pageParams.pageSize || pagination.pageSize,
        include_tags: true
      }

      console.log('🔍 加载用户列表参数:', finalParams)

      const result = await getUsers(finalParams)
      
      setPagination(prev => ({
        ...prev,
        ...pageParams,
        total: result.pagination.total
      }))

      return result
    } catch (error) {
      console.error('加载用户失败:', error)
      message.error('加载用户列表失败')
    }
  }

  // 加载用户分组
  const loadUserGroups = async () => {
    try {
      await getUserGroups()
      setGroupPagination(prev => ({
        ...prev,
        total: userGroups.length
      }))
    } catch (error) {
      console.error('加载用户分组失败:', error)
      message.error('加载用户分组失败')
    }
  }

  // 初始化加载
  useEffect(() => {
    if (hasPermission('user.manage') || hasPermission('user.manage.group')) {
      loadUsers()
      loadUserGroups()
    }
  }, [hasPermission])

  // 监听 userGroups 变化，更新分页总数
  useEffect(() => {
    if (userGroups.length > 0) {
      setGroupPagination(prev => ({
        ...prev,
        total: userGroups.length
      }))
    }
  }, [userGroups])

  // 用户搜索
  const handleSearch = async (searchValues) => {
    console.log('🔍 执行用户搜索:', searchValues)
    
    setCurrentSearchParams(searchValues)
    
    const newPagination = { current: 1, pageSize: pagination.pageSize }
    setPagination(prev => ({ ...prev, current: 1 }))
    
    await loadUsers(searchValues, newPagination)
  }

  // 分页处理
  const handlePageChange = async (page, pageSize) => {
    console.log('📄 分页切换:', { page, pageSize, currentSearchParams })
    
    const newPagination = { current: page, pageSize }
    setPagination(prev => ({ ...prev, ...newPagination }))
    
    await loadUsers({}, newPagination)
  }

  // 用户组分页处理（前端分页）
  const handleGroupPageChange = (page, pageSize) => {
    console.log('📄 用户组分页切换:', { page, pageSize })
    setGroupPagination({
      current: page,
      pageSize: pageSize,
      total: groupPagination.total
    })
  }

  // 重置搜索
  const handleResetSearch = async () => {
    console.log('🔄 重置搜索')
    
    setCurrentSearchParams({})
    
    const newPagination = { current: 1, pageSize: pagination.pageSize }
    setPagination(prev => ({ ...prev, current: 1 }))
    
    await loadUsers({}, newPagination)
  }

  // 创建用户
  const handleCreateUser = async (values) => {
    try {
      let account_expire_days = null
      if (values.expire_at) {
        if (typeof values.expire_at === 'string' && values.expire_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const expireMoment = moment(values.expire_at)
          const days = expireMoment.diff(moment(), 'days')
          account_expire_days = Math.max(1, days)
        }
      }
      
      await createUser({
        ...values,
        account_expire_days
      })
      
      setIsUserModalVisible(false)
      userForm.resetFields()
      message.success(t('admin.users.create.success'))
      
      await loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.users.create.failed'))
    }
  }

  // 批量创建用户（v1.1新增）
  const handleBatchCreateUsers = async (batchData) => {
    try {
      setBatchCreateLoading(true)
      const result = await batchCreateUsers(batchData)
      
      if (result.success) {
        // 刷新用户列表和组信息
        await loadUsers()
        await loadUserGroups()
      }
      
      return result
    } catch (error) {
      message.error(error.response?.data?.message || '批量创建用户失败')
      throw error
    } finally {
      setBatchCreateLoading(false)
    }
  }

  // 更新用户
  const handleUpdateUser = async (values) => {
    try {
      const { 
        newPassword, 
        confirmPassword,
        expire_at,
        extend_days,
        ...updateData 
      } = values
      
      if (isGroupAdmin) {
        delete updateData.role
        delete updateData.group_id
        delete updateData.credits_quota
        delete updateData.token_quota
        delete updateData.email
        delete updateData.username
      }
      
      if (expire_at !== undefined) {
        if (expire_at === '' || expire_at === null) {
          updateData.expire_at = null
        } else if (typeof expire_at === 'string' && expire_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
          updateData.expire_at = expire_at
        }
      }
      
      await updateUser(editingUser.id, updateData)
      
      if (extend_days > 0) {
        await extendUserAccountExpireDate(editingUser.id, extend_days)
        message.success(`账号有效期已延长 ${extend_days} 天`)
      }
      
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
      
      await loadUsers()
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
      
      await loadUsers()
    } catch (error) {
      message.error('用户状态更新失败')
    }
  }

  // 查看用户详情
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
    
    const formValues = {
      email: user.email,
      username: user.username,
      role: user.role,
      group_id: user.group_id,
      status: user.status,
      remark: user.remark,
      token_quota: user.token_quota,
      credits_quota: user.credits_quota,
      expire_at: formatDate(user.expire_at) || ''
    }
    
    userForm.setFieldsValue(formValues)
    setIsUserModalVisible(true)
  }

  // 删除用户
  const handleDeleteUser = async (userId) => {
    try {
      await deleteUser(userId)
      message.success('用户删除成功')
      
      const currentTotal = pagination.total
      const currentPage = pagination.current
      const pageSize = pagination.pageSize
      
      if ((currentTotal - 1) <= (currentPage - 1) * pageSize && currentPage > 1) {
        const newPagination = { current: currentPage - 1, pageSize }
        setPagination(prev => ({ ...prev, current: currentPage - 1 }))
        await loadUsers({}, newPagination)
      } else {
        await loadUsers()
      }
    } catch (error) {
      message.error('用户删除失败')
    }
  }

  // 管理用户模型权限
  const handleManageModels = (user) => {
    setModelRestrictUser(user)
    setIsModelRestrictModalVisible(true)
  }

  // 管理用户标签
  const handleManageTags = (user) => {
    setTagAssignUser(user)
    setIsTagAssignModalVisible(true)
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
      await loadUsers()
      await loadUserGroups()
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
      expire_date: formatDate(group.expire_date) || ''
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
      const targetGroupId = isSuperAdmin && distributeUser?.group_id 
        ? distributeUser.group_id 
        : currentUser.group_id
        
      await distributeGroupCredits(targetGroupId, userId, amount, reason, operation)
      setIsDistributeModalVisible(false)
      setDistributeUser(null)
      message.success(operation === 'distribute' ? '积分分配成功' : '积分回收成功')
      
      await loadUsers()
      await loadUserGroups()
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
        await loadUsers()
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

  // 管理邀请码
  const handleManageInvitationCode = (group) => {
    if (isGroupAdmin && group.id !== currentUser.group_id) {
      message.warning('只能管理本组的邀请码')
      return
    }
    
    setInvitationCodeGroup(group)
    setIsInvitationCodeModalVisible(true)
  }

  const handleSubmitInvitationCode = async (invitationData) => {
    try {
      await setGroupInvitationCode(invitationCodeGroup.id, invitationData)
      setIsInvitationCodeModalVisible(false)
      setInvitationCodeGroup(null)
      message.success('邀请码设置成功')
      loadUserGroups()
    } catch (error) {
      message.error(error.response?.data?.message || '设置失败')
    }
  }

  // 查看邀请记录
  const handleViewInvitationLogs = (group) => {
    setInvitationLogsGroup(group)
    setIsInvitationLogsModalVisible(true)
  }

  // 获取分配积分时使用的组信息
  const getDistributeGroupInfo = () => {
    if (isSuperAdmin && distributeUser?.group_id) {
      return userGroups.find(g => g.id === distributeUser.group_id)
    }
    return currentGroupInfo
  }

  // 跳转到数据分析页面
  const handleGoToAnalytics = () => {
    navigate('/admin/analytics')
  }

  // 获取当前页显示的用户组数据
  const getCurrentPageGroups = () => {
    const { current, pageSize } = groupPagination
    const start = (current - 1) * pageSize
    const end = start + pageSize
    return userGroups.slice(start, end)
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
        <Row justify="space-between" align="middle">
          <Col>
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
          </Col>
          <Col>
            {/* 数据分析入口按钮 */}
            <Button 
              type="default"
              icon={<BarChartOutlined />}
              onClick={handleGoToAnalytics}
              style={{ 
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none'
              }}
            >
              {t('admin.analytics.title')}
            </Button>
          </Col>
        </Row>
      </Card>

      {activeTab === 'users' ? (
        <>
          {/* 用户搜索表单 */}
          <Card style={{ marginBottom: 16 }}>
            <UserSearchForm
              userGroups={userGroups}
              onSearch={handleSearch}
              onReset={handleResetSearch}
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
              {currentGroupInfo.site_customization_enabled && (
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={24}>
                    <Alert
                      message="站点自定义"
                      description={
                        <span>
                          <GlobalOutlined /> 站点名称：{currentGroupInfo.site_name || '使用系统默认'}
                        </span>
                      }
                      type="info"
                      showIcon
                    />
                  </Col>
                </Row>
              )}
              {currentGroupInfo.invitation_enabled && currentGroupInfo.invitation_code && (
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={24}>
                    <Alert
                      message="组邀请码"
                      description={
                        <span>
                          邀请码：<strong>{currentGroupInfo.invitation_code}</strong>
                          {currentGroupInfo.invitation_usage_count > 0 && (
                            <span>（已使用 {currentGroupInfo.invitation_usage_count} 次）</span>
                          )}
                        </span>
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
              <Space>
                {/* 批量创建用户按钮 - v1.1新增 */}
                <Button 
                  type="default"
                  icon={<UsergroupAddOutlined />}
                  onClick={() => setIsBatchCreateModalVisible(true)}
                  style={{
                    background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                    color: 'white',
                    border: 'none'
                  }}
                >
                  批量创建
                </Button>
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
                <Button 
                  icon={<DashboardOutlined />}
                  onClick={handleGoToAnalytics}
                  style={{ display: 'none' }}
                  className="mobile-analytics-btn"
                >
                  {t('admin.analytics.title')}
                </Button>
              </Space>
            }
          >
            <UserTable
              users={users}
              loading={loading}
              pagination={pagination}
              currentUser={currentUser}
              isGroupAdmin={isGroupAdmin}
              onPageChange={handlePageChange}
              onViewDetail={handleViewDetail}
              onEdit={handleEditUser}
              onToggleStatus={handleToggleUserStatus}
              onDelete={handleDeleteUser}
              onManageModels={handleManageModels}
              onManageTags={handleManageTags}
              onDistributeCredits={handleDistributeCredits}
              onRemoveFromGroup={handleRemoveFromGroup}
            />
          </Card>
        </>
      ) : (
        <>
          {/* 分组管理标签页 */}
          <Card>
            <Tabs activeKey={activeGroupTab} onChange={setActiveGroupTab}>
              <TabPane tab="分组信息" key="info">
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
                            <p>您的组已开启站点自定义功能，可以配置专属的站点名称。</p>
                          )}
                          <p>您可以管理本组的邀请码设置和标签。</p>
                        </div>
                      }
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                  )}
                  <UserGroupTable
                    groups={getCurrentPageGroups()}
                    loading={loading}
                    isGroupAdmin={isGroupAdmin}
                    isSuperAdmin={isSuperAdmin}
                    currentUser={currentUser}
                    pagination={groupPagination}
                    onPageChange={handleGroupPageChange}
                    onEdit={handleEditGroup}
                    onDelete={handleDeleteGroup}
                    onSetCreditsPool={handleSetCreditsPool}
                    onSetUserLimit={handleSetUserLimit}
                    onSetExpireDate={handleSetExpireDate}
                    onToggleSiteCustomization={handleToggleSiteCustomization}
                    onEditSiteConfig={handleEditSiteConfig}
                    onManageInvitationCode={handleManageInvitationCode}
                    onViewInvitationLogs={handleViewInvitationLogs}
                  />
                </Card>
              </TabPane>

              {/* 标签管理Tab */}
              <TabPane 
                tab={
                  <span>
                    <TagsOutlined />
                    标签管理
                  </span>
                } 
                key="tags"
              >
                <UserTagManager 
                  groupId={isGroupAdmin ? currentUser.group_id : (currentGroupInfo?.id || 1)}
                  currentUser={currentUser}
                />
              </TabPane>

              {/* 标签统计Tab */}
              <TabPane 
                tab={
                  <span>
                    <PieChartOutlined />
                    标签统计
                  </span>
                } 
                key="tag-stats"
              >
                <TagStatistics 
                  groupId={isGroupAdmin ? currentUser.group_id : (currentGroupInfo?.id || 1)}
                />
              </TabPane>
            </Tabs>
          </Card>
        </>
      )}

      {/* 用户表单弹窗 */}
      <UserFormModal
        visible={isUserModalVisible}
        editingUser={editingUser}
        userGroups={userGroups}
        currentUser={currentUser}
        form={userForm}
        loading={loading}
        onSubmit={editingUser ? handleUpdateUser : handleCreateUser}
        onCancel={() => {
          setIsUserModalVisible(false)
          setEditingUser(null)
          userForm.resetFields()
        }}
      />

      {/* 批量创建用户弹窗 - v1.1新增 */}
      <BatchCreateUsersModal
        visible={isBatchCreateModalVisible}
        userGroups={userGroups}
        currentUser={currentUser}
        loading={batchCreateLoading}
        onSubmit={handleBatchCreateUsers}
        onCancel={() => setIsBatchCreateModalVisible(false)}
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

      {/* 用户标签分配弹窗 */}
      <UserTagAssign
        visible={isTagAssignModalVisible}
        user={tagAssignUser}
        groupId={tagAssignUser?.group_id}
        onCancel={() => {
          setIsTagAssignModalVisible(false)
          setTagAssignUser(null)
        }}
        onSuccess={() => {
          loadUsers()
          setIsTagAssignModalVisible(false)
          setTagAssignUser(null)
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
          groupInfo={getDistributeGroupInfo()} 
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

      {/* 邀请码管理弹窗 */}
      {(isSuperAdmin || isGroupAdmin) && (
        <GroupInvitationCodeModal
          visible={isInvitationCodeModalVisible}
          group={invitationCodeGroup}
          loading={loading}
          onOk={handleSubmitInvitationCode}
          onCancel={() => {
            setIsInvitationCodeModalVisible(false)
            setInvitationCodeGroup(null)
          }}
        />
      )}

      {/* 邀请记录查看弹窗 */}
      {isSuperAdmin && (
        <GroupInvitationLogsModal
          visible={isInvitationLogsModalVisible}
          group={invitationLogsGroup}
          onCancel={() => {
            setIsInvitationLogsModalVisible(false)
            setInvitationLogsGroup(null)
          }}
        />
      )}

      {/* 响应式样式 */}
      <style jsx>{`
        @media (max-width: 768px) {
          .mobile-analytics-btn {
            display: inline-block !important;
          }
        }
      `}</style>
    </div>
  )
}

export default Users
