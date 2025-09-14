/**
 * 企业机构申请页面
 */

import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Upload, message, Typography, Space, Spin, Alert, Select } from 'antd';
import { 
  BankOutlined, 
  MailOutlined, 
  UploadOutlined,
  ArrowLeftOutlined,
  SafetyOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

const OrgApplication = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [formConfig, setFormConfig] = useState(null);
  const [fileList, setFileList] = useState([]);
  const navigate = useNavigate();
  const { t } = useTranslation();

  // 获取表单配置 - 修正路径
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

  // 处理文件上传
  const handleUploadChange = ({ fileList }) => {
    setFileList(fileList);
  };

  // 处理表单提交 - 修正路径
  const handleSubmit = async (values) => {
    try {
      setLoading(true);
      
      // 处理文件上传路径
      const business_license = fileList.length > 0 && fileList[0].response?.url 
        ? fileList[0].response.url 
        : null;
      
      const submitData = {
        ...values,
        business_license
      };
      
      const response = await api.post('/public/org-application/submit', submitData);
      
      if (response.data.success) {
        message.success('申请提交成功！我们会尽快处理您的申请。');
        // 3秒后跳转到登录页
        setTimeout(() => {
          navigate('/login');
        }, 3000);
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
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <BankOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '16px' }} />
          <Title level={2}>企业机构申请</Title>
          <Paragraph type="secondary">
            请填写以下信息，我们会尽快审核您的申请
          </Paragraph>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
        >
          {/* 必填字段：组织名称 */}
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

          {/* 必填字段：申请人邮箱 */}
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
              placeholder="请输入您的企业邮箱"
              size="large"
            />
          </Form.Item>

          {/* 选填字段：营业执照 */}
          <Form.Item
            label="营业执照（选填）"
            name="business_license_upload"
          >
            <Upload
              fileList={fileList}
              onChange={handleUploadChange}
              beforeUpload={() => false}
              maxCount={1}
              accept="image/*,.pdf"
            >
              <Button icon={<UploadOutlined />}>上传营业执照</Button>
            </Upload>
            <div style={{ marginTop: '8px', color: '#999', fontSize: '12px' }}>
              支持 JPG、PNG、PDF 格式，文件大小不超过 5MB
            </div>
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

          {/* 邀请码字段 */}
          <Form.Item
            label={`邀请码${formConfig?.invitation_code_required ? '' : '（选填）'}`}
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

          <Alert
            message="提示"
            description="申请提交后，我们会在1-3个工作日内审核，审核结果将通过邮件通知您。"
            type="info"
            showIcon
            style={{ marginBottom: '20px' }}
          />

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
        </Form>
      </Card>
    </div>
  );
};

export default OrgApplication;
