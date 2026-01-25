/**
 * 企业申请页面 - 支持动态字段标签显示和完整国际化
 * 
 * 版本更新：
 * - v1.1.0 (2025-01-07): 完整i18n国际化支持
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
  InboxOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';
import LanguageSwitch from '../../components/common/LanguageSwitch';

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
        message.error(t('auth.orgApplication.configLoadFailed'));
      } finally {
        setConfigLoading(false);
      }
    };
    fetchFormConfig();
  }, [t]);

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
        message.success(`${fileName} ${t('auth.orgApplication.businessLicense.success')}`);
      } else {
        throw new Error(response.data.message || t('auth.orgApplication.businessLicense.failed'));
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      onError(error);
      message.error(error.response?.data?.message || t('auth.orgApplication.businessLicense.failed'));
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
      message.error(t('auth.orgApplication.businessLicense.sizeError'));
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
      message.error(t('auth.orgApplication.businessLicense.typeError'));
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
        message.success(t('auth.orgApplication.submitSuccess'));
      }
    } catch (error) {
      console.error('提交申请失败:', error);
      const errorMsg = error.response?.data?.message || t('auth.orgApplication.submitFailed');
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

  // 从配置中获取字段标签，如果没有则使用i18n默认值
  const fieldLabels = formConfig?.field_labels || {};
  const getFieldLabel = (field, defaultKey) => {
    return fieldLabels[field] || t(defaultKey);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px',
      position: 'relative'
    }}>
      {/* 语言切换器 */}
      <div style={{ 
        position: 'absolute', 
        top: 20, 
        right: 20,
        zIndex: 10
      }}>
        <LanguageSwitch />
      </div>

      {/* 返回登录按钮 */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/login')}
        style={{ 
          position: 'absolute', 
          top: 20, 
          left: 20,
          zIndex: 10,
          background: 'rgba(255, 255, 255, 0.95)',
          border: 'none',
          borderRadius: '24px',
          padding: '0 20px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '15px',
          fontWeight: 600,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)'
        }}
      >
        {t('auth.orgApplication.backToLogin')}
      </Button>

      <Card
        style={{
          width: '100%',
          maxWidth: '600px',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)'
        }}
      >
        {/* 提交成功提示 */}
        {submitted && (
          <Alert
            message={t('auth.orgApplication.submitSuccess')}
            description={t('auth.orgApplication.submitSuccessDesc')}
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
                {t('auth.orgApplication.backToLogin')}
              </Button>
            }
          />
        )}

        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <BankOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '16px' }} />
          <Title level={2}>{t('auth.orgApplication.title')}</Title>
          <Paragraph type="secondary">
            {t('auth.orgApplication.subtitle')}
          </Paragraph>
        </div>

        {/* 显示申请规则 */}
        {formConfig?.application_rules && (
          <Alert
            message={t('auth.orgApplication.rules')}
            description={
              <pre style={{ 
                margin: 0, 
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit'
              }}>
                {formConfig.application_rules}
              </pre>
            }
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: '20px' }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          disabled={submitted}
        >
          {/* 组织名称 - 使用动态标签或i18n */}
          <Form.Item
            label={getFieldLabel('org_name', 'auth.orgApplication.orgName')}
            name="org_name"
            rules={[{ required: true, message: t('auth.orgApplication.orgName.required') }]}
          >
            <Input 
              prefix={<BankOutlined />} 
              placeholder={fieldLabels.org_name 
                ? `${t('common.pleaseInput')}${fieldLabels.org_name}` 
                : t('auth.orgApplication.orgName.placeholder')}
              size="large"
            />
          </Form.Item>

          {/* 申请人邮箱 - 使用动态标签或i18n */}
          <Form.Item
            label={getFieldLabel('applicant_email', 'auth.orgApplication.email')}
            name="applicant_email"
            rules={[
              { required: true, message: t('auth.orgApplication.email.required') },
              { type: 'email', message: t('auth.orgApplication.email.invalid') }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder={fieldLabels.applicant_email 
                ? `${t('common.pleaseInput')}${fieldLabels.applicant_email}` 
                : t('auth.orgApplication.email.placeholder')}
              size="large"
            />
          </Form.Item>

          {/* 营业执照上传 - 使用动态标签或i18n */}
          <Form.Item
            label={getFieldLabel('business_license', 'auth.orgApplication.businessLicense')}
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
                {t('auth.orgApplication.businessLicense.upload')}
              </p>
              <p className="ant-upload-hint">
                {t('auth.orgApplication.businessLicense.hint')}
              </p>
            </Dragger>
          </Form.Item>

          {/* 自定义字段 - 使用配置的字段标签 */}
          {formConfig?.custom_fields?.map((field) => (
            <Form.Item
              key={field.name}
              label={field.label}
              name={field.name}
              rules={field.required ? [{ required: true, message: `${t('common.pleaseInput')}${field.label}` }] : []}
            >
              {field.type === 'textarea' ? (
                <TextArea 
                  placeholder={`${t('common.pleaseInput')}${field.label}`}
                  rows={4}
                />
              ) : field.type === 'select' && field.options ? (
                <Select placeholder={`${t('common.pleaseSelect')}${field.label}`} size="large">
                  {field.options.map(opt => (
                    <Select.Option key={opt.value} value={opt.value}>
                      {opt.label}
                    </Select.Option>
                  ))}
                </Select>
              ) : (
                <Input 
                  placeholder={`${t('common.pleaseInput')}${field.label}`}
                  size="large"
                />
              )}
            </Form.Item>
          ))}

          {/* 邀请码 - 使用动态标签或i18n */}
          <Form.Item
            label={getFieldLabel('invitation_code', 'auth.orgApplication.invitationCode')}
            name="invitation_code"
            rules={formConfig?.invitation_code_required 
              ? [{ required: true, message: t('auth.orgApplication.invitationCode.required') }] 
              : []
            }
          >
            <Input 
              prefix={<SafetyOutlined />}
              placeholder={t('auth.orgApplication.invitationCode.placeholder')}
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
                style={{
                  height: '50px',
                  borderRadius: '12px',
                  fontSize: '17px',
                  fontWeight: '600',
                  background: 'linear-gradient(135deg, #007AFF 0%, #0051D5 100%)',
                  border: 'none',
                  boxShadow: '0 4px 15px rgba(0, 122, 255, 0.3)'
                }}
              >
                {t('auth.orgApplication.submit')}
              </Button>
            </Form.Item>
          )}
        </Form>
      </Card>
    </div>
  );
};

export default OrgApplication;
