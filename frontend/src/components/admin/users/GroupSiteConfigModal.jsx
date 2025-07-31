/**
 * 组站点配置弹窗组件
 */
import React, { useState, useEffect } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Upload, 
  Button, 
  Space, 
  message,
  Image,
  Alert
} from 'antd'
import { 
  UploadOutlined, 
  DeleteOutlined,
  GlobalOutlined,
  PictureOutlined
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
  const [previewUrl, setPreviewUrl] = useState('')

  // 初始化logo和预览URL
  useEffect(() => {
    if (group) {
      const initialLogo = group.site_logo || ''
      setLogoUrl(initialLogo)
      setPreviewUrl(initialLogo)
      form.setFieldsValue({
        site_name: group.site_name || '',
        site_logo: initialLogo
      })
    }
  }, [group, form])

  // 处理Logo上传
  const handleLogoUpload = async (info) => {
    const file = info.file
    
    // 验证文件类型
    const isImage = file.type.startsWith('image/')
    if (!isImage) {
      message.error('只能上传图片文件')
      return false
    }
    
    // 验证文件大小（2MB）
    const isLt2M = file.size / 1024 / 1024 < 2
    if (!isLt2M) {
      message.error('图片大小不能超过2MB')
      return false
    }
    
    // 预览
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreviewUrl(e.target.result)
    }
    reader.readAsDataURL(file)
    
    // 上传文件
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('logo', file)
      
      const response = await apiClient.post(
        `/admin/user-groups/${group.id}/upload-logo`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      )
      
      if (response.data.success) {
        const url = response.data.data.logo_url
        setLogoUrl(url)
        setPreviewUrl(url)
        form.setFieldsValue({ site_logo: url })
        message.success('Logo上传成功')
      } else {
        message.error(response.data.message || 'Logo上传失败')
        setPreviewUrl(logoUrl) // 恢复原图
      }
    } catch (error) {
      console.error('Logo上传失败:', error)
      message.error('Logo上传失败')
      setPreviewUrl(logoUrl) // 恢复原图
    } finally {
      setUploading(false)
    }
    
    return false // 阻止默认上传行为
  }

  // 删除Logo
  const handleRemoveLogo = () => {
    setLogoUrl('')
    setPreviewUrl('')
    form.setFieldsValue({ site_logo: '' })
  }

  // 提交表单
  const handleSubmit = async (values) => {
    await onSubmit({
      ...values,
      site_logo: logoUrl
    })
  }

  // 关闭弹窗时重置状态
  const handleCancel = () => {
    setLogoUrl('')
    setPreviewUrl('')
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
          site_name: group?.site_name || '',
          site_logo: group?.site_logo || ''
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
          extra="建议尺寸：高度32px，支持PNG、JPG格式，文件大小不超过2MB"
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Upload
              showUploadList={false}
              beforeUpload={handleLogoUpload}
              accept="image/*"
            >
              <Button 
                icon={<UploadOutlined />} 
                loading={uploading}
              >
                上传Logo
              </Button>
            </Upload>
            
            {previewUrl && (
              <div style={{ 
                padding: 16, 
                border: '1px solid #d9d9d9', 
                borderRadius: 8,
                background: '#fafafa'
              }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <Image
                      src={previewUrl}
                      alt="Logo预览"
                      height={32}
                      style={{ objectFit: 'contain' }}
                      preview={{
                        mask: '点击预览'
                      }}
                    />
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={handleRemoveLogo}
                    >
                      删除Logo
                    </Button>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    预览效果：Logo将显示在页面顶部导航栏
                  </div>
                </Space>
              </div>
            )}
          </Space>
        </Form.Item>
        
        <Form.Item name="site_logo" hidden>
          <Input />
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
