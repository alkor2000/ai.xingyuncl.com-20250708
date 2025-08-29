/**
 * OSS配置管理组件
 */

import React, { useState, useEffect } from 'react'
import {
  Card,
  Form,
  Input,
  Button,
  Switch,
  Select,
  Space,
  message,
  Alert
} from 'antd'
import {
  SaveOutlined,
  ApiOutlined,
  CloudServerOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import apiClient from '../../../utils/api'

const { Option } = Select

const OSSSettings = () => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)

  // 获取OSS配置
  const getOSSConfig = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/admin/oss/config')
      if (response.data.success) {
        form.setFieldsValue(response.data.data)
      }
    } catch (error) {
      message.error('获取OSS配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getOSSConfig()
  }, [])

  // 保存OSS配置
  const handleSaveOSS = async (values) => {
    try {
      setLoading(true)
      const response = await apiClient.post('/admin/oss/config', values)
      if (response.data.success) {
        message.success('OSS配置保存成功')
      }
    } catch (error) {
      message.error('保存失败: ' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  // 测试OSS连接
  const handleTestConnection = async () => {
    try {
      setTesting(true)
      const values = await form.validateFields()
      const response = await apiClient.post('/admin/oss/test', values)
      if (response.data.success) {
        message.success('OSS连接测试成功')
      }
    } catch (error) {
      message.error('连接失败: ' + (error.response?.data?.message || '未知错误'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card 
      title={
        <Space>
          <CloudServerOutlined />
          <span>阿里云OSS配置</span>
        </Space>
      }
      loading={loading}
    >
      <Alert
        message="配置说明"
        description="请在阿里云OSS控制台创建Bucket，并获取AccessKey ID和AccessKey Secret。建议创建专门的RAM子账号并授予OSS权限。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSaveOSS}
      >
        <Form.Item
          label="启用OSS"
          name="enabled"
          valuePropName="checked"
        >
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>

        <Form.Item
          label="OSS Provider"
          name="provider"
          rules={[{ required: true, message: '请选择OSS提供商' }]}
          initialValue="aliyun"
        >
          <Select>
            <Option value="aliyun">阿里云OSS</Option>
            <Option value="local">本地存储</Option>
          </Select>
        </Form.Item>

        <Form.Item
          label="Region"
          name="region"
          rules={[{ required: true, message: '请输入Region' }]}
        >
          <Input placeholder="例如: oss-cn-hangzhou" />
        </Form.Item>

        <Form.Item
          label="Bucket"
          name="bucket"
          rules={[{ required: true, message: '请输入Bucket名称' }]}
        >
          <Input placeholder="您的Bucket名称" />
        </Form.Item>

        <Form.Item
          label="Access Key ID"
          name="accessKeyId"
          rules={[{ required: true, message: '请输入Access Key ID' }]}
        >
          <Input.Password placeholder="Access Key ID" />
        </Form.Item>

        <Form.Item
          label="Access Key Secret"
          name="accessKeySecret"
          rules={[{ required: true, message: '请输入Access Key Secret' }]}
        >
          <Input.Password placeholder="Access Key Secret" />
        </Form.Item>

        <Form.Item
          label="自定义域名（可选）"
          name="customDomain"
        >
          <Input placeholder="例如: https://cdn.example.com" />
        </Form.Item>

        <Form.Item
          label="上传路径前缀"
          name="pathPrefix"
          initialValue="uploads"
        >
          <Input placeholder="例如: uploads" />
        </Form.Item>

        <Space>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            icon={<SaveOutlined />}
          >
            保存配置
          </Button>
          <Button 
            onClick={handleTestConnection}
            loading={testing}
            icon={<ApiOutlined />}
          >
            测试连接
          </Button>
        </Space>
      </Form>
    </Card>
  )
}

export default OSSSettings
