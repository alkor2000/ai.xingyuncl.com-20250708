/**
 * API服务表单模态框组件
 */

import React, { useEffect } from 'react'
import { Modal, Form, Input, Select, message } from 'antd'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Option } = Select

const APIServiceFormModal = ({
  visible,
  editingService,
  onCancel,
  onSuccess,
  adminStore
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = React.useState(false)

  // 初始化表单
  useEffect(() => {
    if (visible) {
      if (editingService) {
        form.setFieldsValue({
          service_name: editingService.service_name,
          description: editingService.description,
          status: editingService.status
        })
      } else {
        form.resetFields()
      }
    }
  }, [visible, editingService, form])

  // 处理提交
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      if (editingService) {
        // 更新服务
        await adminStore.updateApiService(editingService.service_id, values)
        message.success('API服务更新成功')
      } else {
        // 创建服务
        await adminStore.createApiService(values)
        message.success('API服务创建成功')
      }

      onSuccess && onSuccess()
    } catch (error) {
      if (error.errorFields) {
        return
      }
      message.error(error.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={editingService ? '编辑API服务' : '添加API服务'}
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={600}
      okText="确定"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          status: 'active'
        }}
      >
        {!editingService && (
          <Form.Item
            name="service_id"
            label="服务ID"
            rules={[
              { required: true, message: '请输入服务ID' },
              { 
                pattern: /^[a-z0-9_]+$/, 
                message: '服务ID只能包含小写字母、数字和下划线' 
              },
              {
                min: 3,
                max: 50,
                message: '服务ID长度应在3-50个字符之间'
              }
            ]}
            extra="服务的唯一标识，创建后不可修改，建议使用简短易记的英文标识"
          >
            <Input placeholder="如：image_gen、workflow、agent" />
          </Form.Item>
        )}

        <Form.Item
          name="service_name"
          label="服务名称"
          rules={[
            { required: true, message: '请输入服务名称' },
            { max: 100, message: '服务名称不能超过100个字符' }
          ]}
        >
          <Input placeholder="如：图像生成服务、工作流服务" />
        </Form.Item>

        <Form.Item
          name="description"
          label="服务描述"
          rules={[
            { max: 500, message: '描述不能超过500个字符' }
          ]}
        >
          <TextArea 
            rows={3} 
            placeholder="简要描述服务的功能和用途"
            showCount
            maxLength={500}
          />
        </Form.Item>

        {editingService && (
          <Form.Item
            name="status"
            label="服务状态"
          >
            <Select>
              <Option value="active">启用</Option>
              <Option value="inactive">禁用</Option>
            </Select>
          </Form.Item>
        )}
      </Form>

      {!editingService && (
        <div style={{ 
          marginTop: 16, 
          padding: 12, 
          backgroundColor: '#f0f2f5', 
          borderRadius: 4,
          fontSize: 13,
          color: '#666'
        }}>
          <div style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>
            提示：
          </div>
          <div>• 服务创建后将自动生成API密钥</div>
          <div>• 服务ID一旦创建不可修改，请谨慎填写</div>
          <div>• 创建后需要配置具体的操作类型和积分消耗</div>
        </div>
      )}
    </Modal>
  )
}

export default APIServiceFormModal
