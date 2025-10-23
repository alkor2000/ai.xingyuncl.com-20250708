/**
 * 教学模块详情页面
 * 显示模块信息、课程列表、权限管理
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  Button,
  Space,
  Table,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Breadcrumb,
  Descriptions,
  Empty,
  Popconfirm,
  Tooltip,
  Badge,
  Dropdown,
  Avatar
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  EyeOutlined,
  BookOutlined,
  TeamOutlined,
  UserOutlined,
  TagOutlined,
  SettingOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LockOutlined,
  UnlockOutlined,
  SaveOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useAuthStore from '../../stores/authStore';
import moment from 'moment';

const { TextArea } = Input;

const ModuleDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    currentModule,
    lessons,
    permissions,
    currentModuleLoading,
    lessonsLoading,
    permissionsLoading,
    fetchModule,
    fetchLessons,
    fetchPermissions,
    updateModule,
    deleteModule,
    createLesson,
    deleteLesson,
    grantPermission,
    revokePermission,
    revokeMultiplePermissions
  } = useTeachingStore();

  const [activeTab, setActiveTab] = useState('lessons');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [lessonModalVisible, setLessonModalVisible] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [editForm] = Form.useForm();
  const [lessonForm] = Form.useForm();
  const [permissionForm] = Form.useForm();

  // 加载数据
  useEffect(() => {
    if (id) {
      loadModuleData();
    }
  }, [id]);

  const loadModuleData = async () => {
    try {
      await fetchModule(id);
      await fetchLessons(id);
      await fetchPermissions(id);
    } catch (error) {
      message.error(t('teaching.loadFailed'));
    }
  };

  // 返回列表
  const handleBack = () => {
    navigate('/teaching');
  };

  // 打开编辑模态框
  const handleEdit = () => {
    editForm.setFieldsValue({
      name: currentModule.name,
      description: currentModule.description,
      cover_image: currentModule.cover_image,
      visibility: currentModule.visibility,
      status: currentModule.status
    });
    setEditModalVisible(true);
  };

  // 提交编辑
  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields();
      await updateModule(id, values);
      setEditModalVisible(false);
      message.success(t('teaching.updateSuccess'));
      await fetchModule(id);
    } catch (error) {
      message.error(t('teaching.updateFailed'));
    }
  };

  // 删除模块
  const handleDelete = async () => {
    try {
      await deleteModule(id);
      message.success(t('teaching.deleteSuccess'));
      navigate('/teaching');
    } catch (error) {
      message.error(t('teaching.deleteFailed'));
    }
  };

  // 创建课程
  const handleCreateLesson = async () => {
    try {
      const values = await lessonForm.validateFields();
      await createLesson({
        ...values,
        module_id: id,
        content: JSON.stringify({ pages: [{ id: 1, title: 'Page 1', html: '<h1>新页面</h1>' }] })
      });
      setLessonModalVisible(false);
      lessonForm.resetFields();
      message.success(t('teaching.createSuccess'));
      await fetchLessons(id);
    } catch (error) {
      message.error(t('teaching.createFailed'));
    }
  };

  // 查看课程
  const handleViewLesson = (lesson) => {
    navigate(`/teaching/lessons/${lesson.id}`);
  };

  // 编辑课程
  const handleEditLesson = (lesson) => {
    navigate(`/teaching/lessons/${lesson.id}/edit`);
  };

  // 删除课程
  const handleDeleteLesson = async (lessonId) => {
    try {
      await deleteLesson(lessonId, id);
      message.success(t('teaching.deleteSuccess'));
    } catch (error) {
      message.error(t('teaching.deleteFailed'));
    }
  };

  // 授予权限
  const handleGrantPermission = async () => {
    try {
      const values = await permissionForm.validateFields();
      await grantPermission({
        module_id: id,
        ...values
      });
      setPermissionModalVisible(false);
      permissionForm.resetFields();
      message.success(t('teaching.grantSuccess'));
      await fetchPermissions(id);
    } catch (error) {
      message.error(t('teaching.grantFailed'));
    }
  };

  // 撤销权限
  const handleRevokePermission = async (permissionId) => {
    try {
      await revokePermission(permissionId, id);
      message.success(t('teaching.revokeSuccess'));
    } catch (error) {
      message.error(t('teaching.revokeFailed'));
    }
  };

  // 批量撤销权限
  const handleBatchRevoke = async () => {
    if (selectedPermissions.length === 0) {
      message.warning(t('teaching.selectPermissions'));
      return;
    }

    try {
      await revokeMultiplePermissions(selectedPermissions, id);
      setSelectedPermissions([]);
      message.success(t('teaching.batchRevokeSuccess'));
    } catch (error) {
      message.error(t('teaching.batchRevokeFailed'));
    }
  };

  // 可见性颜色
  const visibilityColors = {
    public: 'green',
    group: 'blue',
    private: 'orange'
  };

  // 状态颜色
  const statusColors = {
    draft: 'default',
    published: 'success',
    archived: 'error'
  };

  // 内容类型颜色
  const contentTypeColors = {
    course: 'blue',
    experiment: 'cyan',
    exercise: 'geekblue',
    reference: 'purple',
    teaching_plan: 'orange',
    answer: 'red',
    guide: 'magenta',
    assessment: 'volcano'
  };

  // 课程列表列配置
  const lessonColumns = [
    {
      title: t('teaching.lessonTitle'),
      dataIndex: 'title',
      key: 'title',
      width: 300,
      render: (text, record) => (
        <Space>
          <FileTextOutlined style={{ color: '#1890ff' }} />
          <a onClick={() => handleViewLesson(record)}>{text}</a>
        </Space>
      )
    },
    {
      title: t('teaching.contentType'),
      dataIndex: 'content_type',
      key: 'content_type',
      width: 120,
      render: (type) => (
        <Tag color={contentTypeColors[type]}>
          {t(`teaching.contentTypes.${type}`)}
        </Tag>
      )
    },
    {
      title: t('teaching.pageCount'),
      dataIndex: 'page_count',
      key: 'page_count',
      width: 100,
      render: (count) => <Badge count={count} showZero style={{ backgroundColor: '#52c41a' }} />
    },
    {
      title: t('teaching.status.label'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={statusColors[status]}>
          {t(`teaching.status.${status}`)}
        </Tag>
      )
    },
    {
      title: t('teaching.viewCount'),
      dataIndex: 'view_count',
      key: 'view_count',
      width: 100
    },
    {
      title: t('teaching.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date) => moment(date).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title={t('teaching.view')}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleViewLesson(record)}
            />
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditLesson(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('teaching.confirmDeleteLesson')}
            onConfirm={() => handleDeleteLesson(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Tooltip title={t('common.delete')}>
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  // 权限列表列配置
  const permissionColumns = [
    {
      title: t('teaching.permissionTarget'),
      key: 'target',
      width: 300,
      render: (_, record) => {
        if (record.user_id) {
          return (
            <Space>
              <UserOutlined style={{ color: '#1890ff' }} />
              <span>{record.target_user_name || record.target_user_email}</span>
            </Space>
          );
        }
        if (record.group_id) {
          return (
            <Space>
              <TeamOutlined style={{ color: '#52c41a' }} />
              <span>{record.target_group_name}</span>
            </Space>
          );
        }
        if (record.tag_id) {
          return (
            <Space>
              <TagOutlined style={{ color: '#faad14' }} />
              <Tag color={record.target_tag_color}>{record.target_tag_name}</Tag>
            </Space>
          );
        }
        return '-';
      }
    },
    {
      title: t('teaching.permissionType'),
      dataIndex: 'permission_type',
      key: 'permission_type',
      width: 120,
      render: (type) => (
        <Tag color={type === 'edit' ? 'orange' : 'blue'}>
          {type === 'edit' ? <UnlockOutlined /> : <LockOutlined />}
          {t(`teaching.permissionTypes.${type}`)}
        </Tag>
      )
    },
    {
      title: t('teaching.grantedBy'),
      dataIndex: 'granted_by_name',
      key: 'granted_by_name',
      width: 150
    },
    {
      title: t('teaching.grantedAt'),
      dataIndex: 'granted_at',
      key: 'granted_at',
      width: 180,
      render: (date) => moment(date).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('teaching.expiresAt'),
      dataIndex: 'expires_at',
      key: 'expires_at',
      width: 180,
      render: (date) => date ? moment(date).format('YYYY-MM-DD HH:mm') : t('teaching.permanent')
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm
          title={t('teaching.confirmRevokePermission')}
          onConfirm={() => handleRevokePermission(record.id)}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button type="link" size="small" danger>
            {t('teaching.revoke')}
          </Button>
        </Popconfirm>
      )
    }
  ];

  if (currentModuleLoading || !currentModule) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty description={t('common.loading')} />
      </div>
    );
  }

  // Tabs配置
  const tabItems = [
    {
      key: 'lessons',
      label: (
        <span>
          <FileTextOutlined />
          {t('teaching.lessons')} ({lessons.length})
        </span>
      ),
      children: (
        <Card
          title={t('teaching.lessonList')}
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setLessonModalVisible(true)}
            >
              {t('teaching.createLesson')}
            </Button>
          }
        >
          <Table
            columns={lessonColumns}
            dataSource={lessons}
            loading={lessonsLoading}
            rowKey="id"
            scroll={{ x: 1200 }}
            locale={{ emptyText: t('teaching.noLessons') }}
          />
        </Card>
      )
    },
    {
      key: 'permissions',
      label: (
        <span>
          <SettingOutlined />
          {t('teaching.permissions')} ({permissions.length})
        </span>
      ),
      children: (
        <Card
          title={t('teaching.permissionList')}
          extra={
            <Space>
              {selectedPermissions.length > 0 && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleBatchRevoke}
                >
                  {t('teaching.batchRevoke')} ({selectedPermissions.length})
                </Button>
              )}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setPermissionModalVisible(true)}
              >
                {t('teaching.grantPermission')}
              </Button>
            </Space>
          }
        >
          <Table
            columns={permissionColumns}
            dataSource={permissions}
            loading={permissionsLoading}
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedPermissions,
              onChange: setSelectedPermissions
            }}
            scroll={{ x: 1200 }}
            locale={{ emptyText: t('teaching.noPermissions') }}
          />
        </Card>
      )
    }
  ];

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: 'calc(100vh - 64px)' }}>
      {/* 面包屑 */}
      <Breadcrumb style={{ marginBottom: 16 }}>
        <Breadcrumb.Item>
          <a onClick={handleBack}>{t('teaching.teaching')}</a>
        </Breadcrumb.Item>
        <Breadcrumb.Item>{currentModule.name}</Breadcrumb.Item>
      </Breadcrumb>

      {/* 模块信息卡片 */}
      <Card
        style={{ marginBottom: 24 }}
        cover={
          currentModule.cover_image && (
            <div
              style={{
                height: 200,
                backgroundImage: `url(${currentModule.cover_image})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            />
          )
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <BookOutlined style={{ fontSize: 32, color: '#1890ff', marginRight: 12 }} />
              <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>{currentModule.name}</h2>
                <Space style={{ marginTop: 8 }}>
                  <Tag color={visibilityColors[currentModule.visibility]}>
                    <GlobalOutlined /> {t(`teaching.visibility.${currentModule.visibility}`)}
                  </Tag>
                  <Tag color={statusColors[currentModule.status]}>
                    {t(`teaching.status.${currentModule.status}`)}
                  </Tag>
                </Space>
              </div>
            </div>

            <Descriptions column={2} style={{ marginTop: 16 }}>
              <Descriptions.Item label={t('teaching.description')}>
                {currentModule.description || t('teaching.noDescription')}
              </Descriptions.Item>
              <Descriptions.Item label={t('teaching.creator')}>
                {currentModule.creator_name}
              </Descriptions.Item>
              <Descriptions.Item label={t('teaching.lessonCount')}>
                {currentModule.lesson_count}
              </Descriptions.Item>
              <Descriptions.Item label={t('teaching.viewCount')}>
                {currentModule.view_count}
              </Descriptions.Item>
              <Descriptions.Item label={t('teaching.createdAt')}>
                {moment(currentModule.created_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label={t('teaching.updatedAt')}>
                {moment(currentModule.updated_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </div>

          {/* 操作按钮 */}
          <Space direction="vertical">
            <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
              {t('common.back')}
            </Button>
            <Button icon={<EditOutlined />} onClick={handleEdit}>
              {t('common.edit')}
            </Button>
            <Popconfirm
              title={t('teaching.confirmDeleteModule')}
              onConfirm={handleDelete}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t('common.delete')}
              </Button>
            </Popconfirm>
          </Space>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />

      {/* 编辑模块模态框 */}
      <Modal
        title={t('teaching.editModule')}
        open={editModalVisible}
        onOk={handleEditSubmit}
        onCancel={() => setEditModalVisible(false)}
        width={600}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label={t('teaching.moduleName')}
            rules={[{ required: true, message: t('teaching.moduleNameRequired') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('teaching.moduleDescription')}>
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="cover_image" label={t('teaching.coverImage')}>
            <Input placeholder={t('teaching.coverImagePlaceholder')} />
          </Form.Item>
          <Form.Item name="visibility" label={t('teaching.visibility.label')}>
            <Select>
              <Select.Option value="private">{t('teaching.visibility.private')}</Select.Option>
              <Select.Option value="group">{t('teaching.visibility.group')}</Select.Option>
              <Select.Option value="public">{t('teaching.visibility.public')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label={t('teaching.status.label')}>
            <Select>
              <Select.Option value="draft">{t('teaching.status.draft')}</Select.Option>
              <Select.Option value="published">{t('teaching.status.published')}</Select.Option>
              <Select.Option value="archived">{t('teaching.status.archived')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建课程模态框 */}
      <Modal
        title={t('teaching.createLesson')}
        open={lessonModalVisible}
        onOk={handleCreateLesson}
        onCancel={() => setLessonModalVisible(false)}
        width={600}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
      >
        <Form form={lessonForm} layout="vertical">
          <Form.Item
            name="title"
            label={t('teaching.lessonTitle')}
            rules={[{ required: true, message: t('teaching.lessonTitleRequired') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('teaching.lessonDescription')}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="content_type"
            label={t('teaching.contentType')}
            initialValue="course"
          >
            <Select>
              <Select.Option value="course">{t('teaching.contentTypes.course')}</Select.Option>
              <Select.Option value="experiment">{t('teaching.contentTypes.experiment')}</Select.Option>
              <Select.Option value="exercise">{t('teaching.contentTypes.exercise')}</Select.Option>
              <Select.Option value="reference">{t('teaching.contentTypes.reference')}</Select.Option>
              <Select.Option value="teaching_plan">{t('teaching.contentTypes.teaching_plan')}</Select.Option>
              <Select.Option value="answer">{t('teaching.contentTypes.answer')}</Select.Option>
              <Select.Option value="guide">{t('teaching.contentTypes.guide')}</Select.Option>
              <Select.Option value="assessment">{t('teaching.contentTypes.assessment')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 授予权限模态框 */}
      <Modal
        title={t('teaching.grantPermission')}
        open={permissionModalVisible}
        onOk={handleGrantPermission}
        onCancel={() => setPermissionModalVisible(false)}
        width={600}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={permissionForm} layout="vertical">
          <Form.Item
            name="target_type"
            label={t('teaching.targetType')}
            rules={[{ required: true, message: t('teaching.targetTypeRequired') }]}
          >
            <Select placeholder={t('teaching.selectTargetType')}>
              <Select.Option value="user">{t('teaching.targetTypes.user')}</Select.Option>
              <Select.Option value="group">{t('teaching.targetTypes.group')}</Select.Option>
              <Select.Option value="tag">{t('teaching.targetTypes.tag')}</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => 
              prevValues.target_type !== currentValues.target_type
            }
          >
            {({ getFieldValue }) => {
              const targetType = getFieldValue('target_type');
              if (targetType === 'user') {
                return (
                  <Form.Item
                    name="user_id"
                    label={t('teaching.selectUser')}
                    rules={[{ required: true, message: t('teaching.userRequired') }]}
                  >
                    <Input type="number" placeholder={t('teaching.enterUserId')} />
                  </Form.Item>
                );
              }
              if (targetType === 'group') {
                return (
                  <Form.Item
                    name="group_id"
                    label={t('teaching.selectGroup')}
                    rules={[{ required: true, message: t('teaching.groupRequired') }]}
                  >
                    <Input type="number" placeholder={t('teaching.enterGroupId')} />
                  </Form.Item>
                );
              }
              if (targetType === 'tag') {
                return (
                  <Form.Item
                    name="tag_id"
                    label={t('teaching.selectTag')}
                    rules={[{ required: true, message: t('teaching.tagRequired') }]}
                  >
                    <Input type="number" placeholder={t('teaching.enterTagId')} />
                  </Form.Item>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item
            name="permission_type"
            label={t('teaching.permissionType')}
            initialValue="view"
          >
            <Select>
              <Select.Option value="view">{t('teaching.permissionTypes.view')}</Select.Option>
              <Select.Option value="edit">{t('teaching.permissionTypes.edit')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ModuleDetail;
