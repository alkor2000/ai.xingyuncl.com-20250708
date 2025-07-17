/**
 * 用户搜索表单组件
 */

import React from 'react'
import { Form, Input, Select, Button, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const UserSearchForm = ({ 
  onSearch, 
  onReset, 
  userGroups = [], 
  isGroupAdmin = false,
  isSuperAdmin = false
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  const handleReset = () => {
    form.resetFields()
    onReset()
  }

  return (
    <Form
      form={form}
      layout="inline"
      onFinish={onSearch}
    >
      <Form.Item name="search">
        <Input 
          placeholder={t('admin.users.searchPlaceholder')} 
          style={{ width: 200 }} 
        />
      </Form.Item>
      
      <Form.Item name="role">
        <Select 
          placeholder={t('admin.users.form.role')} 
          style={{ width: 120 }} 
          allowClear
        >
          <Select.Option value="user">{t('role.user')}</Select.Option>
          {isSuperAdmin && (
            <>
              <Select.Option value="admin">{t('role.admin')}</Select.Option>
              <Select.Option value="super_admin">{t('role.super_admin')}</Select.Option>
            </>
          )}
        </Select>
      </Form.Item>
      
      {!isGroupAdmin && (
        <Form.Item name="group_id">
          <Select 
            placeholder={t('admin.users.form.group')} 
            style={{ width: 150 }} 
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
      
      <Form.Item name="status">
        <Select 
          placeholder={t('admin.users.form.status')} 
          style={{ width: 100 }} 
          allowClear
        >
          <Select.Option value="active">{t('status.active')}</Select.Option>
          <Select.Option value="inactive">{t('status.inactive')}</Select.Option>
        </Select>
      </Form.Item>
      
      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">
            {t('button.search')}
          </Button>
          <Button 
            icon={<ReloadOutlined />}
            onClick={handleReset}
          >
            {t('button.reset')}
          </Button>
        </Space>
      </Form.Item>
    </Form>
  )
}

export default UserSearchForm
