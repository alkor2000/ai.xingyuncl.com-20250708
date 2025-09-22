/**
 * 机构申请管理组件 - 支持所有字段标签自定义配置
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Tag,
  Tabs,
  Descriptions,
  Alert,
  Switch,
  DatePicker,
  Popconfirm,
  Tooltip,
  Divider,
  Row,
  Col
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  BankOutlined,
  SafetyOutlined,
  FileImageOutlined,
  EyeOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  MailOutlined,
  FormOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import apiClient from '../../../utils/api';
import moment from 'moment';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Option } = Select;

const OrgApplicationManagement = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [applications, setApplications] = useState([]);
  const [invitationCodes, setInvitationCodes] = useState([]);
  const [formConfig, setFormConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('applications');
  const [approveModalVisible, setApproveModalVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [codeModalVisible, setCodeModalVisible] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [editingCode, setEditingCode] = useState(null);
  const [groups, setGroups] = useState([]);
  
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [configForm] = Form.useForm();

  // 获取申请列表
  const fetchApplications = async (status = null) => {
    setLoading(true);
    try {
      let url = '/admin/org-applications/applications';
      if (status) {
        url += `?status=${status}`;
      }
      const response = await apiClient.get(url);
      if (response.data.success) {
        setApplications(response.data.data || []);
      }
    } catch (error) {
      console.error('获取申请列表失败:', error);
      message.error('获取申请列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取邀请码列表
  const fetchInvitationCodes = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/org-applications/invitation-codes');
      if (response.data.success) {
        setInvitationCodes(response.data.data || []);
      }
    } catch (error) {
      console.error('获取邀请码列表失败:', error);
      message.error('获取邀请码列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取表单配置 - 使用管理员专用接口
  const fetchFormConfig = async () => {
    try {
      const response = await apiClient.get('/admin/org-applications/admin-form-config');
      if (response.data.success) {
        const config = response.data.data;
        setFormConfig(config);
        // 设置表单初始值，包括所有字段标签
        configForm.setFieldsValue({
          button_text: config.button_text,
          button_visible: config.button_visible,
          application_rules: config.application_rules,
          // 核心字段标签
          org_name_label: config.org_name_label,
          applicant_email_label: config.applicant_email_label,
          business_license_label: config.business_license_label,
          invitation_code_label: config.invitation_code_label,
          // 自定义字段配置
          contact_name_label: config.contact_name_label,
          contact_name_required: config.contact_name_required,
          contact_phone_label: config.contact_phone_label,
          contact_phone_required: config.contact_phone_required,
          application_reason_label: config.application_reason_label,
          application_reason_required: config.application_reason_required,
          // 其他配置
          invitation_code_required: config.invitation_code_required,
          default_group_id: config.default_group_id,
          default_credits: config.default_credits,
          auto_approve: config.auto_approve,
          email_notification: config.email_notification
        });
      }
    } catch (error) {
      console.error('获取表单配置失败:', error);
      message.error('获取表单配置失败');
    }
  };

  // 获取用户组列表
  const fetchGroups = async () => {
    try {
      const response = await apiClient.get('/admin/user-groups');
      if (response.data.success) {
        setGroups(response.data.data || []);
      }
    } catch (error) {
      console.error('获取用户组失败:', error);
    }
  };

  useEffect(() => {
    fetchApplications();
    fetchInvitationCodes();
    fetchFormConfig();
    fetchGroups();
  }, []);

  // 处理批准申请
  const handleApprove = async (values) => {
    try {
      const response = await apiClient.post(
        `/admin/org-applications/applications/${selectedApplication.id}/approve`,
        {
          action: 'approve',
          group_id: values.group_id,
          credits: values.credits
        }
      );
      if (response.data.success) {
        // 显示账号信息
        const { email, username, defaultPassword } = response.data.data;
        Modal.success({
          title: '申请已批准',
          content: (
            <div>
              <p>账号创建成功，请告知用户以下信息：</p>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="邮箱">{email}</Descriptions.Item>
                <Descriptions.Item label="用户名">{username}</Descriptions.Item>
                <Descriptions.Item label="默认密码">{defaultPassword}</Descriptions.Item>
              </Descriptions>
              <Alert 
                message="请提醒用户首次登录后修改密码" 
                type="warning" 
                style={{ marginTop: 10 }}
              />
              {formConfig?.email_notification && (
                <Alert 
                  message="邮件通知已发送至用户邮箱" 
                  type="info" 
                  icon={<MailOutlined />}
                  style={{ marginTop: 10 }}
                />
              )}
            </div>
          ),
          width: 500
        });
        setApproveModalVisible(false);
        approveForm.resetFields();
        fetchApplications();
      }
    } catch (error) {
      console.error('批准申请失败:', error);
      message.error(error.response?.data?.message || '批准申请失败');
    }
  };

  // 处理拒绝申请
  const handleReject = async (values) => {
    try {
      const response = await apiClient.post(
        `/admin/org-applications/applications/${selectedApplication.id}/approve`,
        {
          action: 'reject',
          rejection_reason: values.rejection_reason
        }
      );
      if (response.data.success) {
        message.success('申请已拒绝');
        if (formConfig?.email_notification) {
          message.info('拒绝邮件已发送至用户邮箱');
        }
        setRejectModalVisible(false);
        rejectForm.resetFields();
        fetchApplications();
      }
    } catch (error) {
      console.error('拒绝申请失败:', error);
      message.error('拒绝申请失败');
    }
  };

  // 创建或更新邀请码
  const handleSaveCode = async (values) => {
    try {
      if (editingCode) {
        // 更新
        await apiClient.put(
          `/admin/org-applications/invitation-codes/${editingCode.id}`,
          values
        );
        message.success('邀请码更新成功');
      } else {
        // 创建
        await apiClient.post('/admin/org-applications/invitation-codes', values);
        message.success('邀请码创建成功');
      }
      setCodeModalVisible(false);
      codeForm.resetFields();
      setEditingCode(null);
      fetchInvitationCodes();
    } catch (error) {
      console.error('保存邀请码失败:', error);
      message.error(error.response?.data?.message || '保存邀请码失败');
    }
  };

  // 删除邀请码
  const handleDeleteCode = async (id) => {
    try {
      await apiClient.delete(`/admin/org-applications/invitation-codes/${id}`);
      message.success('邀请码删除成功');
      fetchInvitationCodes();
    } catch (error) {
      console.error('删除邀请码失败:', error);
      message.error('删除邀请码失败');
    }
  };

  // 更新表单配置 - 支持所有字段标签
  const handleUpdateConfig = async (values) => {
    try {
      await apiClient.put('/admin/org-applications/form-config', values);
      message.success('配置更新成功');
      setConfigModalVisible(false);
      fetchFormConfig();
    } catch (error) {
      console.error('更新配置失败:', error);
      message.error('更新配置失败');
    }
  };

  // 查看详情
  const showApplicationDetail = (record) => {
    setSelectedApplication(record);
    setDetailModalVisible(true);
  };

  // 申请列表列定义 - 使用动态字段标签
  const applicationColumns = [
    {
      title: '申请时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text) => moment(text).format('YYYY-MM-DD HH:mm'),
      width: 150
    },
    {
      title: formConfig?.org_name_label || '组织名称',
      dataIndex: 'org_name',
      key: 'org_name',
      ellipsis: true,
      width: 150
    },
    {
      title: formConfig?.applicant_email_label || '申请人邮箱',
      dataIndex: 'applicant_email',
      key: 'applicant_email',
      ellipsis: true,
      width: 180
    },
    {
      title: formConfig?.contact_name_label || '联系人',
      dataIndex: 'custom_field_4',
      key: 'custom_field_4',
      render: (text) => text || '-',
      width: 100
    },
    {
      title: formConfig?.contact_phone_label || '联系电话',
      dataIndex: 'custom_field_5',
      key: 'custom_field_5',
      render: (text) => text || '-',
      width: 120
    },
    {
      title: formConfig?.application_reason_label || '申请说明',
      dataIndex: 'custom_field_6',
      key: 'custom_field_6',
      ellipsis: true,
      width: 150,
      render: (text) => (
        <Tooltip title={text}>
          <span>{text || '-'}</span>
        </Tooltip>
      )
    },
    {
      title: formConfig?.business_license_label || '营业执照',
      dataIndex: 'business_license',
      key: 'business_license',
      width: 100,
      render: (url) => {
        if (!url) return '-';
        return (
          <Space>
            <Tooltip title="查看">
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => window.open(url, '_blank')}
              />
            </Tooltip>
            <Tooltip title="下载">
              <Button
                type="link"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'business_license';
                  link.click();
                }}
              />
            </Tooltip>
          </Space>
        );
      }
    },
    {
      title: formConfig?.invitation_code_label || '邀请码',
      dataIndex: 'invitation_code',
      key: 'invitation_code',
      render: (text) => text ? <Tag color="blue">{text}</Tag> : '-',
      width: 100
    },
    {
      title: '推荐人',
      dataIndex: 'referrer_info',
      key: 'referrer_info',
      ellipsis: true,
      width: 120,
      render: (text) => text || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const colorMap = {
          pending: 'processing',
          approved: 'success',
          rejected: 'error'
        };
        const textMap = {
          pending: '待审核',
          approved: '已批准',
          rejected: '已拒绝'
        };
        return <Tag color={colorMap[status]}>{textMap[status]}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 250,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => showApplicationDetail(record)}
          >
            详情
          </Button>
          {record.status === 'pending' && (
            <>
              <Button
                type="primary"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => {
                  setSelectedApplication(record);
                  setApproveModalVisible(true);
                }}
              >
                批准
              </Button>
              <Button
                danger
                size="small"
                icon={<CloseOutlined />}
                onClick={() => {
                  setSelectedApplication(record);
                  setRejectModalVisible(true);
                }}
              >
                拒绝
              </Button>
            </>
          )}
        </Space>
      )
    }
  ];

  // 邀请码列表列定义
  const codeColumns = [
    {
      title: formConfig?.invitation_code_label || '邀请码',
      dataIndex: 'code',
      key: 'code',
      render: (text) => <Tag color="blue">{text}</Tag>
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '使用情况',
      key: 'usage',
      render: (_, record) => {
        const unlimited = record.usage_limit === -1;
        return (
          <span>
            {record.used_count} / {unlimited ? '无限' : record.usage_limit}
          </span>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active) => (
        <Tag color={active ? 'success' : 'default'}>
          {active ? '启用' : '停用'}
        </Tag>
      )
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (text) => text ? moment(text).format('YYYY-MM-DD') : '永不过期'
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingCode(record);
              codeForm.setFieldsValue({
                ...record,
                expires_at: record.expires_at ? moment(record.expires_at) : null
              });
              setCodeModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title={`确定删除该${formConfig?.invitation_code_label || '邀请码'}吗？`}
            onConfirm={() => handleDeleteCode(record.id)}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        {/* 申请管理Tab */}
        <TabPane tab={<span><BankOutlined /> 申请管理</span>} key="applications">
          <Space style={{ marginBottom: 16 }}>
            <Button onClick={() => fetchApplications()}>全部</Button>
            <Button onClick={() => fetchApplications('pending')} type="primary">
              待审核
            </Button>
            <Button onClick={() => fetchApplications('approved')}>已批准</Button>
            <Button onClick={() => fetchApplications('rejected')}>已拒绝</Button>
            <Button icon={<ReloadOutlined />} onClick={() => fetchApplications()}>
              刷新
            </Button>
          </Space>
          
          <Table
            columns={applicationColumns}
            dataSource={applications}
            loading={loading}
            rowKey="id"
            scroll={{ x: 1800 }}
            pagination={{
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`
            }}
          />
        </TabPane>

        {/* 邀请码管理Tab */}
        <TabPane tab={<span><SafetyOutlined /> {formConfig?.invitation_code_label || '邀请码'}管理</span>} key="codes">
          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingCode(null);
                codeForm.resetFields();
                setCodeModalVisible(true);
              }}
            >
              创建{formConfig?.invitation_code_label || '邀请码'}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchInvitationCodes}>
              刷新
            </Button>
          </Space>
          
          <Table
            columns={codeColumns}
            dataSource={invitationCodes}
            loading={loading}
            rowKey="id"
            pagination={{
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`
            }}
          />
        </TabPane>

        {/* 表单配置Tab - 增强字段标签配置 */}
        <TabPane tab={<span><FormOutlined /> 表单配置</span>} key="config">
          <Alert
            message="配置说明"
            description="您可以自定义企业申请表单的所有字段标签和显示行为，让系统适应不同类型的组织（企业、学校、政府机构等）"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          
          <Button
            type="primary"
            icon={<SettingOutlined />}
            onClick={() => {
              // 重新设置表单值，确保显示最新配置
              if (formConfig) {
                configForm.setFieldsValue({
                  button_text: formConfig.button_text,
                  button_visible: formConfig.button_visible,
                  application_rules: formConfig.application_rules,
                  // 核心字段标签
                  org_name_label: formConfig.org_name_label,
                  applicant_email_label: formConfig.applicant_email_label,
                  business_license_label: formConfig.business_license_label,
                  invitation_code_label: formConfig.invitation_code_label,
                  // 自定义字段
                  contact_name_label: formConfig.contact_name_label,
                  contact_name_required: formConfig.contact_name_required,
                  contact_phone_label: formConfig.contact_phone_label,
                  contact_phone_required: formConfig.contact_phone_required,
                  application_reason_label: formConfig.application_reason_label,
                  application_reason_required: formConfig.application_reason_required,
                  // 其他配置
                  invitation_code_required: formConfig.invitation_code_required,
                  default_group_id: formConfig.default_group_id,
                  default_credits: formConfig.default_credits,
                  auto_approve: formConfig.auto_approve,
                  email_notification: formConfig.email_notification
                });
              }
              setConfigModalVisible(true);
            }}
          >
            编辑配置
          </Button>
          
          {formConfig && (
            <Descriptions bordered style={{ marginTop: 16 }} column={2}>
              <Descriptions.Item label="按钮文字" span={2}>
                {formConfig.button_text}
              </Descriptions.Item>
              <Descriptions.Item label="按钮可见">
                <Tag color={formConfig.button_visible ? 'success' : 'default'}>
                  {formConfig.button_visible ? '显示' : '隐藏'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={formConfig.invitation_code_label + "必填"}>
                <Tag color={formConfig.invitation_code_required ? 'warning' : 'default'}>
                  {formConfig.invitation_code_required ? '必填' : '选填'}
                </Tag>
              </Descriptions.Item>
              
              <Descriptions.Item label="字段标签配置" span={2}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div><strong>组织名称：</strong>{formConfig.org_name_label}</div>
                  <div><strong>邮箱：</strong>{formConfig.applicant_email_label}</div>
                  <div><strong>资质文件：</strong>{formConfig.business_license_label}</div>
                  <div><strong>邀请码：</strong>{formConfig.invitation_code_label}</div>
                  <div><strong>联系人：</strong>{formConfig.contact_name_label}</div>
                  <div><strong>联系电话：</strong>{formConfig.contact_phone_label}</div>
                  <div><strong>申请说明：</strong>{formConfig.application_reason_label}</div>
                </Space>
              </Descriptions.Item>
              
              <Descriptions.Item label="申请规则" span={2}>
                {formConfig.application_rules ? (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {formConfig.application_rules}
                  </pre>
                ) : (
                  <span style={{ color: '#999' }}>未设置</span>
                )}
              </Descriptions.Item>
              
              <Descriptions.Item label="默认用户组">
                {groups.find(g => g.id === formConfig.default_group_id)?.name || '默认组'}
              </Descriptions.Item>
              <Descriptions.Item label="默认积分">
                {formConfig.default_credits}
              </Descriptions.Item>
              <Descriptions.Item label="自动审批">
                <Tag color={formConfig.auto_approve ? 'success' : 'default'}>
                  {formConfig.auto_approve ? '启用' : '禁用'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="邮件通知">
                <Tag color={formConfig.email_notification ? 'success' : 'default'}>
                  {formConfig.email_notification ? '启用' : '禁用'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          )}
        </TabPane>
      </Tabs>

      {/* 申请详情弹窗 - 使用动态字段标签 */}
      <Modal
        title="申请详情"
        visible={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={700}
      >
        {selectedApplication && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label="申请ID" span={1}>
              {selectedApplication.id}
            </Descriptions.Item>
            <Descriptions.Item label="申请时间" span={1}>
              {moment(selectedApplication.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.org_name_label || '组织名称'} span={2}>
              {selectedApplication.org_name}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.applicant_email_label || '申请人邮箱'} span={2}>
              {selectedApplication.applicant_email}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.contact_name_label || '联系人姓名'} span={1}>
              {selectedApplication.custom_field_4 || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.contact_phone_label || '联系电话'} span={1}>
              {selectedApplication.custom_field_5 || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.application_reason_label || '申请说明'} span={2}>
              {selectedApplication.custom_field_6 || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.business_license_label || '营业执照'} span={2}>
              {selectedApplication.business_license ? (
                <Space>
                  <Button
                    type="link"
                    icon={<EyeOutlined />}
                    onClick={() => window.open(selectedApplication.business_license, '_blank')}
                  >
                    查看
                  </Button>
                  <Button
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = selectedApplication.business_license;
                      link.download = 'business_license';
                      link.click();
                    }}
                  >
                    下载
                  </Button>
                </Space>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={formConfig?.invitation_code_label || '邀请码'} span={1}>
              {selectedApplication.invitation_code ? (
                <Tag color="blue">{selectedApplication.invitation_code}</Tag>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="推荐人信息" span={1}>
              {selectedApplication.referrer_info || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="状态" span={1}>
              {(() => {
                const status = selectedApplication.status;
                const colorMap = {
                  pending: 'processing',
                  approved: 'success',
                  rejected: 'error'
                };
                const textMap = {
                  pending: '待审核',
                  approved: '已批准',
                  rejected: '已拒绝'
                };
                return <Tag color={colorMap[status]}>{textMap[status]}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="审批时间" span={1}>
              {selectedApplication.approved_at ? 
                moment(selectedApplication.approved_at).format('YYYY-MM-DD HH:mm:ss') : 
                '-'
              }
            </Descriptions.Item>
            {selectedApplication.status === 'approved' && (
              <>
                <Descriptions.Item label="审批人" span={1}>
                  {selectedApplication.approver_name || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="创建账号" span={1}>
                  {selectedApplication.created_user_email || '-'}
                </Descriptions.Item>
              </>
            )}
            {selectedApplication.status === 'rejected' && (
              <Descriptions.Item label="拒绝原因" span={2}>
                {selectedApplication.rejection_reason || '-'}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* 批准申请弹窗 */}
      <Modal
        title="批准申请"
        visible={approveModalVisible}
        onCancel={() => {
          setApproveModalVisible(false);
          approveForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={approveForm}
          layout="vertical"
          onFinish={handleApprove}
          initialValues={{
            group_id: formConfig?.default_group_id || 1,
            credits: formConfig?.default_credits || 0
          }}
        >
          <Form.Item
            label="分配用户组"
            name="group_id"
            rules={[{ required: true, message: '请选择用户组' }]}
          >
            <Select placeholder="选择用户组">
              {groups.map(group => (
                <Option key={group.id} value={group.id}>
                  {group.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          
          <Form.Item
            label="初始积分"
            name="credits"
            rules={[{ required: true, message: '请输入初始积分' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                确认批准
              </Button>
              <Button onClick={() => setApproveModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 拒绝申请弹窗 */}
      <Modal
        title="拒绝申请"
        visible={rejectModalVisible}
        onCancel={() => {
          setRejectModalVisible(false);
          rejectForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={rejectForm}
          layout="vertical"
          onFinish={handleReject}
        >
          <Form.Item
            label="拒绝原因"
            name="rejection_reason"
            rules={[{ required: true, message: '请输入拒绝原因' }]}
          >
            <TextArea rows={4} placeholder="请输入拒绝原因" />
          </Form.Item>
          
          <Form.Item>
            <Space>
              <Button type="primary" danger htmlType="submit">
                确认拒绝
              </Button>
              <Button onClick={() => setRejectModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 邀请码编辑弹窗 */}
      <Modal
        title={editingCode ? `编辑${formConfig?.invitation_code_label || '邀请码'}` : `创建${formConfig?.invitation_code_label || '邀请码'}`}
        visible={codeModalVisible}
        onCancel={() => {
          setCodeModalVisible(false);
          codeForm.resetFields();
          setEditingCode(null);
        }}
        footer={null}
      >
        <Form
          form={codeForm}
          layout="vertical"
          onFinish={handleSaveCode}
        >
          {!editingCode && (
            <Form.Item
              label={formConfig?.invitation_code_label || '邀请码'}
              name="code"
              rules={[
                { required: true, message: `请输入${formConfig?.invitation_code_label || '邀请码'}` },
                { len: 6, message: `${formConfig?.invitation_code_label || '邀请码'}必须为6位字符` }
              ]}
            >
              <Input placeholder={`输入6位${formConfig?.invitation_code_label || '邀请码'}`} maxLength={6} />
            </Form.Item>
          )}
          
          <Form.Item
            label="描述"
            name="description"
          >
            <TextArea rows={2} placeholder={`${formConfig?.invitation_code_label || '邀请码'}用途说明`} />
          </Form.Item>
          
          <Form.Item
            label="使用次数限制"
            name="usage_limit"
            initialValue={-1}
          >
            <InputNumber
              min={-1}
              style={{ width: '100%' }}
              placeholder="-1表示无限制"
            />
          </Form.Item>
          
          <Form.Item
            label="过期时间"
            name="expires_at"
          >
            <DatePicker style={{ width: '100%' }} placeholder="选择过期时间" />
          </Form.Item>
          
          {editingCode && (
            <Form.Item
              label="启用状态"
              name="is_active"
              valuePropName="checked"
            >
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          )}
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingCode ? '更新' : '创建'}
              </Button>
              <Button onClick={() => setCodeModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 表单配置弹窗 - 支持所有字段标签配置 */}
      <Modal
        title="编辑表单配置"
        visible={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        width={800}
        footer={null}
      >
        <Form
          form={configForm}
          layout="vertical"
          onFinish={handleUpdateConfig}
        >
          <Divider orientation="left">基础配置</Divider>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="申请按钮文字"
                name="button_text"
              >
                <Input placeholder="例如：申请企业账号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="显示申请按钮"
                name="button_visible"
                valuePropName="checked"
              >
                <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item
            label={
              <span>
                申请规则 
                <Tooltip title="在申请页面顶部显示的规则说明，支持换行">
                  <InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} />
                </Tooltip>
              </span>
            }
            name="application_rules"
          >
            <TextArea 
              rows={4} 
              placeholder={`请输入申请规则，例如：
1. 申请条件：需提供有效的企业营业执照
2. 审核时间：1-3个工作日内完成审核
3. 联系方式：如有问题请联系 support@example.com`}
            />
          </Form.Item>
          
          <Divider orientation="left">字段标签配置</Divider>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="组织名称字段标签"
                name="org_name_label"
                extra="例如：企业名称、学校名称、机构名称"
              >
                <Input placeholder="默认：企业/组织/学校名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="申请人邮箱字段标签"
                name="applicant_email_label"
                extra="例如：申请人邮箱、联系邮箱"
              >
                <Input placeholder="默认：申请人邮箱" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="资质文件字段标签"
                name="business_license_label"
                extra="例如：营业执照、办学许可证、组织机构代码证"
              >
                <Input placeholder="默认：营业执照" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="邀请码字段标签"
                name="invitation_code_label"
                extra="例如：邀请码、推荐码、内测码"
              >
                <Input placeholder="默认：邀请码" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="联系人姓名标签"
                name="contact_name_label"
              >
                <Input placeholder="默认：联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label="是否必填"
                name="contact_name_required"
                valuePropName="checked"
              >
                <Switch checkedChildren="必填" unCheckedChildren="选填" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="联系电话标签"
                name="contact_phone_label"
              >
                <Input placeholder="默认：联系电话" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label="是否必填"
                name="contact_phone_required"
                valuePropName="checked"
              >
                <Switch checkedChildren="必填" unCheckedChildren="选填" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="申请说明标签"
                name="application_reason_label"
              >
                <Input placeholder="默认：申请说明" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                label="是否必填"
                name="application_reason_required"
                valuePropName="checked"
              >
                <Switch checkedChildren="必填" unCheckedChildren="选填" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item
            label="邀请码必填"
            name="invitation_code_required"
            valuePropName="checked"
          >
            <Switch checkedChildren="必填" unCheckedChildren="选填" />
          </Form.Item>
          
          <Divider orientation="left">审批配置</Divider>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="默认用户组"
                name="default_group_id"
              >
                <Select placeholder="选择默认用户组">
                  {groups.map(group => (
                    <Option key={group.id} value={group.id}>
                      {group.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="默认积分"
                name="default_credits"
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label={
                  <span>
                    自动审批
                    <Tooltip title="启用后，新申请将自动批准并创建账号">
                      <InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} />
                    </Tooltip>
                  </span>
                }
                name="auto_approve"
                valuePropName="checked"
              >
                <Switch checkedChildren="启用" unCheckedChildren="禁用" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={
                  <span>
                    邮件通知
                    <Tooltip title="启用后，批准或拒绝申请时会自动发送邮件通知用户">
                      <InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} />
                    </Tooltip>
                  </span>
                }
                name="email_notification"
                valuePropName="checked"
              >
                <Switch checkedChildren="启用" unCheckedChildren="禁用" />
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                保存配置
              </Button>
              <Button onClick={() => setConfigModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default OrgApplicationManagement;
