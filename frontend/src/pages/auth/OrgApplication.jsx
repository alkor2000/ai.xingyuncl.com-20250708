/**
 * 申请页面 - 支持文件上传到OSS
 */

import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Upload, message, Typography, Space, Spin, Alert, Select } from 'antd';
import { 
  BankOutlined, 
  MailOutlined, 
  UploadOutlined,
  ArrowLeftOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  InboxOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

const OrgApplication = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [formConfig, setFormConfig] = useState(null);
  const [fileList, setFileList] = useState([]);
  const [businessLicenseUrl, setBusinessLicenseUrl] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  // 获取表单配置
  useEffect(() => {
    const fetchFormConfig = async () => {
      try {
        const response = await api.get('/public/org-application/form-config');
        if (response.data?.success) {
          setFormConfig(response.data.data);
        }
      } catch (error) {
        console.error('获取表单配置失败:', error);
        message.error('获取表单配置失败');
      } finally {
        setConfigLoading(false);
      }
    };
    fetchFormConfig();
  }, []);

  // 自定义文件上传处理
  const customUploadRequest = async ({ file, onSuccess, onError, onProgress }) => {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      // 显示上传进度
      onProgress({ percent: 0 });
      
      const response = await api.post('/public/org-application/upload-license', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress({ percent: percentCompleted });
        }
      });
      
      if (response.data.success) {
        const { url, fileName } = response.data.data;
        setBusinessLicenseUrl(url);
        onSuccess(response.data.data, file);
        message.success(`${fileName} 上传成功`);
      } else {
        throw new Error(response.data.message || '上传失败');
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      onError(error);
      message.error(error.response?.data?.message || '文件上传失败');
    }
  };

  // 处理文件变化
  const handleFileChange = ({ fileList: newFileList }) => {
    if (!submitted) {
      // 只保留最新的一个文件
      setFileList(newFileList.slice(-1));
      
      // 如果文件被删除，清空URL
      if (newFileList.length === 0) {
        setBusinessLicenseUrl(null);
      }
    }
  };

  // 文件上传前的验证
  const beforeUpload = (file) => {
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('文件大小不能超过10MB');
      return false;
    }
    
    const isAllowedType = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf'
    ].includes(file.type);
    
    if (!isAllowedType) {
      message.error('只支持上传图片或PDF文件');
      return false;
    }
    
    return true;
  };

  // 处理表单提交
  const handleSubmit = async (values) => {
    try {
      setLoading(true);
      
      // 构建提交数据
      const submitData = {
        ...values,
        business_license: businessLicenseUrl // 使用上传后的URL
      };
      
      const response = await api.post('/public/org-application/submit', submitData);
      
      if (response.data.success) {
        // 设置提交成功状态，锁定表单
        setSubmitted(true);
        message.success('提交成功！');
      }
    } catch (error) {
      console.error('提交申请失败:', error);
      const errorMsg = error.response?.data?.message || '提交申请失败，请稍后重试';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (configLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <Spin size="large" />
      </div>
    );
  }

  // 如果配置不可见，跳转到登录页
  if (!formConfig?.button_visible) {
    navigate('/login');
    return null;
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* 返回登录按钮 */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/login')}
        style={{ 
          position: 'absolute', 
          top: 20, 
          left: 20,
          zIndex: 10
        }}
      >
        返回登录
      </Button>

      <Card
        style={{
          width: '100%',
          maxWidth: '600px',
          borderRadius: '8px'
        }}
      >
        {/* 提交成功提示 */}
        {submitted && (
          <Alert
            message="提交成功"
            description="您已经提交完成"
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            style={{ marginBottom: '20px' }}
            action={
              <Button 
                type="primary" 
                size="small"
                onClick={() => navigate('/login')}
              >
                返回登录
              </Button>
            }
          />
        )}

        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <BankOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '16px' }} />
          <Title level={2}>申请</Title>
          <Paragraph type="secondary">
            请填写以下信息，我们会尽快审核您的申请
          </Paragraph>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          disabled={submitted}
        >
          {/* 组织名称 */}
          <Form.Item
            label="企业/组织/学校名称"
            name="org_name"
            rules={[{ required: true, message: '请输入组织名称' }]}
          >
            <Input 
              prefix={<BankOutlined />} 
              placeholder="请输入您的企业、组织或学校名称"
              size="large"
            />
          </Form.Item>

          {/* 申请人邮箱 */}
          <Form.Item
            label="申请人邮箱"
            name="applicant_email"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder="请输入您的邮箱"
              size="large"
            />
          </Form.Item>

          {/* 营业执照上传 - 改进的上传组件 */}
          <Form.Item
            label="营业执照（选填）"
            name="business_license_upload"
          >
            <Dragger
              fileList={fileList}
              onChange={handleFileChange}
              customRequest={customUploadRequest}
              beforeUpload={beforeUpload}
              maxCount={1}
              accept="image/*,.pdf"
              disabled={submitted}
              style={{
                background: submitted ? '#f5f5f5' : '#fafafa'
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">
                点击或拖拽文件到此处上传
              </p>
              <p className="ant-upload-hint">
                支持 JPG、PNG、PDF 格式，文件大小不超过 10MB
              </p>
            </Dragger>
          </Form.Item>

          {/* 动态字段 */}
          {formConfig?.fields?.map((field) => (
            <Form.Item
              key={field.name}
              label={field.label}
              name={field.name}
              rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : []}
            >
              {field.type === 'textarea' ? (
                <TextArea 
                  placeholder={`请输入${field.label}`}
                  rows={4}
                />
              ) : field.type === 'select' && field.options ? (
                <Select placeholder={`请选择${field.label}`} size="large">
                  {field.options.map(opt => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              ) : (
                <Input 
                  placeholder={`请输入${field.label}`}
                  size="large"
                />
              )}
            </Form.Item>
          ))}

          {/* 邀请码 */}
          <Form.Item
            label={formConfig?.invitation_code_required ? '邀请码' : '邀请码（选填）'}
            name="invitation_code"
            rules={formConfig?.invitation_code_required 
              ? [{ required: true, message: '请输入邀请码' }] 
              : []
            }
          >
            <Input 
              prefix={<SafetyOutlined />}
              placeholder="请输入6位邀请码"
              maxLength={6}
              size="large"
            />
          </Form.Item>

          {/* 提交按钮 */}
          {!submitted && (
            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading}
                size="large"
                block
              >
                提交申请
              </Button>
            </Form.Item>
          )}
        </Form>
      </Card>
    </div>
  );
};

export default OrgApplication;
