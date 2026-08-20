/**
 * 智能应用管理组件
 * 功能：管理预设AI应用，包含增删改查、发布状态切换、分类管理
 *
 * 国际化关键决策：
 * 1. 两个 useEffect（初始化加载、筛选变化重载）依赖数组绝不含 t。
 *    它们是渲染副作用型 effect，若加入 t，语言切换时会重复请求应用列表与分类列表。
 * 2. columns / colorPresets / pagination 均在渲染期构建（普通 const，非 useMemo），
 *    因此内部 t() 天然跟随语言切换，无需维护依赖数组。
 * 3. 移除全部 `error.response?.data?.message || '中文兜底'` 形式。
 *    后端 message 恒为中文，故拆为「无原因」与「带原因」两个键，
 *    冒号写在译文内（中文全角"："/英文半角": "），不在 JS 中拼接。
 * 4. 原 `点击${isPublished ? '取消发布' : '发布'}应用` 属 JSX 内三元拼接，
 *    英文语序为 "Click to publish this app"，无法同构拼出，故拆为两条完整句子。
 * 5. 数值上限统一抽为模块常量，并以 {{min}}/{{max}} 插值传入文案，
 *    避免"改了校验没改提示文字"的不一致。
 * 6. 不翻译：分类名、分类配色、模型 display_name/model_name、应用名称
 *    （均为后台录入的业务数据）；图标 URL 示例属技术标识；"?" 为视觉符号留在 JSX。
 * 7. console.error 一律改英文——开发者日志与界面文案职责分离，
 *    不应随语言切换变化，也不应占用语言包。
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
  Typography,
  ColorPicker,
  List,
  Drawer
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
  CopyOutlined,
  BgColorsOutlined,
  DollarOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';

const { TextArea } = Input;
const { Text } = Typography;

// ==================== 业务规则常量 ====================
// 与后端 SmartApp 模型校验保持一致；同时作为插值参数传入文案，
// 保证界面提示的数字与实际校验规则永不脱节

/** 单个应用最多可绑定的分类数（后端 category_ids 上限） */
const MAX_CATEGORIES = 3;

/** 应用积分区间；0 表示免费 */
const CREDITS_MIN = 0;
const CREDITS_MAX = 9999;
/** 免费阈值，用于积分说明文案的 {{free}} 插值 */
const CREDITS_FREE_VALUE = 0;

/** 温度区间与步进 */
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;
const TEMPERATURE_STEP = 0.1;
const TEMPERATURE_PRECISION = 1;

/** 上下文条数区间 */
const CONTEXT_MIN = 0;
const CONTEXT_MAX = 100;

/** 新建应用时的表单默认值 */
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_CONTEXT_LENGTH = 10;
const DEFAULT_SORT_ORDER = 0;

/** 文本长度上限（与数据库字段长度对应） */
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;
const SYSTEM_PROMPT_MAX_LENGTH = 10000;
const CATEGORY_NAME_MAX_LENGTH = 50;

/** 分页默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;

/** 分类默认配色（同时用于 ColorPicker 兜底） */
const DEFAULT_CATEGORY_COLOR = '#1677ff';

/**
 * ColorPicker 推荐配色。
 * 纯十六进制色值属技术数据，不进语言包；
 * 但其分组标题"推荐颜色"是界面文案，须在渲染期用 t() 生成（见 colorPresets）。
 */
const PRESET_COLORS = [
  '#1677ff', '#52c41a', '#722ed1', '#fa8c16',
  '#eb2f96', '#13c2c2', '#8c8c8c', '#faad14',
  '#f5222d', '#2f54eb', '#a0d911', '#fa541c'
];

// ==================== 布局尺寸常量 ====================
const TABLE_SCROLL_X = 1100;
const APP_MODAL_WIDTH = 800;
const CATEGORY_MODAL_WIDTH = 400;
const CATEGORY_DRAWER_WIDTH = 400;

