/**
 * 教学模块列表组件
 */

import React, { useEffect, useState } from 'react';
import { 
  Card, List, Button, Space, Tag, Empty, Spin, Modal, 
  Form, Input, Select, Upload, message, Dropdown, Pagination 
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, 
  FileTextOutlined, SettingOutlined, UploadOutlined, MoreOutlined 
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';

const { TextArea } = Input;

const ModuleList = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const {
    modules,
    modulesPagination,
    modulesLoading,
    fetchModules,
    createModule,
    updateModule,
    deleteModule
  } = useTeachingStore();
  
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [form] = Form.useForm();
  
  // 加载模块列表
  useEffect(() => {
    fetchModules();
  }, []);
  
  // 打开创建/编辑模态框
  const handleOpenModal = (module = null) => {
    setEditingModule(module);
    if (module) {
      form.setFieldsValue(module);
    } else {
      form.resetFields();
    }
    setModalVisible(true);
  };
  
  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingModule) {
        await updateModule(editingModule.id, values);
      } else {
        await createModule(values);
      }
      
      setModalVisible(false);
      form.resetFields();
    } catch (error) {
      console.error('提交失败:', error);
    }
  };
  
  // 删除模块
  const handleDelete = (module) => {
    Modal.confirm({
      title: t('teaching.confirmDelete'),
      content: `${t('teaching.confirmDeleteModule')}: ${module.name}`,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteModule(module.id);
      }
    });
  };
  
  // 查看模块详情
  const handleView = (module) => {
    navigate(`/teaching/modules/${module.id}`);
  };
  
  // 管理权限
  const handleManagePermissions = (module) => {
    navigate(`/teaching/modules/${module.id}/permissions`);
  };
  
  // 页码变化
  const handlePageChange = (page, pageSize) => {
    fetchModules({ page, limit: pageSize });
  };
  
  // 可见性标签颜色
  const visibilityColor = {
    public: 'green',
    group: 'blue',
    private: 'orange'
  };
  
  // 状态标签颜色
  const statusColor = {
    draft: 'default',
    published: 'success',
    archived: 'error'
  };
  
  // 操作菜单
  const getActionMenu = (module) => ({
    items: [
      {
        key: 'view',
        label: t('teaching.viewModule'),
        icon: <EyeOutlined />,
        onClick: () => handleView(module)
      },
      {
        key: 'edit',
        label: t('common.edit'),
        icon: <EditOutlined />,
        onClick: () => handleOpenModal(module)
      },
      {
        key: 'permissions',
        label: t('teaching.managePermissions'),
        icon: <SettingOutlined />,
        onClick: () => handleManagePermissions(module)
      },
      {
        type: 'divider'
      },
      {
        key: 'delete',
        label: t('common.delete'),
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDelete(module)
      }
    ]
  });
  
  return (
    <div style={{ padding: '24px' }}>
      {/* 头部 */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('teaching.moduleList')}</h2>
          <p style={{ color: '#666', margin: '8px 0 0 0' }}>
            {t('teaching.moduleListDescription')}
          </p>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
        >
          {t('teaching.createModule')}
        </Button>
      </div>
      
      {/* 模块列表 */}
      <Spin spinning={modulesLoading}>
        {modules.length === 0 ? (
          <Empty 
            description={t('teaching.noModules')}
            style={{ marginTop: '60px' }}
          >
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => handleOpenModal()}
            >
              {t('teaching.createFirstModule')}
            </Button>
          </Empty>
        ) : (
          <>
            <List
              grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }}
              dataSource={modules}
              renderItem={module => (
                <List.Item>
                  <Card
                    hoverable
                    cover={
                      module.cover_image ? (
                        <img 
                          alt={module.name} 
                          src={module.cover_image} 
                          style={{ height: 160, objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ 
                          height: 160, 
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <FileTextOutlined style={{ fontSize: 48, color: 'white' }} />
                        </div>
                      )
                    }
                    actions={[
                      <EyeOutlined key="view" onClick={() => handleView(module)} />,
                      <EditOutlined key="edit" onClick={() => handleOpenModal(module)} />,
                      <Dropdown menu={getActionMenu(module)} trigger={['click']}>
                        <MoreOutlined />
                      </Dropdown>
                    ]}
                  >
                    <Card.Meta
                      title={
                        <div style={{ marginBottom: 8 }}>
                          {module.name}
                        </div>
                      }
                      description={
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                          <div style={{ 
                            minHeight: 40, 
                            fontSize: 12, 
                            color: '#666',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {module.description || t('teaching.noDescription')}
                          </div>
                          <Space wrap>
                            <Tag color={visibilityColor[module.visibility]}>
                              {t(`teaching.visibility.${module.visibility}`)}
                            </Tag>
                            <Tag color={statusColor[module.status]}>
                              {t(`teaching.status.${module.status}`)}
                            </Tag>
                          </Space>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            {module.lesson_count} {t('teaching.lessons')} · {module.view_count} {t('teaching.views')}
                          </div>
                        </Space>
                      }
                    />
                  </Card>
                </List.Item>
              )}
            />
            
            {/* 分页 */}
            {modulesPagination.total > modulesPagination.limit && (
              <div style={{ marginTop: 24, textAlign: 'right' }}>
                <Pagination
                  current={modulesPagination.page}
                  pageSize={modulesPagination.limit}
                  total={modulesPagination.total}
                  onChange={handlePageChange}
                  showSizeChanger
                  showTotal={total => `${t('common.total')} ${total} ${t('common.items')}`}
                />
              </div>
            )}
          </>
        )}
      </Spin>
      
      {/* 创建/编辑模态框 */}
      <Modal
        title={editingModule ? t('teaching.editModule') : t('teaching.createModule')}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText={t('common.submit')}
        cancelText={t('common.cancel')}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            visibility: 'private',
            status: 'draft'
          }}
        >
          <Form.Item
            name="name"
            label={t('teaching.moduleName')}
            rules={[{ required: true, message: t('teaching.moduleNameRequired') }]}
          >
            <Input placeholder={t('teaching.moduleNamePlaceholder')} />
          </Form.Item>
          
          <Form.Item
            name="description"
            label={t('teaching.moduleDescription')}
          >
            <TextArea 
              rows={4} 
              placeholder={t('teaching.moduleDescriptionPlaceholder')} 
            />
          </Form.Item>
          
          <Form.Item
            name="cover_image"
            label={t('teaching.coverImage')}
          >
            <Input placeholder={t('teaching.coverImagePlaceholder')} />
          </Form.Item>
          
          <Form.Item
            name="visibility"
            label={t('teaching.visibility.label')}
          >
            <Select>
              <Select.Option value="private">{t('teaching.visibility.private')}</Select.Option>
              <Select.Option value="group">{t('teaching.visibility.group')}</Select.Option>
              <Select.Option value="public">{t('teaching.visibility.public')}</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="status"
            label={t('teaching.status.label')}
          >
            <Select>
              <Select.Option value="draft">{t('teaching.status.draft')}</Select.Option>
              <Select.Option value="published">{t('teaching.status.published')}</Select.Option>
              <Select.Option value="archived">{t('teaching.status.archived')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ModuleList;
