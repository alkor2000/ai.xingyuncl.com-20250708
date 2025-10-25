/**
 * 教学模块列表组件（终极优化版）
 * 优化：
 * 1. 删除底部标签和统计信息
 * 2. 操作按钮移至右下角
 * 3. 修复点击事件冒泡问题
 * 4. 支持自定义HTML头部
 */

import React, { useEffect, useState } from 'react';
import { 
  Card, List, Button, Empty, Spin, Modal, 
  Form, Input, Select, message, Dropdown, Pagination 
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, 
  FileTextOutlined, MoreOutlined 
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useSystemConfigStore from '../../stores/systemConfigStore';

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
  
  const { systemConfig } = useSystemConfigStore();
  
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [form] = Form.useForm();
  const [customHeaderHtml, setCustomHeaderHtml] = useState('');
  
  // 加载模块列表和自定义头部HTML
  useEffect(() => {
    fetchModules();
    
    // 从系统配置加载自定义头部HTML
    const headerHtml = systemConfig?.teaching_page_header_html || '';
    setCustomHeaderHtml(headerHtml);
  }, [systemConfig]);
  
  // 打开创建/编辑模态框
  const handleOpenModal = (module = null, e) => {
    if (e) {
      e.stopPropagation();
    }
    
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
  const handleDelete = (module, e) => {
    if (e) {
      e.stopPropagation();
    }
    
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
  
  // 页码变化
  const handlePageChange = (page, pageSize) => {
    fetchModules({ page, limit: pageSize });
  };
  
  // 操作菜单
  const getActionMenu = (module) => ({
    items: [
      {
        key: 'edit',
        label: t('common.edit'),
        icon: <EditOutlined />,
        onClick: (e) => {
          e.domEvent.stopPropagation(); // Dropdown的事件对象在domEvent中
          handleOpenModal(module, e.domEvent);
        }
      },
      {
        type: 'divider'
      },
      {
        key: 'delete',
        label: t('common.delete'),
        icon: <DeleteOutlined />,
        danger: true,
        onClick: (e) => {
          e.domEvent.stopPropagation(); // Dropdown的事件对象在domEvent中
          handleDelete(module, e.domEvent);
        }
      }
    ]
  });
  
  return (
    <div style={{ padding: '24px' }}>
      {/* 自定义HTML头部区域（超级管理员可在后台配置） */}
      {customHeaderHtml && (
        <div 
          dangerouslySetInnerHTML={{ __html: customHeaderHtml }}
          style={{ marginBottom: '24px' }}
        />
      )}
      
      {/* 创建按钮（固定显示） */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'flex-end' }}>
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
              grid={{ gutter: 20, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }}
              dataSource={modules}
              renderItem={module => (
                <List.Item>
                  <Card
                    hoverable
                    style={{
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      border: '1px solid #f0f0f0',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}
                    bodyStyle={{ padding: '16px' }}
                    onClick={() => handleView(module)}
                    cover={
                      <div style={{ position: 'relative' }}>
                        {/* 封面图片 */}
                        {module.cover_image ? (
                          <img 
                            alt={module.name} 
                            src={module.cover_image} 
                            style={{ 
                              height: 200, 
                              width: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          <div style={{ 
                            height: 200, 
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <FileTextOutlined style={{ fontSize: 56, color: 'white', opacity: 0.9 }} />
                          </div>
                        )}
                        
                        {/* 操作按钮（右下角浮动） */}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '12px',
                            right: '12px',
                            background: 'rgba(255, 255, 255, 0.95)',
                            borderRadius: '50%',
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer',
                            zIndex: 10
                          }}
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止事件冒泡到Card
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 1)';
                            e.currentTarget.style.transform = 'scale(1.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
                            e.currentTarget.style.transform = 'scale(1)';
                          }}
                        >
                          <Dropdown 
                            menu={getActionMenu(module)} 
                            trigger={['click']}
                            placement="topRight"
                          >
                            <MoreOutlined 
                              style={{ 
                                fontSize: 20, 
                                color: '#666'
                              }}
                              onClick={(e) => {
                                e.stopPropagation(); // 双重保险，再次阻止冒泡
                              }}
                            />
                          </Dropdown>
                        </div>
                      </div>
                    }
                  >
                    {/* 标题 */}
                    <div style={{ 
                      marginBottom: 8,
                      fontSize: 16,
                      fontWeight: 500,
                      color: '#1a1a1a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: '1.5'
                    }}>
                      {module.name}
                    </div>
                    
                    {/* 描述（仅保留描述，删除所有标签和统计） */}
                    <div style={{ 
                      minHeight: 40, 
                      fontSize: 13, 
                      color: '#666',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      lineHeight: '1.5'
                    }}>
                      {module.description || t('teaching.noDescription')}
                    </div>
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
