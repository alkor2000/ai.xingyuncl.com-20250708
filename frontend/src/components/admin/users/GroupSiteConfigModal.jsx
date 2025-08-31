/**
 * 组站点配置弹窗组件
 */
import React, { useEffect, useState } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Button, 
  Space, 
  Alert,
  Upload,
  message
} from 'antd'
import { 
  GlobalOutlined,
  UploadOutlined,
  LoadingOutlined,
  PlusOutlined
} from '@ant-design/icons'
import apiClient from '../../../utils/api'

const GroupSiteConfigModal = ({
  visible,
  group,
  loading = false,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm()
  const [uploading, setUploading] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState('')

  // 初始化表单
  useEffect(() => {
    if (group && visible) {
      form.setFieldsValue({
        site_name: group.site_name || ''
      })
      // 设置已有的logo
      setLogoUrl(group.site_logo || '')
      setUploadedLogoUrl('')
    }
  }, [group, visible, form])

  // 处理logo上传
  const handleLogoUpload = async (info) => {
    const { file } = info
    
    if (file.status === 'uploading') {
      setUploading(true)
      return
    }
    
    if (file.status === 'done') {
      setUploading(false)
      if (file.response && file.response.success) {
        const logoUrl = file.response.data.logo_url
        setUploadedLogoUrl(logoUrl)
        message.success('Logo上传成功')
      } else {
        message.error(file.response?.message || 'Logo上传失败')
      }
    } else if (file.status === 'error') {
      setUploading(false)
      message.error('Logo上传失败')
    }
  }

  // 自定义上传请求
  const customUploadRequest = async ({ file, onSuccess, onError }) => {
    const formData = new FormData()
    formData.append('logo', file)
    
    try {
      const response = await apiClient.post(
        `/admin/user-groups/${group.id}/upload-logo`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      )
      
      onSuccess(response.data, file)
    } catch (error) {
      console.error('Logo上传失败:', error)
      onError(error)
    }
  }

  // 上传前验证
  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      message.error('只能上传图片文件！')
      return false
    }
    
    const isLt2M = file.size / 1024 / 1024 < 2
    if (!isLt2M) {
      message.error('图片大小不能超过2MB！')
      return false
    }
    
    return true
  }

  // 提交表单
  const handleSubmit = async (values) => {
    const submitData = {
      site_name: values.site_name || '',
      // 优先使用新上传的logo，否则使用原有logo
      site_logo: uploadedLogoUrl || logoUrl || ''
    }
    
    console.log('提交站点配置:', submitData)
    await onSubmit(submitData)
  }

  // 关闭弹窗时重置状态
  const handleCancel = () => {
    form.resetFields()
    setLogoUrl('')
    setUploadedLogoUrl('')
    setUploading(false)
    onCancel()
  }

  // 移除logo
  const handleRemoveLogo = () => {
    setUploadedLogoUrl('')
    setLogoUrl('')
  }

  // 上传按钮
  const uploadButton = (
    <div>
      {uploading ? <LoadingOutlined /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>
        {uploading ? '上传中...' : '点击上传'}
      </div>
    </div>
  )

  // 获取当前显示的logo
  const currentLogo = uploadedLogoUrl || logoUrl

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
            <p>配置本组专属的站点名称和Logo，组内用户登录后将看到自定义的站点信息。</p>
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
        
        <Form.Item
          label="站点Logo"
          extra="上传本组的Logo图片，支持JPG、PNG、GIF格式，最大2MB"
        >
          <Upload
            name="logo"
            listType="picture-card"
            className="logo-uploader"
            showUploadList={false}
            customRequest={customUploadRequest}
            beforeUpload={beforeUpload}
            onChange={handleLogoUpload}
          >
            {currentLogo ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={currentLogo}
                  alt="logo"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                  }}
                />
                <Button
                  type="link"
                  danger
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveLogo()
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    background: 'rgba(255, 255, 255, 0.8)'
                  }}
                >
                  移除
                </Button>
              </div>
            ) : (
              uploadButton
            )}
          </Upload>
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
