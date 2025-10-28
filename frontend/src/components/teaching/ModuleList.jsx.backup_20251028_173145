/**
 * 教学模块列表组件（分组折叠版）
 * 功能：
 * 1. 使用Collapse折叠面板展示分组
 * 2. 支持模块属于多个分组
 * 3. 创建/编辑模块时可选择分组
 * 4. 未分组模块显示在"未分组"面板
 */

import React, { useEffect, useState } from 'react';
import { 
  Card, List, Button, Empty, Spin, Modal, 
  Form, Input, Select, message, Dropdown, Collapse
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, 
  FileTextOutlined, MoreOutlined, RightOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import useTeachingStore from '../../stores/teachingStore';
import useSystemConfigStore from '../../stores/systemConfigStore';

const { TextArea } = Input;
const { Panel } = Collapse;

const ModuleList = () => {
  const navigate = useNavigate();
  
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
  const handleCollapseChange = (keys) => {
    setActiveKeys(keys);
    localStorage.setItem('teaching_collapse_keys', JSON.stringify(keys));
  };
  
  // 打开创建/编辑模态框
  const handleOpenModal = (module = null, e) => {
    if (e) {
      e.stopPropagation();
    }
    
    setEditingModule(module);
    if (module) {
      // 获取模块的分组ID数组
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
      title: '确认删除',
      content: `确定要删除模块"${module.name}"吗？`,
      okText: '确认',
      cancelText: '取消',
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
  
  // 操作菜单
  const getActionMenu = (module) => ({
    items: [
      {
        key: 'edit',
        label: '编辑',
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
        label: '删除',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: (e) => {
          e.domEvent.stopPropagation();
          handleDelete(module, e.domEvent);
        }
      }
    ]
  });
  
  // 渲染模块卡片
  const renderModuleCard = (module) => (
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
              e.stopPropagation();
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
                  e.stopPropagation();
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
      
      {/* 描述 */}
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
        {module.description || '暂无描述'}
      </div>
    </Card>
  );
  
  // 渲染分组面板
  const renderGroupPanel = (group) => {
    const modules = group.modules || [];
    const panelKey = group.id ? String(group.id) : 'ungrouped';
    
    return (
      <Panel 
        header={
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            paddingRight: '16px'
          }}>
            <span style={{ 
              fontSize: 16, 
              fontWeight: 500,
              color: '#1a1a1a'
            }}>
              {group.name}
              <span style={{ 
                marginLeft: 8, 
                fontSize: 14, 
                color: '#999',
                fontWeight: 'normal'
              }}>
                {modules.length} 个模块
              </span>
            </span>
          </div>
        }
        key={panelKey}
      >
        {modules.length === 0 ? (
          <Empty 
            description="暂无模块"
            style={{ padding: '40px 0' }}
          />
        ) : (
          <List
            grid={{ gutter: 20, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }}
            dataSource={modules}
            renderItem={module => (
              <List.Item>
                {renderModuleCard(module)}
              </List.Item>
            )}
          />
        )}
      </Panel>
    );
  };
  
  return (
    <div style={{ padding: '24px' }}>
      {/* 自定义HTML头部区域 */}
      {customHeaderHtml && (
        <div 
          dangerouslySetInnerHTML={{ __html: customHeaderHtml }}
          style={{ marginBottom: '24px' }}
        />
      )}
      
      {/* 创建按钮 */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'flex-end' }}>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
        >
          创建模块
        </Button>
      </div>
      
      {/* 分组折叠面板 */}
      <Spin spinning={groupedModulesLoading}>
        {groupedModules.length === 0 ? (
          <Empty 
            description="暂无模块分组"
            style={{ marginTop: '60px' }}
          >
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => handleOpenModal()}
            >
              创建第一个模块
            </Button>
          </Empty>
        ) : (
          <Collapse 
            activeKey={activeKeys}
            onChange={handleCollapseChange}
            expandIcon={({ isActive }) => <RightOutlined rotate={isActive ? 90 : 0} />}
            style={{ 
              background: 'transparent',
              border: 'none'
            }}
          >
            {groupedModules.map(group => renderGroupPanel(group))}
          </Collapse>
        )}
      </Spin>
      
      {/* 创建/编辑模态框 */}
      <Modal
        title={editingModule ? '编辑模块' : '创建模块'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText="提交"
        cancelText="取消"
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
            label="模块名称"
            rules={[{ required: true, message: '请输入模块名称' }]}
          >
            <Input placeholder="请输入模块名称" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="模块描述"
          >
            <TextArea 
              rows={4} 
              placeholder="请输入模块描述" 
            />
          </Form.Item>
          
          <Form.Item
            name="cover_image"
            label="封面图片"
          >
            <Input placeholder="请输入封面图片URL" />
          </Form.Item>
          
          <Form.Item
            name="group_ids"
            label="所属分组"
            tooltip="一个模块可以属于多个分组"
          >
            <Select
              mode="multiple"
              placeholder="请选择分组（可多选）"
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
            label="可见性"
          >
            <Select>
              <Select.Option value="private">私有</Select.Option>
              <Select.Option value="group">组织内</Select.Option>
              <Select.Option value="public">公开</Select.Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="status"
            label="状态"
          >
            <Select>
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="published">已发布</Select.Option>
              <Select.Option value="archived">已归档</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ModuleList;
