/**
 * 论坛管理后台组件
 * 
 * 嵌入 Settings.jsx 的 Tab 中，提供：
 * 1. 论坛统计概览
 * 2. 版块管理（CRUD + 排序 + 可见范围配置）
 * 3. 版主管理（指定/移除版主）
 * 
 * @module components/admin/settings/ForumManagement
 */

import React, { useEffect, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select,
  Switch, Space, Tag, Popconfirm, Statistic, Row, Col, ColorPicker,
  message, Tooltip, Divider, Typography, Empty
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  CommentOutlined, UserOutlined, BarChartOutlined,
  TeamOutlined, GlobalOutlined, CrownOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useForumStore from '../../../stores/forumStore';
import useAdminStore from '../../../stores/adminStore';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { TextArea } = Input;

const ForumManagement = () => {
  const { t } = useTranslation();
  const {
    adminBoards, adminBoardsLoading, forumStats,
    moderators,
    adminFetchBoards, adminCreateBoard, adminUpdateBoard, adminDeleteBoard,
    adminFetchModerators, adminAppointModerator, adminRemoveModerator,
    adminFetchStats
  } = useForumStore();

  const { userGroups, getUserGroups } = useAdminStore();

  /* 弹窗状态 */
  const [boardModalVisible, setBoardModalVisible] = useState(false);
  const [editingBoard, setEditingBoard] = useState(null);
  const [boardForm] = Form.useForm();

  /* 版主管理状态 */
  const [modModalVisible, setModModalVisible] = useState(false);
  const [modBoardId, setModBoardId] = useState(null);
  const [modBoardName, setModBoardName] = useState('');
  const [appointUserId, setAppointUserId] = useState('');

  /* 初始化 */
  useEffect(() => {
    adminFetchBoards();
    adminFetchStats();
    getUserGroups();
  }, []);

  /* ================================================================
   * 版块 CRUD
   * ================================================================ */

  const openCreateBoard = () => {
    setEditingBoard(null);
    boardForm.resetFields();
    boardForm.setFieldsValue({ visibility: 'public', sort_order: 0, is_active: true, color: '#1890ff' });
    setBoardModalVisible(true);
  };

  const openEditBoard = (board) => {
    setEditingBoard(board);
    boardForm.setFieldsValue({
      name: board.name,
      description: board.description,
      icon: board.icon,
      color: board.color || '#1890ff',
      rules: board.rules,
      visibility: board.visibility,
      allowed_group_ids: board.allowed_group_ids || [],
      sort_order: board.sort_order,
      is_active: board.is_active
    });
    setBoardModalVisible(true);
  };

  const handleBoardSubmit = async () => {
    try {
      const values = await boardForm.validateFields();
      /* ColorPicker 返回对象需要转字符串 */
      if (values.color && typeof values.color === 'object') {
        values.color = values.color.toHexString ? values.color.toHexString() : '#1890ff';
      }
      if (values.visibility === 'public') {
        values.allowed_group_ids = null;
      }

      if (editingBoard) {
        await adminUpdateBoard(editingBoard.id, values);
      } else {
        await adminCreateBoard(values);
      }
      setBoardModalVisible(false);
      setEditingBoard(null);
      boardForm.resetFields();
    } catch (e) {
      /* 表单校验失败或API错误(store已处理) */
    }
  };

  /* ================================================================
   * 版主管理
   * ================================================================ */

  const openModeratorModal = (board) => {
    setModBoardId(board.id);
    setModBoardName(board.name);
    setAppointUserId('');
    adminFetchModerators(board.id);
    setModModalVisible(true);
  };

  const handleAppointModerator = async () => {
    if (!appointUserId) return message.warning('请输入用户ID');
    const uid = parseInt(appointUserId);
    if (isNaN(uid)) return message.warning('用户ID必须是数字');
    await adminAppointModerator(modBoardId, uid);
    setAppointUserId('');
  };

  /* ================================================================
   * 表格列定义
   * ================================================================ */

  const boardColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 60
    },
    {
      title: t('forum.admin.boardForm.name'),
      dataIndex: 'name',
      width: 150,
      render: (name, record) => (
        <Space>
          <span style={{
            display: 'inline-block',
            width: 12, height: 12,
            borderRadius: 3,
            backgroundColor: record.color || '#1890ff'
          }} />
          <Text strong>{name}</Text>
        </Space>
      )
    },
    {
      title: t('forum.admin.boardForm.description'),
      dataIndex: 'description',
      ellipsis: true,
      width: 200
    },
    {
      title: t('forum.admin.boardForm.visibility'),
      dataIndex: 'visibility',
      width: 100,
      render: (v) => (
        <Tag color={v === 'public' ? 'blue' : 'green'} icon={v === 'public' ? <GlobalOutlined /> : <TeamOutlined />}>
          {t(`forum.board.visibility.${v}`)}
        </Tag>
      )
    },
    {
      title: t('forum.board.posts'),
      dataIndex: 'post_count',
      width: 80,
      align: 'center'
    },
    {
      title: t('forum.admin.boardForm.sortOrder'),
      dataIndex: 'sort_order',
      width: 80,
      align: 'center'
    },
    {
      title: t('forum.admin.boardForm.isActive'),
      dataIndex: 'is_active',
      width: 80,
      align: 'center',
      render: (v) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '停用'}</Tag>
    },
    {
      title: '操作',
      width: 240,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t('forum.admin.moderators')}>
            <Button
              type="link"
              size="small"
              icon={<CrownOutlined />}
              onClick={() => openModeratorModal(record)}
            >
              版主
            </Button>
          </Tooltip>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditBoard(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title={t('forum.admin.deleteBoardConfirm')}
            onConfirm={() => adminDeleteBoard(record.id)}
            disabled={record.post_count > 0}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.post_count > 0}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const moderatorColumns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '邮箱', dataIndex: 'email', width: 180 },
    {
      title: '指定人',
      dataIndex: 'appointed_by_name',
      width: 120
    },
    {
      title: '指定时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'
    },
    {
      title: '操作',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title={t('forum.admin.removeModeratorConfirm')}
          onConfirm={() => adminRemoveModerator(record.id, modBoardId)}
        >
          <Button type="link" size="small" danger>{t('forum.admin.removeModerator')}</Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <div className="forum-management">
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('forum.admin.statLabels.boardCount')}
              value={forumStats?.board_count || 0}
              prefix={<CommentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('forum.admin.statLabels.postCount')}
              value={forumStats?.post_count || 0}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('forum.admin.statLabels.replyCount')}
              value={forumStats?.reply_count || 0}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('forum.admin.statLabels.activeUserCount')}
              value={forumStats?.active_user_count || 0}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 版块管理表格 */}
      <Card
        title={
          <Space>
            <CommentOutlined />
            {t('forum.admin.boards')}
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { adminFetchBoards(); adminFetchStats(); }}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateBoard}>
              {t('forum.admin.createBoard')}
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={adminBoards}
          columns={boardColumns}
          rowKey="id"
          loading={adminBoardsLoading}
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
        />
      </Card>

      {/* 版块编辑弹窗 */}
      <Modal
        title={editingBoard ? t('forum.admin.editBoard') : t('forum.admin.createBoard')}
        open={boardModalVisible}
        onOk={handleBoardSubmit}
        onCancel={() => { setBoardModalVisible(false); setEditingBoard(null); }}
        width={600}
        destroyOnClose
      >
        <Form form={boardForm} layout="vertical">
          <Form.Item
            name="name"
            label={t('forum.admin.boardForm.name')}
            rules={[{ required: true, message: t('forum.admin.boardForm.nameRequired') }]}
          >
            <Input placeholder={t('forum.admin.boardForm.namePlaceholder')} maxLength={100} />
          </Form.Item>

          <Form.Item name="description" label={t('forum.admin.boardForm.description')}>
            <TextArea placeholder={t('forum.admin.boardForm.descriptionPlaceholder')} rows={3} maxLength={500} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="icon" label={t('forum.admin.boardForm.icon')}>
                <Input placeholder="CommentOutlined" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="color" label={t('forum.admin.boardForm.color')}>
                <ColorPicker format="hex" showText />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="rules" label={t('forum.admin.boardForm.rules')}>
            <TextArea placeholder={t('forum.admin.boardForm.rulesPlaceholder')} rows={4} maxLength={5000} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="visibility" label={t('forum.admin.boardForm.visibility')}>
                <Select
                  options={[
                    { label: t('forum.board.visibility.public'), value: 'public' },
                    { label: t('forum.board.visibility.group'), value: 'group' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sort_order" label={t('forum.admin.boardForm.sortOrder')}>
                <InputNumber min={0} max={999} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.visibility !== cur.visibility}
          >
            {({ getFieldValue }) =>
              getFieldValue('visibility') === 'group' && (
                <Form.Item name="allowed_group_ids" label={t('forum.admin.boardForm.allowedGroups')}>
                  <Select
                    mode="multiple"
                    placeholder="选择允许访问的用户组"
                    options={(userGroups || []).map(g => ({ label: g.name, value: g.id }))}
                  />
                </Form.Item>
              )
            }
          </Form.Item>

          <Form.Item name="is_active" label={t('forum.admin.boardForm.isActive')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 版主管理弹窗 */}
      <Modal
        title={`${t('forum.admin.moderators')} - ${modBoardName}`}
        open={modModalVisible}
        onCancel={() => setModModalVisible(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {/* 指定版主 */}
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Input
              placeholder="输入用户ID"
              value={appointUserId}
              onChange={e => setAppointUserId(e.target.value)}
              style={{ width: 200 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAppointModerator}
            >
              {t('forum.admin.appointModerator')}
            </Button>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            组管理员对本组版块自动拥有版主权限，无需手动指定
          </Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* 版主列表 */}
        <Table
          dataSource={moderators}
          columns={moderatorColumns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无指定版主' }}
        />
      </Modal>
    </div>
  );
};

export default ForumManagement;
