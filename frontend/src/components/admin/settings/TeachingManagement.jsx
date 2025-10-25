/**
 * 教学管理后台组件（分组管理增强版）
 * 新增功能：
 * 1. Tab结构：模块管理 + 分组管理
 * 2. 分组管理：创建、编辑、删除、排序、批量操作
 * 3. 拖拽排序功能
 * 权限：仅超级管理员可见
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Space,
  Button,
  Tag,
  Select,
  Input,
  Statistic,
  Row,
  Col,
  Modal,
  message,
  Popconfirm,
  Badge,
  Tooltip,
  Empty,
  Alert,
  Tabs,
  Form,
  Switch,
  InputNumber
} from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  RiseOutlined,
  SearchOutlined,
  ReloadOutlined,
  CodeOutlined,
  SaveOutlined,
  UndoOutlined,
  PlusOutlined,
  MenuOutlined,
  AppstoreOutlined,
  HolderOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useTeachingStore from '../../../stores/teachingStore';
import useSystemConfigStore from '../../../stores/systemConfigStore';
import moment from 'moment';
import MonacoEditor from '@monaco-editor/react';

const { Option } = Select;
const { Search, TextArea } = Input;

const TeachingManagement = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const {
    allModules,
    allModulesLoading,
    groups,
    groupsLoading,
    fetchAllModules,
    fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    updateModule,
    deleteModule,
    batchUpdateModules
  } = useTeachingStore();
  
  const { systemConfig, updateSystemConfig } = useSystemConfigStore();

  // 模块管理状态
  const [selectedModuleKeys, setSelectedModuleKeys] = useState([]);
  const [moduleFilters, setModuleFilters] = useState({
    search: '',
    status: null,
    visibility: null
  });
  
  // 分组管理状态
  const [selectedGroupKeys, setSelectedGroupKeys] = useState([]);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm] = Form.useForm();
  
  // 页面头部HTML配置
  const [headerHtml, setHeaderHtml] = useState('');
  const [headerHtmlLoading, setHeaderHtmlLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  const [statistics, setStatistics] = useState({
    totalModules: 0,
    totalLessons: 0,
    todayViews: 0,
    weeklyNew: 0
  });

  // 初始加载
  useEffect(() => {
    loadData();
    const currentHeaderHtml = systemConfig?.teaching_page_header_html || '';
    setHeaderHtml(currentHeaderHtml);
  }, [systemConfig]);

  // 加载数据
  const loadData = async () => {
    try {
      await fetchAllModules();
      await fetchGroups();
    } catch (error) {
      message.error('加载数据失败');
    }
  };

  // 计算统计数据
  useEffect(() => {
    if (allModules && allModules.length > 0) {
      const totalLessons = allModules.reduce((sum, m) => sum + (m.lesson_count || 0), 0);
      const todayViews = allModules.reduce((sum, m) => sum + (m.view_count || 0), 0);
      
      const oneWeekAgo = moment().subtract(7, 'days');
      const weeklyNew = allModules.filter(m => 
        moment(m.created_at).isAfter(oneWeekAgo)
      ).length;

      setStatistics({
        totalModules: allModules.length,
        totalLessons,
        todayViews,
        weeklyNew
      });
    }
  }, [allModules]);

  // ==================== 分组管理功能 ====================

  // 打开分组编辑模态框
  const handleOpenGroupModal = (group = null) => {
    setEditingGroup(group);
    if (group) {
      groupForm.setFieldsValue(group);
    } else {
      groupForm.resetFields();
    }
    setGroupModalVisible(true);
  };

  // 提交分组表单
  const handleSubmitGroup = async () => {
    try {
      const values = await groupForm.validateFields();
      
      if (editingGroup) {
        await updateGroup(editingGroup.id, values);
        message.success('分组更新成功');
      } else {
        await createGroup(values);
        message.success('分组创建成功');
      }
      
      setGroupModalVisible(false);
      groupForm.resetFields();
      await fetchGroups();
    } catch (error) {
      message.error(editingGroup ? '更新分组失败' : '创建分组失败');
    }
  };

  // 删除分组
  const handleDeleteGroup = async (groupId) => {
    try {
      await deleteGroup(groupId);
      message.success('分组删除成功');
      await fetchGroups();
    } catch (error) {
      message.error('删除分组失败');
    }
  };

  // 批量删除分组
  const handleBatchDeleteGroups = async () => {
    if (selectedGroupKeys.length === 0) {
      message.warning('请选择要删除的分组');
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedGroupKeys.length} 个分组吗？`,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const id of selectedGroupKeys) {
            await deleteGroup(id);
          }
          message.success('批量删除成功');
          setSelectedGroupKeys([]);
          await fetchGroups();
        } catch (error) {
          message.error('批量删除失败');
        }
      }
    });
  };

  // 批量启用/禁用分组
  const handleBatchToggleGroups = async (isActive) => {
    if (selectedGroupKeys.length === 0) {
      message.warning('请选择要操作的分组');
      return;
    }

    try {
      for (const id of selectedGroupKeys) {
        await updateGroup(id, { is_active: isActive });
      }
      message.success(`批量${isActive ? '启用' : '禁用'}成功`);
      setSelectedGroupKeys([]);
      await fetchGroups();
    } catch (error) {
      message.error(`批量${isActive ? '启用' : '禁用'}失败`);
    }
  };

  // 调整分组排序（上移/下移）
  const handleMoveGroup = async (group, direction) => {
    const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const currentIndex = sortedGroups.findIndex(g => g.id === group.id);
    
    if (direction === 'up' && currentIndex > 0) {
      const targetGroup = sortedGroups[currentIndex - 1];
      await updateGroup(group.id, { sort_order: targetGroup.sort_order });
      await updateGroup(targetGroup.id, { sort_order: group.sort_order });
      message.success('上移成功');
    } else if (direction === 'down' && currentIndex < sortedGroups.length - 1) {
      const targetGroup = sortedGroups[currentIndex + 1];
      await updateGroup(group.id, { sort_order: targetGroup.sort_order });
      await updateGroup(targetGroup.id, { sort_order: group.sort_order });
      message.success('下移成功');
    }
    
    await fetchGroups();
  };

  // ==================== 模块管理功能 ====================

  // 批量更新模块状态
  const handleBatchUpdateModuleStatus = async (status) => {
    if (selectedModuleKeys.length === 0) {
      message.warning('请选择要操作的模块');
      return;
    }

    try {
      await batchUpdateModules(selectedModuleKeys, { status });
      message.success('批量更新成功');
      setSelectedModuleKeys([]);
      loadData();
    } catch (error) {
      message.error('批量更新失败');
    }
  };

  // 批量删除模块
  const handleBatchDeleteModules = async () => {
    if (selectedModuleKeys.length === 0) {
      message.warning('请选择要删除的模块');
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedModuleKeys.length} 个模块吗？`,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const id of selectedModuleKeys) {
            await deleteModule(id);
          }
          message.success('批量删除成功');
          setSelectedModuleKeys([]);
          loadData();
        } catch (error) {
          message.error('批量删除失败');
        }
      }
    });
  };

  // ==================== 页面头部HTML配置 ====================

  // 保存页面头部HTML
  const handleSaveHeaderHtml = async () => {
    setHeaderHtmlLoading(true);
    try {
      const newConfig = {
        ...systemConfig,
        teaching_page_header_html: headerHtml
      };
      
      const result = await updateSystemConfig(newConfig);
      
      if (result.success) {
        message.success('保存成功');
      } else {
        message.error(result.error || '保存失败');
      }
    } catch (error) {
      message.error('保存失败');
    } finally {
      setHeaderHtmlLoading(false);
    }
  };

  // 重置为默认模板
  const handleResetToDefault = () => {
    const defaultTemplate = `<div style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); padding: 40px 20px; margin-bottom: 24px;">
  <div style="max-width: 1200px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="font-size: 48px; color: #1a1a1a; margin: 0 0 16px 0; font-weight: 600;">我的课程</h1>
      <p style="color: #666; font-size: 16px; margin: 0;">探索AI驱动的智能教学模块，开启现代化学习体验</p>
    </div>
  </div>
</div>`;
    
    setHeaderHtml(defaultTemplate);
    message.success('已重置为默认模板');
  };

  // ==================== 表格列配置 ====================

  // 模块表格列
  const moduleColumns = [
    {
      title: '模块名称',
      dataIndex: 'name',
      key: 'name',
      width: 250,
      render: (text, record) => (
        <Space>
          <BookOutlined style={{ color: '#1890ff' }} />
          <a onClick={() => navigate(`/teaching/modules/${record.id}`)}>{text}</a>
        </Space>
      )
    },
    {
      title: '创建者',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 120
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      key: 'visibility',
      width: 100,
      render: (visibility) => (
        <Tag color={
          visibility === 'public' ? 'green' :
          visibility === 'group' ? 'blue' :
          'orange'
        }>
          {visibility === 'public' ? '公开' : visibility === 'group' ? '组织内' : '私有'}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={
          status === 'draft' ? 'default' :
          status === 'published' ? 'success' :
          'error'
        }>
          {status === 'draft' ? '草稿' : status === 'published' ? '已发布' : '已归档'}
        </Tag>
      )
    },
    {
      title: '课程数',
      dataIndex: 'lesson_count',
      key: 'lesson_count',
      width: 100,
      sorter: (a, b) => (a.lesson_count || 0) - (b.lesson_count || 0),
      render: (count) => (
        <Badge count={count || 0} showZero style={{ backgroundColor: '#52c41a' }} />
      )
    },
    {
      title: '查看数',
      dataIndex: 'view_count',
      key: 'view_count',
      width: 100,
      sorter: (a, b) => (a.view_count || 0) - (b.view_count || 0)
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      sorter: (a, b) => moment(a.created_at).unix() - moment(b.created_at).unix(),
      render: (date) => moment(date).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="查看">
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/teaching/modules/${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除此模块？"
            onConfirm={async () => {
              try {
                await deleteModule(record.id);
                message.success('删除成功');
                loadData();
              } catch (error) {
                message.error('删除失败');
              }
            }}
            okText="确认"
            cancelText="取消"
          >
            <Tooltip title="删除">
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

  // 分组表格列
  const groupColumns = [
    {
      title: '排序',
      key: 'sort',
      width: 100,
      render: (_, record, index) => (
        <Space>
          <Tooltip title="上移">
            <Button
              type="text"
              size="small"
              icon={<ArrowUpOutlined />}
              disabled={index === 0}
              onClick={() => handleMoveGroup(record, 'up')}
            />
          </Tooltip>
          <span style={{ color: '#999', fontSize: 12 }}>#{record.sort_order}</span>
          <Tooltip title="下移">
            <Button
              type="text"
              size="small"
              icon={<ArrowDownOutlined />}
              disabled={index === groups.length - 1}
              onClick={() => handleMoveGroup(record, 'down')}
            />
          </Tooltip>
        </Space>
      )
    },
    {
      title: '分组名称',
      dataIndex: 'name',
      key: 'name',
      width: 250,
      render: (text) => (
        <Space>
          <AppstoreOutlined style={{ color: '#1890ff' }} />
          <strong>{text}</strong>
        </Space>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text) => text || <span style={{ color: '#ccc' }}>暂无描述</span>
    },
    {
      title: '模块数量',
      dataIndex: 'module_count',
      key: 'module_count',
      width: 100,
      sorter: (a, b) => (a.module_count || 0) - (b.module_count || 0),
      render: (count) => (
        <Badge count={count || 0} showZero style={{ backgroundColor: '#52c41a' }} />
      )
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (isActive, record) => (
        <Switch
          checked={isActive}
          onChange={async (checked) => {
            try {
              await updateGroup(record.id, { is_active: checked });
              message.success(`${checked ? '启用' : '禁用'}成功`);
              await fetchGroups();
            } catch (error) {
              message.error(`${checked ? '启用' : '禁用'}失败`);
            }
          }}
        />
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date) => moment(date).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleOpenGroupModal(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除此分组？"
            description="删除分组不会删除模块，模块将变为未分组状态"
            onConfirm={() => handleDeleteGroup(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Tooltip title="删除">
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

  // 过滤模块
  const filteredModules = allModules.filter(module => {
    if (moduleFilters.search && !module.name.toLowerCase().includes(moduleFilters.search.toLowerCase())) {
      return false;
    }
    if (moduleFilters.status && module.status !== moduleFilters.status) {
      return false;
    }
    if (moduleFilters.visibility && module.visibility !== moduleFilters.visibility) {
      return false;
    }
    return true;
  });

  // Tab项配置
  const tabItems = [
    {
      key: 'modules',
      label: (
        <span>
          <BookOutlined />
          模块管理
        </span>
      ),
      children: (
        <div>
          {/* 筛选栏 */}
          <Space style={{ marginBottom: 16, width: '100%' }} wrap>
            <Search
              placeholder="搜索模块名称"
              allowClear
              style={{ width: 300 }}
              onSearch={(value) => setModuleFilters({ ...moduleFilters, search: value })}
              onChange={(e) => {
                if (!e.target.value) {
                  setModuleFilters({ ...moduleFilters, search: '' });
                }
              }}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 120 }}
              onChange={(value) => setModuleFilters({ ...moduleFilters, status: value })}
            >
              <Option value="draft">草稿</Option>
              <Option value="published">已发布</Option>
              <Option value="archived">已归档</Option>
            </Select>
            <Select
              placeholder="可见性"
              allowClear
              style={{ width: 120 }}
              onChange={(value) => setModuleFilters({ ...moduleFilters, visibility: value })}
            >
              <Option value="private">私有</Option>
              <Option value="group">组织内</Option>
              <Option value="public">公开</Option>
            </Select>
          </Space>

          {/* 批量操作栏 */}
          {selectedModuleKeys.length > 0 && (
            <Space style={{ marginBottom: 16 }}>
              <span>已选择 {selectedModuleKeys.length} 项</span>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => handleBatchUpdateModuleStatus('published')}
              >
                批量发布
              </Button>
              <Button
                icon={<InboxOutlined />}
                onClick={() => handleBatchUpdateModuleStatus('archived')}
              >
                批量归档
              </Button>
              <Popconfirm
                title="确认批量删除？"
                onConfirm={handleBatchDeleteModules}
                okText="确认"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除
                </Button>
              </Popconfirm>
            </Space>
          )}

          {/* 模块表格 */}
          <Table
            columns={moduleColumns}
            dataSource={filteredModules}
            loading={allModulesLoading}
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedModuleKeys,
              onChange: setSelectedModuleKeys
            }}
            scroll={{ x: 1400 }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 项`
            }}
          />
        </div>
      )
    },
    {
      key: 'groups',
      label: (
        <span>
          <AppstoreOutlined />
          分组管理
        </span>
      ),
      children: (
        <div>
          <Alert
            message="分组管理说明"
            description="分组用于组织教学模块，一个模块可以属于多个分组。通过调整排序可以控制前端显示顺序。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          
          {/* 操作栏 */}
          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleOpenGroupModal()}
            >
              创建分组
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchGroups()}
            >
              刷新
            </Button>
          </Space>

          {/* 批量操作栏 */}
          {selectedGroupKeys.length > 0 && (
            <Space style={{ marginBottom: 16 }}>
              <span>已选择 {selectedGroupKeys.length} 项</span>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => handleBatchToggleGroups(true)}
              >
                批量启用
              </Button>
              <Button
                icon={<InboxOutlined />}
                onClick={() => handleBatchToggleGroups(false)}
              >
                批量禁用
              </Button>
              <Popconfirm
                title="确认批量删除？"
                description="删除分组不会删除模块"
                onConfirm={handleBatchDeleteGroups}
                okText="确认"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除
                </Button>
              </Popconfirm>
            </Space>
          )}

          {/* 分组表格 */}
          <Table
            columns={groupColumns}
            dataSource={[...groups].sort((a, b) => a.sort_order - b.sort_order)}
            loading={groupsLoading}
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedGroupKeys,
              onChange: setSelectedGroupKeys
            }}
            pagination={false}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无分组"
                >
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => handleOpenGroupModal()}
                  >
                    创建第一个分组
                  </Button>
                </Empty>
              )
            }}
          />
        </div>
      )
    },
    {
      key: 'header',
      label: (
        <span>
          <CodeOutlined />
          页面头部配置
        </span>
      ),
      children: (
        <div>
          <Alert
            message="提示"
            description="您可以自定义教学模块列表页面的头部HTML内容，包括标题、搜索框、按钮等。支持完整的HTML、CSS和JavaScript代码。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          
          <Space style={{ marginBottom: 16 }}>
            <Button
              icon={<UndoOutlined />}
              onClick={handleResetToDefault}
            >
              重置为默认
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={() => setPreviewVisible(true)}
            >
              预览
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={headerHtmlLoading}
              onClick={handleSaveHeaderHtml}
            >
              保存
            </Button>
          </Space>
          
          <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', overflow: 'hidden' }}>
            <MonacoEditor
              height="400px"
              language="html"
              value={headerHtml}
              onChange={(value) => setHeaderHtml(value || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on'
              }}
              theme="vs-light"
            />
          </div>
        </div>
      )
    }
  ];

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="模块总数"
              value={statistics.totalModules}
              prefix={<BookOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="课程总数"
              value={statistics.totalLessons}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总浏览量"
              value={statistics.todayViews}
              prefix={<EyeOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本周新增"
              value={statistics.weeklyNew}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Tab区域 */}
      <Card>
        <Tabs items={tabItems} defaultActiveKey="modules" />
      </Card>

      {/* 分组编辑模态框 */}
      <Modal
        title={editingGroup ? '编辑分组' : '创建分组'}
        open={groupModalVisible}
        onOk={handleSubmitGroup}
        onCancel={() => {
          setGroupModalVisible(false);
          groupForm.resetFields();
        }}
        width={600}
        okText="提交"
        cancelText="取消"
      >
        <Form
          form={groupForm}
          layout="vertical"
          initialValues={{
            sort_order: 0,
            is_active: true
          }}
        >
          <Form.Item
            name="name"
            label="分组名称"
            rules={[{ required: true, message: '请输入分组名称' }]}
          >
            <Input placeholder="如：小学1年级数学课程包" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="分组描述"
          >
            <TextArea 
              rows={4} 
              placeholder="请输入分组描述" 
            />
          </Form.Item>
          
          <Form.Item
            name="sort_order"
            label="排序序号"
            tooltip="数字越小越靠前"
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          
          <Form.Item
            name="is_active"
            label="是否启用"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 预览模态框 */}
      <Modal
        title="页面头部预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewVisible(false)}>
            关闭
          </Button>
        ]}
        width={1000}
      >
        <div 
          dangerouslySetInnerHTML={{ __html: headerHtml }}
          style={{ 
            border: '1px solid #f0f0f0',
            borderRadius: '4px',
            minHeight: '200px'
          }}
        />
      </Modal>
    </div>
  );
};

export default TeachingManagement;
