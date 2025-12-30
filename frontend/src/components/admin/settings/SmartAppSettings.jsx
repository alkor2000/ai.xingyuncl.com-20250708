/**
 * 智能应用管理组件
 * 功能：管理预设AI应用，包含增删改查、发布状态切换
 * 
 * 版本：v1.2.0
 * 更新：
 * - 2025-12-30 v1.1.0 修复温度为0无法保存的问题
 * - 2025-12-30 v1.2.0 温度改为手动输入框，范围0-2
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Popconfirm,
  Tooltip,
  Alert,
  Divider,
  Row,
  Col,
  Typography
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  RocketOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  FireOutlined,
  CopyOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;
const { Text } = Typography;

/**
 * 分类配置 - 与后端数据库保持一致
 */
const CATEGORY_CONFIG = {
  '写作助手': { icon: 'EditOutlined', color: 'blue' },
  '编程开发': { icon: 'CodeOutlined', color: 'green' },
  '学习教育': { icon: 'BookOutlined', color: 'purple' },
  '办公效率': { icon: 'ScheduleOutlined', color: 'orange' },
  '创意设计': { icon: 'BulbOutlined', color: 'magenta' },
  '生活助手': { icon: 'HomeOutlined', color: 'cyan' },
  '其他': { icon: 'AppstoreOutlined', color: 'default' }
};

/**
 * 智能应用管理组件
 */
const SmartAppSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  
  // 状态管理
  const [apps, setApps] = useState([]);
  const [aiModels, setAiModels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [toggleLoading, setToggleLoading] = useState({});
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState({ category: null, is_published: null, keyword: '' });

  /**
   * 加载智能应用列表
   */
  const loadApps = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pageSize,
        ...filters
      };
      // 移除空值
      Object.keys(params).forEach(key => {
        if (params[key] === null || params[key] === '' || params[key] === undefined) {
          delete params[key];
        }
      });
      
      const response = await api.get('/admin/smart-apps', { params });
      if (response.data.success) {
        setApps(response.data.data.apps);
        setPagination({
          current: response.data.data.pagination.page,
          pageSize: response.data.data.pagination.limit,
          total: response.data.data.pagination.total
        });
      }
    } catch (error) {
      console.error('加载智能应用失败:', error);
      message.error('加载应用列表失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载AI模型列表（用于下拉选择）
   */
  const loadAiModels = async () => {
    try {
      const response = await api.get('/admin/models');
      if (response.data.success) {
        setAiModels(response.data.data.filter(m => m.is_active));
      }
    } catch (error) {
      console.error('加载AI模型失败:', error);
    }
  };

  /**
   * 加载分类列表
   */
  const loadCategories = async () => {
    try {
      const response = await api.get('/admin/smart-apps/categories');
      if (response.data.success) {
        setCategories(response.data.data);
      }
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };

  // 初始化加载
  useEffect(() => {
    loadApps();
    loadAiModels();
    loadCategories();
  }, []);

  // 筛选条件变化时重新加载
  useEffect(() => {
    loadApps(1, pagination.pageSize);
  }, [filters]);

  /**
   * 处理表单提交
   * v1.2.0 温度范围改为0-2
   */
  const handleSubmit = async (values) => {
    try {
      const submitData = {
        ...values,
        // 温度：使用typeof检查，确保0值能正确传递，范围0-2
        temperature: typeof values.temperature === 'number' ? values.temperature : 0.7,
        context_length: typeof values.context_length === 'number' ? values.context_length : 10,
        is_stream: values.is_stream !== false,
        is_published: values.is_published || false,
        sort_order: typeof values.sort_order === 'number' ? values.sort_order : 0
      };

      if (editingApp) {
        // 更新应用
        const response = await api.put(`/admin/smart-apps/${editingApp.id}`, submitData);
        if (response.data.success) {
          message.success('应用更新成功');
          setModalVisible(false);
          form.resetFields();
          setEditingApp(null);
          loadApps(pagination.current, pagination.pageSize);
        }
      } else {
        // 创建应用
        const response = await api.post('/admin/smart-apps', submitData);
        if (response.data.success) {
          message.success('应用创建成功');
          setModalVisible(false);
          form.resetFields();
          loadApps(1, pagination.pageSize);
        }
      }
    } catch (error) {
      console.error('保存应用失败:', error);
      message.error(error.response?.data?.message || '保存失败');
    }
  };

  /**
   * 切换发布状态
   */
  const handleTogglePublish = async (id, currentStatus) => {
    setToggleLoading({ ...toggleLoading, [id]: true });
    try {
      const response = await api.post(`/admin/smart-apps/${id}/toggle-publish`);
      if (response.data.success) {
        // 更新本地状态
        setApps(prevApps =>
          prevApps.map(app =>
            app.id === id
              ? { ...app, is_published: currentStatus ? 0 : 1 }
              : app
          )
        );
        message.success(currentStatus ? '应用已取消发布' : '应用已发布');
      }
    } catch (error) {
      console.error('切换发布状态失败:', error);
      message.error('操作失败');
    } finally {
      setToggleLoading({ ...toggleLoading, [id]: false });
    }
  };

  /**
   * 删除应用
   */
  const handleDelete = async (id) => {
    try {
      const response = await api.delete(`/admin/smart-apps/${id}`);
      if (response.data.success) {
        message.success('应用删除成功');
        loadApps(pagination.current, pagination.pageSize);
      }
    } catch (error) {
      console.error('删除应用失败:', error);
      message.error(error.response?.data?.message || '删除失败');
    }
  };

  /**
   * 打开编辑弹窗
   */
  const openEditModal = (app) => {
    setEditingApp(app);
    form.setFieldsValue({
      name: app.name,
      description: app.description,
      icon: app.icon,
      system_prompt: app.system_prompt,
      temperature: app.temperature,
      context_length: app.context_length,
      model_id: app.model_id,
      is_stream: app.is_stream,
      category: app.category,
      is_published: app.is_published,
      sort_order: app.sort_order
    });
    setModalVisible(true);
  };

  /**
   * 打开新增弹窗
   */
  const openAddModal = () => {
    setEditingApp(null);
    form.resetFields();
    // 设置默认值
    form.setFieldsValue({
      temperature: 0.7,
      context_length: 10,
      is_stream: true,
      is_published: false,
      sort_order: 0
    });
    setModalVisible(true);
  };

  /**
   * 复制应用
   */
  const handleCopy = (app) => {
    setEditingApp(null);
    form.setFieldsValue({
      name: `${app.name} (副本)`,
      description: app.description,
      icon: app.icon,
      system_prompt: app.system_prompt,
      temperature: app.temperature,
      context_length: app.context_length,
      model_id: app.model_id,
      is_stream: app.is_stream,
      category: app.category,
      is_published: false,
      sort_order: app.sort_order
    });
    setModalVisible(true);
  };

  /**
   * 表格列配置
   */
  const columns = [
    {
      title: '应用名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (text, record) => (
        <Space>
          <RocketOutlined style={{ color: '#1890ff' }} />
          <div>
            <div style={{ fontWeight: 500 }}>{text}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              使用次数: {record.use_count || 0}
            </Text>
          </div>
        </Space>
      )
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (category) => {
        const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG['其他'];
        return <Tag color={config.color}>{category || '未分类'}</Tag>;
      }
    },
    {
      title: 'AI模型',
      dataIndex: 'model_display_name',
      key: 'model_display_name',
      width: 150,
      render: (text, record) => (
        <Tooltip title={record.model_name}>
          <Tag color="processing">{text || record.model_name}</Tag>
        </Tooltip>
      )
    },
    {
      title: '配置',
      key: 'config',
      width: 180,
      render: (_, record) => (
        <Space size="small" wrap>
          <Tooltip title={`温度: ${record.temperature}`}>
            <Tag color="orange">T:{record.temperature}</Tag>
          </Tooltip>
          <Tooltip title={`上下文: ${record.context_length}条`}>
            <Tag color="blue">C:{record.context_length}</Tag>
          </Tooltip>
          {record.is_stream ? (
            <Tag icon={<ThunderboltOutlined />} color="green">流式</Tag>
          ) : (
            <Tag color="default">非流式</Tag>
          )}
        </Space>
      )
    },
    {
      title: '发布状态',
      dataIndex: 'is_published',
      key: 'is_published',
      width: 100,
      align: 'center',
      render: (isPublished, record) => (
        <Tooltip title={`点击${isPublished ? '取消发布' : '发布'}应用`}>
          <Switch
            checked={!!isPublished}
            onChange={() => handleTogglePublish(record.id, isPublished)}
            loading={toggleLoading[record.id] || false}
            checkedChildren={<EyeOutlined />}
            unCheckedChildren={<EyeInvisibleOutlined />}
          />
        </Tooltip>
      )
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      align: 'center'
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          <Tooltip title="复制">
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除这个应用吗？"
            description="删除后将解除与所有会话的关联"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
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

  return (
    <Card
      title={
        <Space>
          <AppstoreOutlined style={{ color: '#1890ff', fontSize: 20 }} />
          <span style={{ fontSize: 16, fontWeight: 'bold' }}>智能应用管理</span>
          <Tag color="blue">预设AI应用</Tag>
        </Space>
      }
      extra={
        <Space>
          {/* 筛选器 */}
          <Select
            placeholder="分类筛选"
            allowClear
            style={{ width: 120 }}
            onChange={(value) => setFilters({ ...filters, category: value })}
          >
            {categories.map(cat => (
              <Select.Option key={cat.id} value={cat.name}>{cat.name}</Select.Option>
            ))}
          </Select>
          <Select
            placeholder="发布状态"
            allowClear
            style={{ width: 100 }}
            onChange={(value) => setFilters({ ...filters, is_published: value })}
          >
            <Select.Option value={1}>已发布</Select.Option>
            <Select.Option value={0}>未发布</Select.Option>
          </Select>
          <Input.Search
            placeholder="搜索应用名称"
            allowClear
            style={{ width: 180 }}
            onSearch={(value) => setFilters({ ...filters, keyword: value })}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddModal}
          >
            添加应用
          </Button>
        </Space>
      }
    >
      {/* 提示信息 */}
      <Alert
        message="智能应用说明"
        description="智能应用是预设好系统提示词和参数的AI对话入口，用户可一键使用无需配置。发布后的应用将显示在用户端应用广场中。"
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />

      {/* 应用列表 */}
      <Table
        columns={columns}
        dataSource={apps}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个应用`,
          onChange: (page, pageSize) => loadApps(page, pageSize)
        }}
        scroll={{ x: 1000 }}
      />

      {/* 应用编辑弹窗 */}
      <Modal
        title={editingApp ? '编辑智能应用' : '添加智能应用'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingApp(null);
        }}
        onOk={() => form.submit()}
        width={800}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="应用名称"
                rules={[{ required: true, message: '请输入应用名称' }]}
              >
                <Input placeholder="如：论文写作助手" maxLength={100} showCount />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category"
                label="应用分类"
              >
                <Select placeholder="选择分类" allowClear>
                  {Object.keys(CATEGORY_CONFIG).map(cat => (
                    <Select.Option key={cat} value={cat}>
                      <Tag color={CATEGORY_CONFIG[cat].color}>{cat}</Tag>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label="应用描述"
          >
            <TextArea 
              rows={2} 
              placeholder="简要描述应用的功能和用途" 
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="model_id"
            label="AI模型"
            rules={[{ required: true, message: '请选择AI模型' }]}
          >
            <Select placeholder="选择模型">
              {aiModels.map(model => (
                <Select.Option key={model.id} value={model.id}>
                  <Space>
                    <FireOutlined style={{ color: '#ff4d4f' }} />
                    {model.display_name || model.name}
                    <Tag color="blue">{model.credits_per_chat}积分/次</Tag>
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Divider orientation="left">系统提示词</Divider>

          <Form.Item
            name="system_prompt"
            label="系统提示词 (System Prompt)"
            extra="定义AI的角色、行为和回复风格，对用户不可见"
          >
            <TextArea 
              rows={6} 
              placeholder="你是一个专业的写作助手，擅长帮助用户撰写论文、报告和文章..."
              maxLength={10000}
              showCount
            />
          </Form.Item>

          <Divider orientation="left">参数配置</Divider>

          <Row gutter={16}>
            <Col span={12}>
              {/* v1.2.0 温度改为手动输入框，范围0-2 */}
              <Form.Item
                name="temperature"
                label={
                  <Space>
                    温度 (Temperature)
                    <Tooltip title="控制输出的随机性，0更确定，2更随机。推荐值：精确任务0-0.3，平衡0.5-0.7，创意1-2">
                      <span style={{ color: '#8c8c8c', cursor: 'help' }}>?</span>
                    </Tooltip>
                  </Space>
                }
                extra="范围 0-2，值越小回复越确定，值越大回复越随机"
              >
                <InputNumber 
                  min={0} 
                  max={2} 
                  step={0.1}
                  precision={1}
                  style={{ width: '100%' }} 
                  placeholder="0.7"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="context_length"
                label={
                  <Space>
                    上下文条数
                    <Tooltip title="携带多少条历史消息作为上下文">
                      <span style={{ color: '#8c8c8c', cursor: 'help' }}>?</span>
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber 
                  min={0} 
                  max={100} 
                  style={{ width: '100%' }} 
                  placeholder="10"
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="is_stream"
                label="流式输出"
                valuePropName="checked"
              >
                <Switch 
                  checkedChildren={<ThunderboltOutlined />} 
                  unCheckedChildren="关"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="is_published"
                label="发布状态"
                valuePropName="checked"
              >
                <Switch 
                  checkedChildren={<EyeOutlined />} 
                  unCheckedChildren={<EyeInvisibleOutlined />}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="sort_order"
                label="排序"
                extra="数字越小越靠前"
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="icon"
            label="应用图标URL"
            extra="可选，留空使用默认图标"
          >
            <Input placeholder="https://example.com/icon.png" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default SmartAppSettings;
