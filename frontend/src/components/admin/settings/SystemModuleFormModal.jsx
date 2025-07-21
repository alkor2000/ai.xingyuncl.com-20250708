/**
 * 系统模块表单弹窗组件 - 简化版用于外部应用集成
 */

import React, { useEffect } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Row,
  Col,
  Space,
  Button,
  InputNumber
} from 'antd'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'
import * as Icons from '@ant-design/icons'

const { TextArea } = Input

// 常用图标列表
const commonIcons = [
  'AppstoreOutlined',
  'ApiOutlined',
  'CloudOutlined',
  'DatabaseOutlined',
  'FileTextOutlined',
  'FolderOutlined',
  'GlobalOutlined',
  'HomeOutlined',
  'LinkOutlined',
  'PictureOutlined',
  'ProjectOutlined',
  'RocketOutlined',
  'SettingOutlined',
  'TeamOutlined',
  'ToolOutlined',
  'UserOutlined',
  'VideoCameraOutlined',
  'BarChartOutlined',
  'CodeOutlined',
  'DashboardOutlined'
]

const SystemModuleFormModal = ({
  visible,
  editingModule,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()
  const { userGroups, getUserGroups } = useAdminStore()

  // 加载用户组列表
  useEffect(() => {
    if (visible) {
      getUserGroups()
    }
  }, [visible, getUserGroups])

  // 设置编辑时的默认值
  useEffect(() => {
    if (editingModule && visible) {
      form.setFieldsValue({
        ...editingModule,
        allowed_groups: editingModule.allowed_groups || []
      })
    }
  }, [editingModule, visible, form])

  return (
    <Modal
      title={editingModule ? t('admin.modules.editModule') : t('admin.modules.addModule')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      width={800}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={{
          open_mode: 'new_tab',
          menu_icon: 'AppstoreOutlined',
          is_active: true,
          sort_order: 0
        }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label={t('admin.modules.form.name')}
              rules={[
                { required: true, message: '请输入模块标识' },
                { pattern: /^[a-z][a-z0-9-]*$/, message: '只能包含小写字母、数字和横线，且以字母开头' }
              ]}
            >
              <Input 
                placeholder="如: project-management" 
                disabled={!!editingModule} 
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="display_name"
              label={t('admin.modules.form.displayName')}
              rules={[{ required: true, message: '请输入显示名称' }]}
            >
              <Input placeholder="如: 项目管理系统" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item 
          name="module_url" 
          label="模块URL"
          rules={[
            { required: true, message: '请输入模块URL' },
            { type: 'url', message: '请输入有效的URL' }
          ]}
        >
          <Input placeholder="https://example.com/app" />
        </Form.Item>

        <Form.Item name="description" label={t('admin.modules.form.description')}>
          <TextArea rows={2} placeholder="描述模块的功能和用途" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item 
              name="open_mode" 
              label="打开方式"
              rules={[{ required: true }]}
            >
              <Select>
                <Select.Option value="new_tab">新标签页</Select.Option>
                <Select.Option value="iframe">内嵌显示</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="menu_icon"
              label="菜单图标"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                placeholder="选择图标"
              >
                {commonIcons.map(iconName => {
                  const IconComponent = Icons[iconName]
                  return (
                    <Select.Option key={iconName} value={iconName}>
                      <Space>
                        {IconComponent && <IconComponent />}
                        <span>{iconName}</span>
                      </Space>
                    </Select.Option>
                  )
                })}
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="sort_order"
              label="排序顺序"
              tooltip="数值越小越靠前"
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={18}>
            <Form.Item 
              name="allowed_groups" 
              label="允许访问的用户组"
              tooltip="不选择则所有用户都可访问"
            >
              <Select
                mode="multiple"
                placeholder="选择允许访问的用户组"
                allowClear
              >
                {userGroups.map(group => (
                  <Select.Option key={group.id} value={group.id}>
                    {group.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item 
              name="is_active" 
              label={t('admin.modules.form.isActive')}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
          <Space>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingModule ? t('button.update') : t('button.create')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SystemModuleFormModal
