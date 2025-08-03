/**
 * 系统提示词表单模态框组件
 */

import React, { useEffect, useState } from 'react'
import { Modal, Form, Input, InputNumber, Switch, Select, Space, Alert } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'

const { TextArea } = Input
const { Option } = Select

const SystemPromptFormModal = ({ visible, prompt, onCancel, onSuccess }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { createSystemPrompt, updateSystemPrompt, userGroups, fetchUserGroups } = useAdminStore()

  // 加载用户组列表
  useEffect(() => {
    if (visible) {
      fetchUserGroups()
    }
  }, [visible, fetchUserGroups])

  // 初始化表单值
  useEffect(() => {
    if (visible) {
      if (prompt) {
        // 编辑模式
        form.setFieldsValue({
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          group_ids: prompt.group_ids || [],
          sort_order: prompt.sort_order || 0,
          is_active: prompt.is_active !== false
        })
      } else {
        // 新建模式
        form.resetFields()
        form.setFieldsValue({
          sort_order: 0,
          is_active: true,
          group_ids: []
        })
      }
    }
  }, [visible, prompt, form])

  // 处理提交
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      let result
      if (prompt) {
        // 更新
        result = await updateSystemPrompt(prompt.id, values)
      } else {
        // 创建
        result = await createSystemPrompt(values)
      }

      if (result.success) {
        onSuccess()
        form.resetFields()
      }
    } catch (error) {
      console.error('保存失败:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={prompt ? '编辑系统提示词' : '新增系统提示词'}
      open={visible}
      onOk={handleSubmit}
      onCancel={onCancel}
      width={900}
      confirmLoading={loading}
      okText={prompt ? '更新' : '创建'}
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '请输入提示词名称' },
            { max: 50, message: '名称不能超过50个字符' }
          ]}
        >
          <Input placeholder="例如：技术助手、创意写作等" />
        </Form.Item>

        <Form.Item
          name="description"
          label="描述"
          rules={[
            { max: 200, message: '描述不能超过200个字符' }
          ]}
        >
          <TextArea 
            rows={2} 
            placeholder="简要描述该提示词的用途和特点"
          />
        </Form.Item>

        <Form.Item
          name="content"
          label={
            <Space>
              提示词内容
              <InfoCircleOutlined 
                style={{ color: '#999' }} 
                title="这将作为系统提示词发送给AI，定义AI的角色和行为"
              />
            </Space>
          }
          rules={[
            { required: true, message: '请输入提示词内容' },
            { max: 100000, message: '提示词内容不能超过100000个字符' }
          ]}
        >
          <TextArea 
            rows={12} 
            placeholder={`例如：你是一个专业的技术助手，擅长解答编程相关问题。请用简洁清晰的语言回答用户的问题，必要时提供代码示例。\n\n支持输入详细的角色设定、行为规范、回答示例、知识库等内容。最多支持10万个字符，足够编写非常详细的提示词。`}
            showCount
            maxLength={100000}
            style={{ fontSize: '13px' }}
          />
        </Form.Item>

        <Form.Item
          name="group_ids"
          label={
            <Space>
              可见用户组
              <InfoCircleOutlined 
                style={{ color: '#999' }} 
                title="选择哪些用户组可以使用该提示词，留空表示所有用户可用"
              />
            </Space>
          }
        >
          <Select
            mode="multiple"
            placeholder="留空表示所有用户可用"
            allowClear
          >
            {userGroups.map(group => (
              <Option key={group.id} value={group.id}>
                {group.name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <div style={{ display: 'flex', gap: '16px' }}>
          <Form.Item
            name="sort_order"
            label="排序顺序"
            style={{ flex: 1 }}
          >
            <InputNumber 
              min={0} 
              max={9999}
              style={{ width: '100%' }}
              placeholder="数字越小越靠前"
            />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="是否启用"
            valuePropName="checked"
            style={{ flex: 1 }}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </div>
      </Form>

      <Alert
        message="使用提示"
        description={
          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
            <li>系统提示词会在每次对话开始时发送给AI，用于定义AI的角色和行为</li>
            <li>用户选择提示词后无法看到具体内容，只能看到名称和描述</li>
            <li>已经创建的对话不受提示词更新的影响</li>
            <li>建议为不同场景创建专门的提示词，提高AI回复的专业性</li>
            <li>现在支持最多<strong>10万个字符</strong>，可以包含详细的角色设定、行为规范、知识库等内容</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />
    </Modal>
  )
}

export default SystemPromptFormModal
