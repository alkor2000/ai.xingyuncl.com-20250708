/**
 * 教学管理后台组件（增强版）
 * 新增功能：页面头部HTML配置（Monaco Editor + 实时预览）
 * 功能：全局教学数据管理、批量操作、统计概览
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
  Divider,
  Alert
} from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  InboxOutlined,
  UserOutlined,
  TeamOutlined,
  FireOutlined,
  RiseOutlined,
  SearchOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  SaveOutlined,
  UndoOutlined
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
    fetchAllModules,
    updateModule,
    deleteModule,
    batchUpdateModules
  } = useTeachingStore();
  
  const { systemConfig, updateSystemConfig } = useSystemConfigStore();

  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    status: null,
    visibility: null,
    creator: null
  });
  const [statistics, setStatistics] = useState({
    totalModules: 0,
    totalLessons: 0,
    todayViews: 0,
    weeklyNew: 0,
    activeUsers: [],
    hotModules: []
  });
  
  // 页面头部HTML配置
  const [headerHtml, setHeaderHtml] = useState('');
  const [headerHtmlLoading, setHeaderHtmlLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);

  // 初始加载
  useEffect(() => {
    loadData();
    
    // 加载当前页面头部HTML配置
    const currentHeaderHtml = systemConfig?.teaching_page_header_html || '';
    setHeaderHtml(currentHeaderHtml);
  }, [systemConfig]);

  // 加载数据
  const loadData = async () => {
    try {
      await fetchAllModules();
    } catch (error) {
      message.error(t('teaching.loadFailed'));
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

      const hotModules = [...allModules]
        .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        .slice(0, 10);

      setStatistics({
        totalModules: allModules.length,
        totalLessons,
        todayViews,
        weeklyNew,
        activeUsers: [],
        hotModules
      });
    }
  }, [allModules]);

  // 批量更新状态
  const handleBatchUpdateStatus = async (status) => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('teaching.selectModules'));
      return;
    }

    try {
      await batchUpdateModules(selectedRowKeys, { status });
      message.success(t('teaching.batchUpdateSuccess'));
      setSelectedRowKeys([]);
      loadData();
    } catch (error) {
      message.error(t('teaching.batchUpdateFailed'));
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('teaching.selectModules'));
      return;
    }

    Modal.confirm({
      title: t('teaching.confirmBatchDelete'),
      content: t('teaching.confirmBatchDeleteContent', { count: selectedRowKeys.length }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const id of selectedRowKeys) {
            await deleteModule(id);
          }
          message.success(t('teaching.batchDeleteSuccess'));
          setSelectedRowKeys([]);
          loadData();
        } catch (error) {
          message.error(t('teaching.batchDeleteFailed'));
        }
      }
    });
  };

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
        message.success(t('teaching.header.saveSuccess'));
      } else {
        message.error(result.error || t('teaching.header.saveFailed'));
      }
    } catch (error) {
      message.error(t('teaching.header.saveFailed'));
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
    <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
      <input 
        type="text" 
        placeholder="搜索模块名称或课程标签" 
        style="flex: 1; max-width: 500px; padding: 12px 20px; border: 2px solid #e0e0e0; border-radius: 24px; font-size: 14px; outline: none; transition: border-color 0.3s;"
        onfocus="this.style.borderColor='#1890ff'"
        onblur="this.style.borderColor='#e0e0e0'"
      />
      <button 
        style="background: #1890ff; color: white; padding: 12px 32px; border: none; border-radius: 24px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.3s;"
        onmouseover="this.style.background='#40a9ff'"
        onmouseout="this.style.background='#1890ff'"
        onclick="window.location.reload()"
      >
        🔄 刷新课程
      </button>
    </div>
  </div>
</div>`;
    
    setHeaderHtml(defaultTemplate);
    message.success(t('teaching.header.resetSuccess'));
  };

  // 过滤数据
  const filteredModules = allModules.filter(module => {
    if (filters.search && !module.name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters.status && module.status !== filters.status) {
      return false;
    }
    if (filters.visibility && module.visibility !== filters.visibility) {
      return false;
    }
    return true;
  });

  // 表格列配置
  const columns = [
    {
      title: t('teaching.moduleName'),
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
      title: t('teaching.creator'),
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 120
    },
    {
      title: t('teaching.visibility.label'),
      dataIndex: 'visibility',
      key: 'visibility',
      width: 100,
      render: (visibility) => (
        <Tag color={
          visibility === 'public' ? 'green' :
          visibility === 'group' ? 'blue' :
          'orange'
        }>
          {t(`teaching.visibility.${visibility}`)}
        </Tag>
      )
    },
    {
      title: t('teaching.status.label'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={
          status === 'draft' ? 'default' :
          status === 'published' ? 'success' :
          'error'
        }>
          {t(`teaching.status.${status}`)}
        </Tag>
      )
    },
    {
      title: t('teaching.lessonCount'),
      dataIndex: 'lesson_count',
      key: 'lesson_count',
      width: 100,
      sorter: (a, b) => (a.lesson_count || 0) - (b.lesson_count || 0),
      render: (count) => (
        <Badge count={count || 0} showZero style={{ backgroundColor: '#52c41a' }} />
      )
    },
    {
      title: t('teaching.viewCount'),
      dataIndex: 'view_count',
      key: 'view_count',
      width: 100,
      sorter: (a, b) => (a.view_count || 0) - (b.view_count || 0)
    },
    {
      title: t('teaching.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      sorter: (a, b) => moment(a.created_at).unix() - moment(b.created_at).unix(),
      render: (date) => moment(date).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title={t('teaching.view')}>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/teaching/modules/${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title={t('teaching.confirmDeleteModule')}
            onConfirm={async () => {
              try {
                await deleteModule(record.id);
                message.success(t('teaching.deleteSuccess'));
                loadData();
              } catch (error) {
                message.error(t('teaching.deleteFailed'));
              }
            }}
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

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('teaching.totalModules')}
              value={statistics.totalModules}
              prefix={<BookOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('teaching.totalLessons')}
              value={statistics.totalLessons}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('teaching.totalViews')}
              value={statistics.todayViews}
              prefix={<EyeOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('teaching.weeklyNew')}
              value={statistics.weeklyNew}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 页面头部HTML配置（新增） */}
      <Card
        title={
          <Space>
            <CodeOutlined />
            {t('teaching.header.title')}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<UndoOutlined />}
              onClick={handleResetToDefault}
            >
              {t('teaching.header.resetToDefault')}
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={() => setPreviewVisible(true)}
            >
              {t('teaching.header.preview')}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={headerHtmlLoading}
              onClick={handleSaveHeaderHtml}
            >
              {t('common.save')}
            </Button>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          message={t('teaching.header.tips')}
          description={t('teaching.header.description')}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        
        <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', overflow: 'hidden' }}>
          <MonacoEditor
            height="400px"
            language="html"
            value={headerHtml}
            onChange={(value) => setHeaderHtml(value || '')}
            onMount={() => setEditorMounted(true)}
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
        
        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
          {t('teaching.header.editorTip')}
        </div>
      </Card>

      {/* 模块管理表格 */}
      <Card
        title={
          <Space>
            <BookOutlined />
            {t('teaching.allModules')}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadData}
            >
              {t('common.refresh')}
            </Button>
          </Space>
        }
      >
        {/* 筛选栏 */}
        <Space style={{ marginBottom: 16, width: '100%' }} wrap>
          <Search
            placeholder={t('teaching.searchModules')}
            allowClear
            style={{ width: 300 }}
            onSearch={(value) => setFilters({ ...filters, search: value })}
            onChange={(e) => {
              if (!e.target.value) {
                setFilters({ ...filters, search: '' });
              }
            }}
          />
          <Select
            placeholder={t('teaching.status.label')}
            allowClear
            style={{ width: 120 }}
            onChange={(value) => setFilters({ ...filters, status: value })}
          >
            <Option value="draft">{t('teaching.status.draft')}</Option>
            <Option value="published">{t('teaching.status.published')}</Option>
            <Option value="archived">{t('teaching.status.archived')}</Option>
          </Select>
          <Select
            placeholder={t('teaching.visibility.label')}
            allowClear
            style={{ width: 120 }}
            onChange={(value) => setFilters({ ...filters, visibility: value })}
          >
            <Option value="private">{t('teaching.visibility.private')}</Option>
            <Option value="group">{t('teaching.visibility.group')}</Option>
            <Option value="public">{t('teaching.visibility.public')}</Option>
          </Select>
        </Space>

        {/* 批量操作栏 */}
        {selectedRowKeys.length > 0 && (
          <Space style={{ marginBottom: 16 }}>
            <span>{t('teaching.selectedCount', { count: selectedRowKeys.length })}</span>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => handleBatchUpdateStatus('published')}
            >
              {t('teaching.batchPublish')}
            </Button>
            <Button
              icon={<InboxOutlined />}
              onClick={() => handleBatchUpdateStatus('archived')}
            >
              {t('teaching.batchArchive')}
            </Button>
            <Popconfirm
              title={t('teaching.confirmBatchDelete')}
              onConfirm={handleBatchDelete}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t('teaching.batchDelete')}
              </Button>
            </Popconfirm>
          </Space>
        )}

        {/* 数据表格 */}
        <Table
          columns={columns}
          dataSource={filteredModules}
          loading={allModulesLoading}
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
          scroll={{ x: 1400 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => t('teaching.totalItems', { total })
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('teaching.noModules')}
              />
            )
          }}
        />
      </Card>

      {/* 预览模态框 */}
      <Modal
        title={t('teaching.header.preview')}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewVisible(false)}>
            {t('common.close')}
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
