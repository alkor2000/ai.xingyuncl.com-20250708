/**
 * 用户搜索表单组件 - 修复角色选择和搜索功能，支持重置回调
 */

import React from 'react'
import { Form, Input, Select, Button, Space } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const UserSearchForm = ({ 
  onSearch, 
  onReset,
  userGroups = [], 
  isGroupAdmin = false,
  currentUser = {}
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  // 判断是否为超级管理员
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const handleReset = () => {
    form.resetFields()
    // 调用父组件的重置回调
    if (onReset) {
      onReset()
    } else {
      // 如果没有重置回调，执行空搜索
      onSearch({})
    }
  }

  const handleFinish = (values) => {
    // 过滤掉空值，避免传递无效参数
    const filteredValues = Object.keys(values).reduce((acc, key) => {
      if (values[key] !== undefined && values[key] !== '' && values[key] !== null) {
        acc[key] = values[key]
      }
      return acc
    }, {})
    
    console.log('🔍 用户搜索参数:', filteredValues)
    onSearch(filteredValues)
  }

  return (
    <Form
      form={form}
      layout="inline"
      onFinish={handleFinish}
      style={{ width: '100%' }}
    >
      <Form.Item name="search" style={{ minWidth: 200 }}>
        <Input 
          placeholder={t('admin.users.searchPlaceholder') || '搜索用户名、邮箱或UUID'} 
          prefix={<SearchOutlined />}
          allowClear
        />
      </Form.Item>
      
      <Form.Item name="role" style={{ minWidth: 140 }}>
        <Select 
          placeholder={t('admin.users.form.role') || '选择角色'} 
          allowClear
        >
          <Select.Option value="user">{t('role.user') || '普通用户'}</Select.Option>
          {/* 根据当前用户权限显示角色选项 */}
          {isSuperAdmin && (
            <>
              <Select.Option value="admin">{t('role.admin') || '组管理员'}</Select.Option>
              <Select.Option value="super_admin">{t('role.super_admin') || '超级管理员'}</Select.Option>
            </>
          )}
        </Select>
      </Form.Item>
      
      {/* 只有超级管理员可以按分组搜索 */}
      {!isGroupAdmin && (
        <Form.Item name="group_id" style={{ minWidth: 150 }}>
          <Select 
            placeholder={t('admin.users.form.group') || '选择分组'} 
            allowClear
          >
            {userGroups.map(group => (
              <Select.Option key={group.id} value={group.id}>
                <span style={{ color: group.color }}>{group.name}</span>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      )}
      
      <Form.Item name="status" style={{ minWidth: 100 }}>
        <Select 
          placeholder={t('admin.users.form.status') || '状态'} 
          allowClear
        >
          <Select.Option value="active">{t('status.active') || '激活'}</Select.Option>
          <Select.Option value="inactive">{t('status.inactive') || '禁用'}</Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item>
        <Space>
          <Button 
            type="primary" 
            htmlType="submit"
            icon={<SearchOutlined />}
          >
            {t('button.search') || '搜索'}
          </Button>
          <Button 
            icon={<ReloadOutlined />}
            onClick={handleReset}
          >
            {t('button.reset') || '重置'}
          </Button>
        </Space>
      </Form.Item>
    </Form>
  )
}

export default UserSearchForm