/**
 * 智能应用管理组件
 */
const SmartAppSettings = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [categoryForm] = Form.useForm();

  // 状态管理
  const [apps, setApps] = useState([]);
  const [aiModels, setAiModels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [toggleLoading, setToggleLoading] = useState({});
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0
  });
  const [filters, setFilters] = useState({
    category_id: null,
    is_published: null,
    keyword: ''
  });

  // 分类管理状态
  const [categoryDrawerVisible, setCategoryDrawerVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);

  /**
   * 从接口错误中提取后端返回的原因文本。
   * 后端 message 恒为中文，不作为界面主文案，仅作为「带原因」句式的插值内容。
   */
  const extractReason = (error) => error?.response?.data?.message || '';

  /**
   * 加载智能应用列表
   */
  const loadApps = async (page = 1, pageSize = DEFAULT_PAGE_SIZE) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pageSize,
        ...filters
      };
      // 移除空值，避免后端把空字符串当作有效筛选条件
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
      console.error('Failed to load smart apps:', error);
      message.error(t('admin.smartApps.msg.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载AI模型列表（仅保留已激活模型供选择）
   */
  const loadAiModels = async () => {
    try {
      const response = await api.get('/admin/models');
      if (response.data.success) {
        setAiModels(response.data.data.filter(m => m.is_active));
      }
    } catch (error) {
      console.error('Failed to load AI models:', error);
    }
  };

  /**
   * 加载分类列表
   */
  const loadCategories = async () => {
    try {
      const response = await api.get('/admin/smart-apps/categories');
      if (response.data.success) {
        setCategories(response.data.data || []);
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  // 初始化加载
  // 依赖数组保持为空：这是渲染副作用型 effect，若加入 t，
  // 语言切换时会重复发起三次列表请求
  useEffect(() => {
    loadApps();
    loadAiModels();
    loadCategories();
  }, []);

  // 筛选条件变化时重新加载
  // 同上，依赖只能是 filters，不可含 t
  useEffect(() => {
    loadApps(1, pagination.pageSize);
  }, [filters]);

  /**
   * 处理应用表单提交（新建与编辑共用）
   */
  const handleSubmit = async (values) => {
    try {
      const submitData = {
        ...values,
        temperature: typeof values.temperature === 'number'
          ? values.temperature
          : DEFAULT_TEMPERATURE,
        context_length: typeof values.context_length === 'number'
          ? values.context_length
          : DEFAULT_CONTEXT_LENGTH,
        is_stream: values.is_stream !== false,
        is_published: values.is_published || false,
        sort_order: typeof values.sort_order === 'number'
          ? values.sort_order
          : DEFAULT_SORT_ORDER,
        category_ids: values.category_ids || [],
        credits_per_use: typeof values.credits_per_use === 'number'
          ? values.credits_per_use
          : CREDITS_MIN
      };

      if (editingApp) {
        const response = await api.put(`/admin/smart-apps/${editingApp.id}`, submitData);
        if (response.data.success) {
          message.success(t('admin.smartApps.msg.updateSuccess'));
          setModalVisible(false);
          form.resetFields();
          setEditingApp(null);
          loadApps(pagination.current, pagination.pageSize);
        }
      } else {
        const response = await api.post('/admin/smart-apps', submitData);
        if (response.data.success) {
          message.success(t('admin.smartApps.msg.createSuccess'));
          setModalVisible(false);
          form.resetFields();
          loadApps(1, pagination.pageSize);
        }
      }
    } catch (error) {
      console.error('Failed to save smart app:', error);
      const reason = extractReason(error);
      message.error(
        reason
          ? t('admin.smartApps.msg.saveFailedWithReason', { reason })
          : t('admin.smartApps.msg.saveFailed')
      );
    }
  };

  /**
   * 切换发布状态（本地乐观更新，避免整表重拉）
   */
  const handleTogglePublish = async (id, currentStatus) => {
    setToggleLoading({ ...toggleLoading, [id]: true });
    try {
      const response = await api.post(`/admin/smart-apps/${id}/toggle-publish`);
      if (response.data.success) {
        setApps(prevApps =>
          prevApps.map(app =>
            app.id === id
              ? { ...app, is_published: currentStatus ? 0 : 1 }
              : app
          )
        );
        message.success(
          currentStatus
            ? t('admin.smartApps.msg.unpublished')
            : t('admin.smartApps.msg.published')
        );
      }
    } catch (error) {
      console.error('Failed to toggle publish status:', error);
      message.error(t('common.operationFailed'));
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
        message.success(t('admin.smartApps.msg.deleteSuccess'));
        loadApps(pagination.current, pagination.pageSize);
      }
    } catch (error) {
      console.error('Failed to delete smart app:', error);
      const reason = extractReason(error);
      message.error(
        reason
          ? t('admin.smartApps.msg.deleteFailedWithReason', { reason })
          : t('admin.smartApps.msg.deleteFailed')
      );
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
      category_ids: app.category_ids || [],
      credits_per_use: app.credits_per_use || CREDITS_MIN,
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
    form.setFieldsValue({
      temperature: DEFAULT_TEMPERATURE,
      context_length: DEFAULT_CONTEXT_LENGTH,
      is_stream: true,
      is_published: false,
      sort_order: DEFAULT_SORT_ORDER,
      category_ids: [],
      credits_per_use: CREDITS_MIN
    });
    setModalVisible(true);
  };

  /**
   * 复制应用：以现有应用为模板打开新建弹窗。
   * 副本名称经 copyName 整句插值生成（中英括号形态不同，不可 JS 拼接）；
   * 该名称会成为数据库中的应用名，但不参与任何匹配逻辑，故可随语言变化。
   */
  const handleCopy = (app) => {
    setEditingApp(null);
    form.setFieldsValue({
      name: t('admin.smartApps.copyName', { name: app.name }),
      description: app.description,
      icon: app.icon,
      system_prompt: app.system_prompt,
      temperature: app.temperature,
      context_length: app.context_length,
      model_id: app.model_id,
      is_stream: app.is_stream,
      category_ids: app.category_ids || [],
      credits_per_use: app.credits_per_use || CREDITS_MIN,
      is_published: false,
      sort_order: app.sort_order
    });
    setModalVisible(true);
  };

  // ==================== 分类管理方法 ====================

  /**
   * 保存分类（新建与编辑共用）
   */
  const handleSaveCategory = async (values) => {
    setCategoryLoading(true);
    try {
      // ColorPicker 受控值可能是字符串或 Color 对象，需统一为十六进制字符串
      const color = typeof values.color === 'string'
        ? values.color
        : values.color?.toHexString?.() || DEFAULT_CATEGORY_COLOR;

      const data = {
        name: values.name,
        color,
        sort_order: values.sort_order || DEFAULT_SORT_ORDER
      };

      if (editingCategory) {
        const response = await api.put(
          `/admin/smart-apps/categories/${editingCategory.id}`,
          data
        );
        if (response.data.success) {
          message.success(t('admin.smartApps.category.msg.updateSuccess'));
        }
      } else {
        const response = await api.post('/admin/smart-apps/categories', data);
        if (response.data.success) {
          message.success(t('admin.smartApps.category.msg.createSuccess'));
        }
      }

      setCategoryModalVisible(false);
      categoryForm.resetFields();
      setEditingCategory(null);
      loadCategories();
    } catch (error) {
      console.error('Failed to save category:', error);
      const reason = extractReason(error);
      message.error(
        reason
          ? t('admin.smartApps.msg.saveFailedWithReason', { reason })
          : t('admin.smartApps.msg.saveFailed')
      );
    } finally {
      setCategoryLoading(false);
    }
  };

  /**
   * 删除分类
   */
  const handleDeleteCategory = async (id) => {
    try {
      const response = await api.delete(`/admin/smart-apps/categories/${id}`);
      if (response.data.success) {
        message.success(t('admin.smartApps.category.msg.deleteSuccess'));
        loadCategories();
      }
    } catch (error) {
      console.error('Failed to delete category:', error);
      const reason = extractReason(error);
      message.error(
        reason
          ? t('admin.smartApps.msg.deleteFailedWithReason', { reason })
          : t('admin.smartApps.msg.deleteFailed')
      );
    }
  };

  /**
   * 打开分类编辑弹窗
   */
  const openCategoryModal = (category = null) => {
    setEditingCategory(category);
    if (category) {
      categoryForm.setFieldsValue({
        name: category.name,
        color: category.color,
        sort_order: category.sort_order
      });
    } else {
      categoryForm.resetFields();
      categoryForm.setFieldsValue({
        color: DEFAULT_CATEGORY_COLOR,
        sort_order: DEFAULT_SORT_ORDER
      });
    }
    setCategoryModalVisible(true);
  };

  /**
   * ColorPicker 推荐配色分组。
   * 在渲染期构建：分组标题走 t()，色值取自模块常量。
   */
  const colorPresets = [
    {
      label: t('admin.smartApps.category.form.color.preset'),
      colors: PRESET_COLORS
    }
  ];

  /**
   * 表格列配置。
   * 保持为渲染期普通 const（非 useMemo）：内部 t() 天然跟随语言切换，
   * 无需维护 t 依赖，也避免了 useMemo 漏加依赖导致文案不刷新的风险。
   */
  const columns = [
    {
      title: t('admin.smartApps.columns.name'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (text, record) => (
        <Space>
          <RocketOutlined style={{ color: '#1890ff' }} />
          <div>
            {/* 应用名称为后台录入的业务数据，不翻译 */}
            <div style={{ fontWeight: 500 }}>{text}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('admin.smartApps.useCount', { count: record.use_count || 0 })}
            </Text>
          </div>
        </Space>
      )
    },
    {
      title: t('admin.smartApps.columns.categories'),
      dataIndex: 'categories',
      key: 'categories',
      width: 150,
      render: (cats) => (
        <Space size={[0, 4]} wrap>
          {cats && cats.length > 0 ? (
            /* 分类名称与配色均为后台录入的业务数据，不翻译 */
            cats.map(cat => (
              <Tag key={cat.id} color={cat.color}>{cat.name}</Tag>
            ))
          ) : (
            <Tag color="default">{t('admin.smartApps.uncategorized')}</Tag>
          )}
        </Space>
      )
    },
    {
      title: t('admin.smartApps.columns.model'),
      dataIndex: 'model_display_name',
      key: 'model_display_name',
      width: 150,
      /* 模型显示名与模型标识均为业务数据/技术标识，不翻译 */
      render: (text, record) => (
        <Tooltip title={record.model_name}>
          <Tag color="processing">{text || record.model_name}</Tag>
        </Tooltip>
      )
    },
    {
      title: t('admin.smartApps.columns.config'),
      key: 'config',
      width: 220,
      render: (_, record) => (
        <Space size="small" wrap>
          <Tooltip title={t('admin.smartApps.tooltip.temperature', { value: record.temperature })}>
            {/* T: / C: 为参数缩写标识，不翻译 */}
            <Tag color="orange">T:{record.temperature}</Tag>
          </Tooltip>
          <Tooltip title={t('admin.smartApps.tooltip.context', { count: record.context_length })}>
            <Tag color="blue">C:{record.context_length}</Tag>
          </Tooltip>
          {record.is_stream ? (
            <Tag icon={<ThunderboltOutlined />} color="green">
              {t('admin.smartApps.stream')}
            </Tag>
          ) : (
            <Tag color="default">{t('admin.smartApps.nonStream')}</Tag>
          )}
          <Tooltip title={t('admin.smartApps.tooltip.credits', { credits: record.credits_per_use })}>
            <Tag
              icon={<DollarOutlined />}
              color={record.credits_per_use > 0 ? 'gold' : 'default'}
            >
              {t('admin.smartApps.creditsTag', { credits: record.credits_per_use })}
            </Tag>
          </Tooltip>
        </Space>
      )
    },
    {
      title: t('admin.smartApps.columns.published'),
      dataIndex: 'is_published',
      key: 'is_published',
      width: 100,
      align: 'center',
      render: (isPublished, record) => (
        /* 原为 `点击${isPublished ? '取消发布' : '发布'}应用` 三元拼接，
           英文语序不同（Click to publish this app），故改为两条完整句子 */
        <Tooltip
          title={
            isPublished
              ? t('admin.smartApps.tooltip.clickToUnpublish')
              : t('admin.smartApps.tooltip.clickToPublish')
          }
        >
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
      title: t('admin.smartApps.columns.sortOrder'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      align: 'center'
    },
    {
      title: t('common.operation'),
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title={t('admin.smartApps.action.edit')}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          <Tooltip title={t('admin.smartApps.action.copy')}>
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('admin.smartApps.deleteConfirm')}
            description={t('admin.smartApps.deleteConfirmDesc')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('admin.smartApps.confirmOk')}
            cancelText={t('admin.smartApps.confirmCancel')}
          >
            <Tooltip title={t('admin.smartApps.action.delete')}>
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
          <span style={{ fontSize: 16, fontWeight: 'bold' }}>
            {t('admin.smartApps.title')}
          </span>
          <Tag color="blue">{t('admin.smartApps.titleTag')}</Tag>
        </Space>
      }
      extra={
        <Space>
          {/* 分类筛选 */}
          <Select
            placeholder={t('admin.smartApps.filter.category')}
            allowClear
            style={{ width: 120 }}
            onChange={(value) => setFilters({ ...filters, category_id: value })}
          >
            {categories.map(cat => (
              <Select.Option key={cat.id} value={cat.id}>
                <Tag color={cat.color}>{cat.name}</Tag>
              </Select.Option>
            ))}
          </Select>
          <Select
            placeholder={t('admin.smartApps.filter.status')}
            allowClear
            style={{ width: 100 }}
            onChange={(value) => setFilters({ ...filters, is_published: value })}
          >
            <Select.Option value={1}>{t('admin.smartApps.published')}</Select.Option>
            <Select.Option value={0}>{t('admin.smartApps.unpublished')}</Select.Option>
          </Select>
          <Input.Search
            placeholder={t('admin.smartApps.searchPlaceholder')}
            allowClear
            style={{ width: 180 }}
            onSearch={(value) => setFilters({ ...filters, keyword: value })}
          />
          {/* 管理分类按钮 */}
          <Tooltip title={t('admin.smartApps.manageCategories')}>
            <Button
              icon={<BgColorsOutlined />}
              onClick={() => setCategoryDrawerVisible(true)}
            >
              {t('admin.smartApps.manageCategories')}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddModal}
          >
            {t('admin.smartApps.addApp')}
          </Button>
        </Space>
      }
    >
      {/* 说明信息：分类上限走 {{maxCategories}} 插值，与 MAX_CATEGORIES 常量绑定 */}
      <Alert
        message={t('admin.smartApps.alert.title')}
        description={t('admin.smartApps.alert.description', {
          maxCategories: MAX_CATEGORIES
        })}
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
          showTotal: (total) => t('admin.smartApps.totalCount', { total }),
          onChange: (page, pageSize) => loadApps(page, pageSize)
        }}
        scroll={{ x: TABLE_SCROLL_X }}
      />

      {/* 应用编辑弹窗 */}
      <Modal
        title={
          editingApp
            ? t('admin.smartApps.modal.editTitle')
            : t('admin.smartApps.modal.addTitle')
        }
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingApp(null);
        }}
        onOk={() => form.submit()}
        width={APP_MODAL_WIDTH}
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
                label={t('admin.smartApps.form.name')}
                rules={[{ required: true, message: t('admin.smartApps.form.name.required') }]}
              >
                <Input
                  placeholder={t('admin.smartApps.form.name.placeholder')}
                  maxLength={NAME_MAX_LENGTH}
                  showCount
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category_ids"
                label={t('admin.smartApps.form.categories')}
                extra={t('admin.smartApps.form.categories.extra', { max: MAX_CATEGORIES })}
              >
                <Select
                  mode="multiple"
                  placeholder={t('admin.smartApps.form.categories.placeholder')}
                  allowClear
                  maxTagCount={MAX_CATEGORIES}
                >
                  {categories.map(cat => (
                    <Select.Option key={cat.id} value={cat.id}>
                      <Tag color={cat.color}>{cat.name}</Tag>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="description"
            label={t('admin.smartApps.form.description')}
          >
            <TextArea
              rows={2}
              placeholder={t('admin.smartApps.form.description.placeholder')}
              maxLength={DESCRIPTION_MAX_LENGTH}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="model_id"
            label={t('admin.smartApps.form.model')}
            rules={[{ required: true, message: t('admin.smartApps.form.model.required') }]}
          >
            <Select placeholder={t('admin.smartApps.form.model.placeholder')}>
              {aiModels.map(model => (
                <Select.Option key={model.id} value={model.id}>
                  <Space>
                    <FireOutlined style={{ color: '#ff4d4f' }} />
                    {/* 模型显示名为业务数据，不翻译 */}
                    {model.display_name || model.name}
                    <Tag color="blue">
                      {t('admin.smartApps.creditsPerChat', {
                        credits: model.credits_per_chat
                      })}
                    </Tag>
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Divider orientation="left">
            {t('admin.smartApps.divider.systemPrompt')}
          </Divider>

          <Form.Item
            name="system_prompt"
            label={t('admin.smartApps.form.systemPrompt')}
            extra={t('admin.smartApps.form.systemPrompt.extra')}
          >
            <TextArea
              rows={6}
              placeholder={t('admin.smartApps.form.systemPrompt.placeholder')}
              maxLength={SYSTEM_PROMPT_MAX_LENGTH}
              showCount
            />
          </Form.Item>

          <Divider orientation="left">
            {t('admin.smartApps.divider.params')}
          </Divider>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="temperature"
                label={
                  <Space>
                    {t('admin.smartApps.form.temperature')}
                    <Tooltip
                      title={t('admin.smartApps.form.temperature.tooltip', {
                        min: TEMPERATURE_MIN,
                        max: TEMPERATURE_MAX
                      })}
                    >
                      {/* "?" 为视觉符号，不进语言包 */}
                      <span style={{ color: '#8c8c8c', cursor: 'help' }}>?</span>
                    </Tooltip>
                  </Space>
                }
                extra={t('admin.smartApps.form.rangeHint', {
                  min: TEMPERATURE_MIN,
                  max: TEMPERATURE_MAX
                })}
              >
                <InputNumber
                  min={TEMPERATURE_MIN}
                  max={TEMPERATURE_MAX}
                  step={TEMPERATURE_STEP}
                  precision={TEMPERATURE_PRECISION}
                  style={{ width: '100%' }}
                  placeholder={String(DEFAULT_TEMPERATURE)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="context_length"
                label={t('admin.smartApps.form.contextLength')}
              >
                <InputNumber
                  min={CONTEXT_MIN}
                  max={CONTEXT_MAX}
                  style={{ width: '100%' }}
                  placeholder={String(DEFAULT_CONTEXT_LENGTH)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="credits_per_use"
                label={
                  <Space>
                    {t('admin.smartApps.form.credits')}
                    <Tooltip
                      title={t('admin.smartApps.form.credits.tooltip', {
                        free: CREDITS_FREE_VALUE
                      })}
                    >
                      <span style={{ color: '#8c8c8c', cursor: 'help' }}>?</span>
                    </Tooltip>
                  </Space>
                }
                extra={t('admin.smartApps.form.rangeHint', {
                  min: CREDITS_MIN,
                  max: CREDITS_MAX
                })}
              >
                <InputNumber
                  min={CREDITS_MIN}
                  max={CREDITS_MAX}
                  style={{ width: '100%' }}
                  placeholder={String(CREDITS_MIN)}
                  addonAfter={t('admin.smartApps.form.credits.addon')}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="is_stream"
                label={t('admin.smartApps.form.stream')}
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<ThunderboltOutlined />}
                  unCheckedChildren={t('admin.smartApps.switch.off')}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="is_published"
                label={t('admin.smartApps.form.published')}
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
                label={t('admin.smartApps.form.sortOrder')}
                extra={t('admin.smartApps.form.sortOrder.extra')}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="icon"
            label={t('admin.smartApps.form.icon')}
            extra={t('admin.smartApps.form.icon.extra')}
          >
            {/* URL 示例属技术标识，不翻译 */}
            <Input placeholder="https://example.com/icon.png" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分类管理抽屉 */}
      <Drawer
        title={
          <Space>
            <BgColorsOutlined />
            {t('admin.smartApps.category.drawerTitle')}
          </Space>
        }
        placement="right"
        width={CATEGORY_DRAWER_WIDTH}
        open={categoryDrawerVisible}
        onClose={() => setCategoryDrawerVisible(false)}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openCategoryModal()}
          >
            {t('admin.smartApps.category.add')}
          </Button>
        }
      >
        <List
          dataSource={categories}
          renderItem={(cat) => (
            <List.Item
              actions={[
                <Button
                  key="edit"
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openCategoryModal(cat)}
                />,
                <Popconfirm
                  key="delete"
                  title={t('admin.smartApps.category.deleteConfirm')}
                  description={t('admin.smartApps.category.deleteConfirmDesc')}
                  onConfirm={() => handleDeleteCategory(cat.id)}
                  okText={t('admin.smartApps.confirmOk')}
                  cancelText={t('admin.smartApps.confirmCancel')}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                avatar={
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: cat.color
                    }}
                  />
                }
                /* 分类名称为业务数据，不翻译 */
                title={cat.name}
                description={t('admin.smartApps.category.sortLabel', {
                  order: cat.sort_order
                })}
              />
            </List.Item>
          )}
        />
      </Drawer>

      {/* 分类编辑弹窗 */}
      <Modal
        title={
          editingCategory
            ? t('admin.smartApps.category.editTitle')
            : t('admin.smartApps.category.addTitle')
        }
        open={categoryModalVisible}
        onCancel={() => {
          setCategoryModalVisible(false);
          categoryForm.resetFields();
          setEditingCategory(null);
        }}
        onOk={() => categoryForm.submit()}
        confirmLoading={categoryLoading}
        width={CATEGORY_MODAL_WIDTH}
      >
        <Form
          form={categoryForm}
          layout="vertical"
          onFinish={handleSaveCategory}
        >
          <Form.Item
            name="name"
            label={t('admin.smartApps.category.form.name')}
            rules={[
              { required: true, message: t('admin.smartApps.category.form.name.required') }
            ]}
          >
            <Input
              placeholder={t('admin.smartApps.category.form.name.placeholder')}
              maxLength={CATEGORY_NAME_MAX_LENGTH}
            />
          </Form.Item>

          <Form.Item
            name="color"
            label={t('admin.smartApps.category.form.color')}
          >
            <ColorPicker
              showText
              format="hex"
              presets={colorPresets}
            />
          </Form.Item>

          <Form.Item
            name="sort_order"
            label={t('admin.smartApps.form.sortOrder')}
            extra={t('admin.smartApps.form.sortOrder.extra')}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default SmartAppSettings;
