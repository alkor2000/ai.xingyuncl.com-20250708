/**
 * 用户分组表单弹窗组件
 */

import React from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Select, 
  InputNumber, 
  Row, 
  Col, 
  Space, 
  Button,
  Tag
} from 'antd'
import { useTranslation } from 'react-i18next'

const UserGroupFormModal = ({
  visible,
  editingGroup,
  form,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()

  const colorOptions = [
    { value: '#1677ff', label: '蓝色', name: 'blue' },
    { value: '#52c41a', label: '绿色', name: 'green' },
    { value: '#fa8c16', label: '橙色', name: 'orange' },
    { value: '#ff4d4f', label: '红色', name: 'red' },
    { value: '#722ed1', label: '紫色', name: 'purple' },
    { value: '#13c2c2', label: '青色', name: 'cyan' }
  ]

  return (
    <Modal
      title={editingGroup ? t('admin.groups.editGroup') : t('admin.groups.createGroup')}
      open={visible}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Form.Item
          name="name"
          label={t('admin.groups.form.name')}
          rules={[{ required: true, message: t('admin.groups.form.name.required') }]}
        >
          <Input placeholder={t('admin.groups.form.name.placeholder')} />
        </Form.Item>

        <Form.Item
          name="description"
          label={t('admin.groups.form.description')}
        >
          <Input.TextArea 
            rows={3} 
            placeholder={t('admin.groups.form.description.placeholder')} 
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="color"
              label={t('admin.groups.form.color')}
              initialValue="#1677ff"
            >
              <Select>
                {colorOptions.map(color => (
                  <Select.Option key={color.value} value={color.value}>
                    <Tag color={color.value}>{color.label}</Tag>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="sort_order"
              label={t('admin.groups.form.sort')}
              initialValue={0}
            >
              <InputNumber 
                min={0} 
                style={{ width: '100%' }} 
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="is_active"
          label={t('admin.groups.form.status')}
          initialValue={true}
          valuePropName="checked"
        >
          <Select>
            <Select.Option value={true}>
              {t('admin.groups.form.enable')}
            </Select.Option>
            <Select.Option value={false}>
              {t('admin.groups.form.disable')}
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
            >
              {editingGroup ? t('button.update') : t('button.create')}
            </Button>
            <Button onClick={onCancel}>
              {t('button.cancel')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default UserGroupFormModal
