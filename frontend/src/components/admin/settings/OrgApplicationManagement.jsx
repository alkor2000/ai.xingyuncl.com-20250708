/**
 * 机构申请管理组件
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
  Popconfirm
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  BankOutlined,
  SafetyOutlined
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
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [editingCode, setEditingCode] = useState(null);
  const [groups, setGroups] = useState([]);
  
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [configForm] = Form.useForm();

  // 获取申请列表 - 修正路径
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

  // 获取邀请码列表 - 修正路径
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

  // 获取表单配置 - 修正路径
  const fetchFormConfig = async () => {
    try {
      const response = await apiClient.get('/admin/org-applications/form-config');
      if (response.data.success) {
        setFormConfig(response.data.data);
        configForm.setFieldsValue(response.data.data);
      }
    } catch (error) {
      console.error('获取表单配置失败:', error);
    }
  };

  // 获取用户组列表 - 修正路径
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

  // 处理批准申请 - 修正路径
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
        message.success('申请已批准');
        setApproveModalVisible(false);
        approveForm.resetFields();
        fetchApplications();
      }
    } catch (error) {
      console.error('批准申请失败:', error);
      message.error(error.response?.data?.message || '批准申请失败');
    }
  };

  // 处理拒绝申请 - 修正路径
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
        setRejectModalVisible(false);
        rejectForm.resetFields();
        fetchApplications();
      }
    } catch (error) {
      console.error('拒绝申请失败:', error);
      message.error('拒绝申请失败');
    }
  };

  // 创建或更新邀请码 - 修正路径
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

  // 删除邀请码 - 修正路径
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

  // 更新表单配置 - 修正路径
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

  // 申请列表列定义
  const applicationColumns = [
    {
      title: '申请时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text) => moment(text).format('YYYY-MM-DD HH:mm'),
      width: 150
    },
    {
      title: '组织名称',
      dataIndex: 'org_name',
      key: 'org_name',
      ellipsis: true
    },
    {
      title: '申请人邮箱',
      dataIndex: 'applicant_email',
      key: 'applicant_email',
      ellipsis: true
    },
    {
      title: '邀请码',
      dataIndex: 'invitation_code',
      key: 'invitation_code',
      render: (text) => text || '-',
      width: 100
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
      width: 200,
      render: (_, record) => (
        <Space>
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
          {record.status === 'approved' && record.created_user_email && (
            <Tag color="blue">{record.created_user_email}</Tag>
          )}
        </Space>
      )
    }
  ];

  // 邀请码列表列定义
  const codeColumns = [
    {
      title: '邀请码',
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
            title="确定删除该邀请码吗？"
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
            pagination={{
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`
            }}
          />
        </TabPane>

        {/* 邀请码管理Tab */}
        <TabPane tab={<span><SafetyOutlined /> 邀请码管理</span>} key="codes">
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
              创建邀请码
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

        {/* 表单配置Tab */}
        <TabPane tab={<span><EditOutlined /> 表单配置</span>} key="config">
          <Alert
            message="配置说明"
            description="您可以自定义企业申请表单的字段和行为"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          
          <Button
            type="primary"
            onClick={() => setConfigModalVisible(true)}
          >
            编辑配置
          </Button>
          
          {formConfig && (
            <Descriptions bordered style={{ marginTop: 16 }}>
              <Descriptions.Item label="按钮文字">
                {formConfig.button_text}
              </Descriptions.Item>
              <Descriptions.Item label="按钮可见">
                <Tag color={formConfig.button_visible ? 'success' : 'default'}>
                  {formConfig.button_visible ? '显示' : '隐藏'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="邀请码必填">
                <Tag color={formConfig.invitation_code_required ? 'warning' : 'default'}>
                  {formConfig.invitation_code_required ? '必填' : '选填'}
                </Tag>
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
            </Descriptions>
          )}
        </TabPane>
      </Tabs>

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
        title={editingCode ? '编辑邀请码' : '创建邀请码'}
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
              label="邀请码"
              name="code"
              rules={[
                { required: true, message: '请输入邀请码' },
                { len: 6, message: '邀请码必须为6位字符' }
              ]}
            >
              <Input placeholder="输入6位邀请码" maxLength={6} />
            </Form.Item>
          )}
          
          <Form.Item
            label="描述"
            name="description"
          >
            <TextArea rows={2} placeholder="邀请码用途说明" />
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

      {/* 表单配置弹窗 */}
      <Modal
        title="编辑表单配置"
        visible={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        width={600}
        footer={null}
      >
        <Form
          form={configForm}
          layout="vertical"
          onFinish={handleUpdateConfig}
        >
          <Form.Item
            label="申请按钮文字"
            name="button_text"
          >
            <Input placeholder="例如：申请企业账号" />
          </Form.Item>
          
          <Form.Item
            label="显示申请按钮"
            name="button_visible"
            valuePropName="checked"
          >
            <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
          </Form.Item>
          
          <Form.Item
            label="邀请码必填"
            name="invitation_code_required"
            valuePropName="checked"
          >
            <Switch checkedChildren="必填" unCheckedChildren="选填" />
          </Form.Item>
          
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
          
          <Form.Item
            label="默认积分"
            name="default_credits"
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          
          <Form.Item
            label="自动审批"
            name="auto_approve"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          
          <Form.Item
            label="邮件通知"
            name="email_notification"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          
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
