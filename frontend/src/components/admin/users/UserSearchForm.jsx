/**
 * 用户搜索表单组件 - 修复角色选择和搜索功能，支持重置回调
 *
 * 更新记录：
 * - v1.1 (本次): 用户分组筛选下拉新增关键字搜索能力
 *   问题背景：生产环境已有四五百个用户组，原下拉框无任何搜索能力，
 *   只能靠鼠标滚动逐一查找目标分组，效率极低。
 *   修复方案：为分组Select添加showSearch开启搜索输入框；
 *   由于Option内容为带颜色样式的JSX（<span style={{color}}>{name}</span>）
 *   而非纯文本，Antd默认的文本匹配无法直接生效，故采用本项目其他组件
 *   （如UserFormModal.jsx/BatchCreateUsersModal.jsx）已采用的既定模式：
 *   单独给Option传递label={group.name}属性，optionFilterProp指向该属性，
 *   filterOption自定义按分组名小写模糊匹配，兼顾颜色展示与搜索过滤。
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

  /**
   * 用户分组下拉的自定义过滤函数
   * 按分组名（option.label）小写模糊匹配，与input输入值大小写无关比较
   */
  const filterGroupOption = (input, option) => {
    return (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
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
            showSearch
            optionFilterProp="label"
            filterOption={filterGroupOption}
          >
            {userGroups.map(group => (
              <Select.Option key={group.id} value={group.id} label={group.name}>
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
