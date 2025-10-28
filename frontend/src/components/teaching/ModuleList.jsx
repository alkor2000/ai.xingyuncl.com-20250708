/**
 * 教学模块列表组件（iOS风格版）
 * 功能：
 * 1. 使用Collapse折叠面板展示分组
 * 2. 支持模块属于多个分组
 * 3. 创建/编辑模块时可选择分组
 * 4. 未分组模块显示在"未分组"面板
 * 5. 统一iOS设计风格
 */

import React, { useEffect, useState } from 'react';
import { 
  Modal, Form, Input, Select, message, Dropdown
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, 
  FileTextOutlined, MoreOutlined, RightOutlined,
  AppstoreOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useTeachingStore from '../../stores/teachingStore';
import useSystemConfigStore from '../../stores/systemConfigStore';
import { 
  IOSPageContainer,
  IOSButton,
  IOSTag,
  IOSEmpty,
  IOSLoading 
} from './IOSLayout';
import '../../styles/ios-unified-theme.css';

const { TextArea } = Input;

const ModuleList = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  
  const {
    groupedModules,
    groupedModulesLoading,
    groups,
    fetchGroupedModules,
    fetchGroups,
    createModule,
    updateModule,
    deleteModule
  } = useTeachingStore();
  
  const { systemConfig } = useSystemConfigStore();
  
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [form] = Form.useForm();
  const [customHeaderHtml, setCustomHeaderHtml] = useState('');
  const [activeKeys, setActiveKeys] = useState([]);
  
  // 加载数据
  useEffect(() => {
    loadData();
    
    // 从系统配置加载自定义头部HTML
    const headerHtml = systemConfig?.teaching_page_header_html || '';
    setCustomHeaderHtml(headerHtml);
    
    // 从localStorage加载折叠状态
    const savedKeys = localStorage.getItem('teaching_collapse_keys');
    if (savedKeys) {
      try {
        setActiveKeys(JSON.parse(savedKeys));
      } catch (e) {
        // 默认展开第一个分组
        if (groupedModules.length > 0) {
          setActiveKeys([String(groupedModules[0].id || 'ungrouped')]);
        }
      }
    } else if (groupedModules.length > 0) {
      // 默认展开第一个分组
      setActiveKeys([String(groupedModules[0].id || 'ungrouped')]);
    }
  }, [systemConfig]);
  
  const loadData = async () => {
    await fetchGroupedModules();
    await fetchGroups();
  };
  
  // 折叠面板变化时保存状态
  const handleCollapseChange = (key) => {
    const newKeys = activeKeys.includes(key) 
      ? activeKeys.filter(k => k !== key)
      : [...activeKeys, key];
    setActiveKeys(newKeys);
    localStorage.setItem('teaching_collapse_keys', JSON.stringify(newKeys));
  };
  
  // 打开创建/编辑模态框
  const handleOpenModal = (module = null, e) => {
    if (e) {
      e.stopPropagation();
    }
    
    setEditingModule(module);
    if (module) {
      const groupIds = module.groups?.map(g => g.id) || [];
      form.setFieldsValue({
        ...module,
        group_ids: groupIds
      });
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
        message.success(t('teaching.updateSuccess'));
      } else {
        await createModule(values);
        message.success(t('teaching.createSuccess'));
      }
      
      setModalVisible(false);
      form.resetFields();
      loadData();
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
      title: t('teaching.confirmDeleteModule'),
      content: module.name,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteModule(module.id);
        message.success(t('teaching.deleteSuccess'));
        loadData();
      }
    });
  };
  
  // 查看模块详情
  const handleView = (module) => {
    navigate(`/teaching/modules/${module.id}`);
  };
  
  // 操作菜单
  const getActionMenu = (module) => ({
    items: [
      {
        key: 'edit',
        label: t('common.edit'),
        icon: <EditOutlined />,
        onClick: (e) => {
          e.domEvent.stopPropagation();
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
          e.domEvent.stopPropagation();
          handleDelete(module, e.domEvent);
        }
      }
    ]
  });
  
  // 渲染模块卡片（iOS风格）
  const renderModuleCard = (module) => (
    <div 
      className="ios-module-card"
      onClick={() => handleView(module)}
    >
      <div className="ios-module-card-cover">
        {module.cover_image ? (
          <img alt={module.name} src={module.cover_image} />
        ) : (
          <FileTextOutlined style={{ fontSize: 48, color: 'white', opacity: 0.9 }} />
        )}
        
        {/* 操作按钮 */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Dropdown 
            menu={getActionMenu(module)} 
            trigger={['click']}
            placement="topRight"
          >
            <MoreOutlined style={{ fontSize: 18, color: '#666', cursor: 'pointer' }} />
          </Dropdown>
        </div>
      </div>
      
      <div className="ios-module-card-body">
        <div className="ios-module-card-title">{module.name}</div>
        <div className="ios-module-card-description">
          {module.description || t('teaching.noDescription')}
        </div>
      </div>
    </div>
  );
  
  // 渲染分组面板（iOS风格）
  const renderGroupPanel = (group) => {
    const modules = group.modules || [];
    const panelKey = group.id ? String(group.id) : 'ungrouped';
    const isActive = activeKeys.includes(panelKey);
    
    return (
      <div key={panelKey} className="ios-collapse-panel">
        <div 
          className="ios-collapse-header"
          onClick={() => handleCollapseChange(panelKey)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RightOutlined 
              style={{ 
                fontSize: 12,
                color: '#999',
                transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s'
              }} 
            />
            <span style={{ fontSize: 16, fontWeight: 500, color: '#000' }}>
              {group.name}
            </span>
            <IOSTag color="blue">
              {modules.length} {t('teaching.modules')}
            </IOSTag>
          </div>
        </div>
        
        {isActive && (
          <div className="ios-collapse-content">
            {modules.length === 0 ? (
              <IOSEmpty 
                icon={<AppstoreOutlined style={{ fontSize: 48, color: '#999' }} />}
                text={t('teaching.noModules')}
              />
            ) : (
              <div style={{
                display: 'grid',
                gap: 20,
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))'
              }}>
                {modules.map(module => renderModuleCard(module))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  
  if (groupedModulesLoading) {
    return (
      <IOSPageContainer>
        <IOSLoading text={t('common.loading')} />
      </IOSPageContainer>
    );
  }
  
  return (
    <IOSPageContainer>
      <div style={{ padding: 24 }}>
        {/* 自定义HTML头部区域 */}
        {customHeaderHtml && (
          <div 
            dangerouslySetInnerHTML={{ __html: customHeaderHtml }}
            style={{ marginBottom: 24 }}
          />
        )}
        
        {/* 创建按钮 */}
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <IOSButton
            variant="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenModal()}
          >
            {t('teaching.createModule')}
          </IOSButton>
        </div>
        
        {/* 分组列表 */}
        {groupedModules.length === 0 ? (
          <div className="ios-card" style={{ marginTop: 60, textAlign: 'center', padding: 60 }}>
            <IOSEmpty 
              icon={<AppstoreOutlined style={{ fontSize: 64, color: '#999' }} />}
              text={t('teaching.noModuleGroups')}
              action={
                <IOSButton
                  variant="primary"
                  icon={<PlusOutlined />}
                  onClick={() => handleOpenModal()}
                  style={{ marginTop: 20 }}
                >
                  {t('teaching.createFirstModule')}
                </IOSButton>
              }
            />
          </div>
        ) : (
          <div className="ios-collapse">
            {groupedModules.map(group => renderGroupPanel(group))}
          </div>
        )}
        
        {/* 创建/编辑模态框 */}
        <Modal
          title={editingModule ? t('teaching.editModule') : t('teaching.createModule')}
          open={modalVisible}
          onOk={handleSubmit}
          onCancel={() => {
            setModalVisible(false);
            form.resetFields();
          }}
          width={600}
          okText={t('common.submit')}
          cancelText={t('common.cancel')}
          className="ios-modal"
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              visibility: 'private',
              status: 'draft',
              group_ids: []
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
              name="group_ids"
              label={t('teaching.belongGroups')}
              tooltip={t('teaching.moduleCanBelongMultipleGroups')}
            >
              <Select
                mode="multiple"
                placeholder={t('teaching.selectGroups')}
                allowClear
              >
                {groups.filter(g => g.is_active).map(group => (
                  <Select.Option key={group.id} value={group.id}>
                    {group.name}
                  </Select.Option>
                ))}
              </Select>
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
    </IOSPageContainer>
  );
};

export default ModuleList;
