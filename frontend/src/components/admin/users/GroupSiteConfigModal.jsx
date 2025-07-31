/**
 * 组站点配置弹窗组件
 */
import React, { useEffect } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Button, 
  Space, 
  Alert
} from 'antd'
import { 
  GlobalOutlined
} from '@ant-design/icons'

const GroupSiteConfigModal = ({
  visible,
  group,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()

  // 初始化表单
  useEffect(() => {
    if (group && visible) {
      form.setFieldsValue({
        site_name: group.site_name || ''
      })
    }
  }, [group, visible, form])

  // 提交表单
  const handleSubmit = async (values) => {
    const submitData = {
      site_name: values.site_name || '',
      site_logo: ''  // 始终传空值
    }
    
    console.log('提交站点配置:', submitData)
    await onSubmit(submitData)
  }

  // 关闭弹窗时重置状态
  const handleCancel = () => {
    form.resetFields()
    onCancel()
  }

  return (
    <Modal
      title={
        <Space>
          <GlobalOutlined />
          配置组站点信息
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      footer={null}
      destroyOnClose
      width={600}
    >
      <Alert
        message="提示"
        description={
          <div>
            <p>配置本组专属的站点名称，组内用户登录后将看到自定义的站点信息。</p>
            <p>留空则使用系统默认配置。</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          site_name: group?.site_name || ''
        }}
      >
        <Form.Item
          name="site_name"
          label="站点名称"
          extra="设置本组的站点名称，留空则使用系统默认名称"
        >
          <Input 
            placeholder="例如：XX企业AI平台" 
            prefix={<GlobalOutlined />}
          />
        </Form.Item>
        
        <Form.Item>
          <Space>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
            >
              保存配置
            </Button>
            <Button onClick={handleCancel}>
              取消
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default GroupSiteConfigModal
