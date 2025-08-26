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
  Divider,
  Alert,
  Table,
  InputNumber,
  Modal,
  Tabs
} from 'antd'
import {
  SaveOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DollarOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import apiClient from '../../../utils/api'

const { Option } = Select
const { TabPane } = Tabs

const OSSSettings = () => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [creditForm] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [creditConfigs, setCreditConfigs] = useState([])
  const [editingCredit, setEditingCredit] = useState(null)

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

  // 获取积分配置
  const getCreditConfig = async () => {
    try {
      const response = await apiClient.get('/admin/oss/credit-config')
      if (response.data.success) {
        setCreditConfigs(response.data.data || [])
      }
    } catch (error) {
      message.error('获取积分配置失败')
    }
  }

  useEffect(() => {
    getOSSConfig()
    getCreditConfig()
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

  // 保存积分配置
  const handleSaveCredit = async () => {
    try {
      const values = await creditForm.validateFields()
      const newConfig = {
        ...editingCredit,
        ...values
      }

      let updatedConfigs
      if (editingCredit?.id) {
        updatedConfigs = creditConfigs.map(c => 
          c.id === editingCredit.id ? newConfig : c
        )
      } else {
        newConfig.id = Date.now()
        updatedConfigs = [...creditConfigs, newConfig]
      }

      const response = await apiClient.put('/admin/oss/credit-config', {
        configs: updatedConfigs
      })

      if (response.data.success) {
        message.success('积分配置保存成功')
        setCreditConfigs(updatedConfigs)
        setEditingCredit(null)
        creditForm.resetFields()
      }
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 删除积分配置
  const handleDeleteCredit = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该积分配置吗？',
      onOk: async () => {
        const updatedConfigs = creditConfigs.filter(c => c.id !== record.id)
        try {
          const response = await apiClient.put('/admin/oss/credit-config', {
            configs: updatedConfigs
          })
          if (response.data.success) {
            message.success('删除成功')
            setCreditConfigs(updatedConfigs)
          }
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 积分配置表格列
  const creditColumns = [
    {
      title: '文件类型',
      dataIndex: 'file_type',
      key: 'file_type',
      render: (type) => {
        const typeMap = {
          'image': '图片',
          'video': '视频',
          'document': '文档',
          'default': '其他'
        }
        return typeMap[type] || type
      }
    },
    {
      title: '操作类型',
      dataIndex: 'action_type',
      key: 'action_type',
      render: (type) => {
        const typeMap = {
          'upload': '上传',
          'download': '下载'
        }
        return typeMap[type] || type
      }
    },
    {
      title: '每MB积分',
      dataIndex: 'credits_per_mb',
      key: 'credits_per_mb'
    },
    {
      title: '最小积分',
      dataIndex: 'min_credits',
      key: 'min_credits'
    },
    {
      title: '最大积分',
      dataIndex: 'max_credits',
      key: 'max_credits'
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active) => active ? '启用' : '禁用'
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button 
            type="link" 
            onClick={() => {
              setEditingCredit(record)
              creditForm.setFieldsValue(record)
            }}
          >
            编辑
          </Button>
          <Button 
            type="link" 
            danger 
            onClick={() => handleDeleteCredit(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="oss-settings">
      <Tabs defaultActiveKey="oss">
        <TabPane tab={<><CloudServerOutlined /> OSS配置</>} key="oss">
          <Card title="阿里云OSS配置" loading={loading}>
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
        </TabPane>

        <TabPane tab={<><DollarOutlined /> 积分配置</>} key="credit">
          <Card 
            title="存储积分配置"
            extra={
              <Button 
                type="primary"
                onClick={() => {
                  setEditingCredit({})
                  creditForm.resetFields()
                }}
              >
                添加配置
              </Button>
            }
          >
            <Table
              columns={creditColumns}
              dataSource={creditConfigs}
              rowKey="id"
              pagination={false}
            />

            <Modal
              title={editingCredit?.id ? '编辑积分配置' : '添加积分配置'}
              open={!!editingCredit}
              onOk={handleSaveCredit}
              onCancel={() => {
                setEditingCredit(null)
                creditForm.resetFields()
              }}
            >
              <Form form={creditForm} layout="vertical">
                <Form.Item
                  label="文件类型"
                  name="file_type"
                  rules={[{ required: true }]}
                >
                  <Select>
                    <Option value="image">图片</Option>
                    <Option value="video">视频</Option>
                    <Option value="document">文档</Option>
                    <Option value="default">其他</Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  label="操作类型"
                  name="action_type"
                  rules={[{ required: true }]}
                >
                  <Select>
                    <Option value="upload">上传</Option>
                    <Option value="download">下载</Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  label="每MB消耗积分"
                  name="credits_per_mb"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>

                <Form.Item
                  label="最小积分"
                  name="min_credits"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>

                <Form.Item
                  label="最大积分"
                  name="max_credits"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>

                <Form.Item
                  label="启用状态"
                  name="is_active"
                  valuePropName="checked"
                >
                  <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                </Form.Item>
              </Form>
            </Modal>
          </Card>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default OSSSettings
