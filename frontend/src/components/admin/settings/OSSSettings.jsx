/**
 * OSS配置管理组件 - 包含简化的存储积分配置
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
  InputNumber,
  Tabs,
  Typography
} from 'antd'
import {
  SaveOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DollarOutlined,
  CloudUploadOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import apiClient from '../../../utils/api'

const { Option } = Select
const { TabPane } = Tabs
const { Title, Text, Paragraph } = Typography

const OSSSettings = () => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [creditForm] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingCredit, setSavingCredit] = useState(false)

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

  // 获取简化的积分配置
  const getCreditConfig = async () => {
    try {
      const response = await apiClient.get('/admin/storage-credit/config')
      if (response.data.success) {
        creditForm.setFieldsValue(response.data.data)
      }
    } catch (error) {
      // 如果新API不存在，设置默认值
      creditForm.setFieldsValue({
        base_credits: 2,
        credits_per_5mb: 1,
        max_file_size: 100
      })
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

  // 保存简化的积分配置
  const handleSaveCredit = async (values) => {
    try {
      setSavingCredit(true)
      const response = await apiClient.put('/admin/storage-credit/config', values)
      if (response.data.success) {
        message.success('积分配置保存成功')
      }
    } catch (error) {
      message.error('保存失败: ' + (error.response?.data?.message || '未知错误'))
    } finally {
      setSavingCredit(false)
    }
  }

  // 计算示例（修正后的算法）
  const calculateExample = (values) => {
    const examples = [
      { size: 1, label: '1MB文件' },
      { size: 5, label: '5MB文件' },
      { size: 6, label: '6MB文件' },
      { size: 10, label: '10MB文件' },
      { size: 11, label: '11MB文件' },
      { size: 20, label: '20MB文件' },
      { size: 50, label: '50MB文件' },
      { size: 100, label: '100MB文件' }
    ]
    
    return examples.map(ex => {
      let credits = 0;
      
      if (ex.size <= 5) {
        // 5MB及以下，只收基础积分
        credits = values?.base_credits || 2;
      } else {
        // 超过5MB，按区间收费
        const extraIntervals = Math.ceil((ex.size - 5) / 5);
        credits = extraIntervals * (values?.credits_per_5mb || 1);
      }
      
      return { ...ex, credits };
    })
  }

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
            title={
              <Space>
                <CloudUploadOutlined style={{ color: '#1890ff' }} />
                <span>存储积分配置（简化版）</span>
              </Space>
            }
          >
            <Alert
              message="积分计费规则"
              description={
                <div>
                  <p>• 文件大小 ≤ 5MB：收取基础积分</p>
                  <p>• 文件大小 > 5MB：按每5MB区间收取积分，计算公式：向上取整((文件大小-5)/5) × 每5MB积分</p>
                  <p>• 举例：基础积分1，每5MB积分5，则6MB文件收5积分，11MB文件收10积分</p>
                </div>
              }
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
            
            <Form
              form={creditForm}
              layout="vertical"
              onFinish={handleSaveCredit}
              onValuesChange={(_, values) => {
                creditForm.setFieldsValue(values)
              }}
            >
              <Form.Item
                label="基础积分"
                name="base_credits"
                tooltip="5MB及以下文件的积分收费"
                rules={[{ required: true, message: '请输入基础积分' }]}
              >
                <InputNumber
                  min={0}
                  max={100}
                  style={{ width: 200 }}
                  addonAfter="积分"
                  placeholder="例如: 1"
                />
              </Form.Item>
              
              <Form.Item
                label="每5MB积分"
                name="credits_per_5mb"
                tooltip="超过5MB后，每个5MB区间的积分收费"
                rules={[{ required: true, message: '请输入每5MB积分' }]}
              >
                <InputNumber
                  min={0}
                  max={100}
                  precision={2}
                  style={{ width: 200 }}
                  addonAfter="积分/5MB"
                  placeholder="例如: 5"
                />
              </Form.Item>
              
              <Form.Item
                label="最大文件限制"
                name="max_file_size"
                tooltip="单个文件的最大大小限制"
                rules={[{ required: true, message: '请输入最大文件大小' }]}
              >
                <InputNumber
                  min={1}
                  max={1000}
                  style={{ width: 200 }}
                  addonAfter="MB"
                  placeholder="例如: 100"
                />
              </Form.Item>
              
              <Divider />
              
              {/* 积分计算示例 */}
              <div style={{ marginBottom: 24 }}>
                <Title level={5}>
                  <DollarOutlined /> 积分计算示例
                </Title>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {calculateExample(creditForm.getFieldsValue()).map(ex => (
                    <div key={ex.size} style={{ 
                      padding: '8px 12px', 
                      background: '#f5f5f5', 
                      borderRadius: 4,
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}>
                      <Text>{ex.label}</Text>
                      <Text strong style={{ color: '#1890ff' }}>{ex.credits} 积分</Text>
                    </div>
                  ))}
                </Space>
              </div>
              
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={savingCredit}
                  size="large"
                >
                  保存配置
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default OSSSettings
