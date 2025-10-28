/**
 * 教学模块权限树状管理器（垂直展开版）
 * 
 * 核心特性：
 * ✅ 垂直展开的树状结构（组→标签→用户）
 * ✅ 单页面完成所有操作，无需弹窗
 * ✅ 实时权限状态显示
 * ✅ 支持批量授权/撤销
 * ✅ 权限继承机制可视化
 * ✅ iOS清爽风格（白色卡片）
 * 
 * 层级结构：
 * - 第一级：用户组（Collapse折叠面板）
 * - 第二级：用户标签（每个组下的标签列表）
 * - 第三级：用户列表（每个标签下的用户）
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Collapse,
  List,
  Space,
  Tag,
  Switch,
  Button,
  Radio,
  Badge,
  Tooltip,
  message,
  Spin,
  Empty,
  Alert
} from 'antd';
import {
  TeamOutlined,
  TagOutlined,
  UserOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
  LockOutlined,
  UnlockOutlined,
  ThunderboltOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';

const { Panel } = Collapse;

const PermissionTreeManager = ({ moduleId, onRefresh }) => {
  const { t } = useTranslation();
  
  // ==================== 状态管理 ====================
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [activeKeys, setActiveKeys] = useState([]);
  const [permissionType, setPermissionType] = useState('view');
  const [processingItems, setProcessingItems] = useState(new Set());

  // ==================== 数据加载 ====================
  
  useEffect(() => {
    if (moduleId) {
      loadTreeData();
    }
  }, [moduleId]);

  const loadTreeData = async () => {
    setLoading(true);
    try {
      // 并行加载数据
      const [groupsRes, permissionsRes] = await Promise.all([
        api.get('/admin/user-groups'),
        api.get(`/teaching/modules/${moduleId}/permissions`)
      ]);

      const groups = groupsRes.data.data || [];
      const perms = permissionsRes.data.data || [];
      setPermissions(perms);

      // 构建树状数据
      const tree = await Promise.all(
        groups.map(async (group) => {
          // 获取组下的标签
          const tagsRes = await api.get(`/admin/user-tags/group/${group.id}`);
          const tags = tagsRes.data.data || [];

          // 为每个标签加载用户
          const tagsWithUsers = await Promise.all(
            tags.filter(tag => tag.is_active).map(async (tag) => {
              const usersRes = await api.get('/admin/users', {
                params: { group_id: group.id, limit: 100 }
              });
              
              // 过滤出拥有该标签的用户
              const allUsers = usersRes.data.data.users || [];
              const tagUserIds = await getTagUserIds(tag.id);
              const users = allUsers.filter(u => tagUserIds.includes(u.id));

              return {
                ...tag,
                users
              };
            })
          );

          return {
            ...group,
            tags: tagsWithUsers
          };
        })
      );

      setTreeData(tree);
      
      // 默认展开第一个组
      if (tree.length > 0) {
        setActiveKeys([`group-${tree[0].id}`]);
      }
    } catch (error) {
      console.error('加载权限树数据失败:', error);
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取标签下的用户ID列表
  const getTagUserIds = async (tagId) => {
    try {
      const res = await api.get(`/admin/user-tags/${tagId}/users`);
      const users = res.data.data || [];
      return users.map(u => u.id);
    } catch (error) {
      return [];
    }
  };

  // ==================== 权限检查 ====================
  
  const hasPermission = (targetType, targetId, permType = permissionType) => {
    return permissions.some(p => {
      if (p.permission_type !== permType) return false;
      
      if (targetType === 'group') {
        return p.group_id === targetId;
      } else if (targetType === 'tag') {
        return p.tag_id === targetId;
      } else if (targetType === 'user') {
        return p.user_id === targetId;
      }
      return false;
    });
  };

  const getPermissionId = (targetType, targetId, permType = permissionType) => {
    const perm = permissions.find(p => {
      if (p.permission_type !== permType) return false;
      
      if (targetType === 'group') {
        return p.group_id === targetId;
      } else if (targetType === 'tag') {
        return p.tag_id === targetId;
      } else if (targetType === 'user') {
        return p.user_id === targetId;
      }
      return false;
    });
    return perm?.id;
  };

  // ==================== 权限操作 ====================
  
  const handleTogglePermission = async (targetType, targetId, targetName, enabled) => {
    const key = `${targetType}-${targetId}`;
    setProcessingItems(prev => new Set([...prev, key]));

    try {
      if (enabled) {
        // 授权
        const data = {
          module_id: moduleId,
          permission_type: permissionType
        };
        
        if (targetType === 'group') data.group_id = targetId;
        else if (targetType === 'tag') data.tag_id = targetId;
        else if (targetType === 'user') data.user_id = targetId;

        await api.post('/teaching/permissions', data);
        message.success(`已授予 ${targetName} ${permissionType === 'edit' ? '编辑' : '查看'}权限`);
      } else {
        // 撤销权限
        const permId = getPermissionId(targetType, targetId);
        if (permId) {
          await api.delete(`/teaching/permissions/${permId}`);
          message.success(`已撤销 ${targetName} 的权限`);
        }
      }

      // 重新加载权限列表
      const permissionsRes = await api.get(`/teaching/modules/${moduleId}/permissions`);
      setPermissions(permissionsRes.data.data || []);
      
      if (onRefresh) onRefresh();
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败');
    } finally {
      setProcessingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  const handleBatchGrant = async (targetType, targetIds, targetName) => {
    if (targetIds.length === 0) {
      message.warning('没有可授权的对象');
      return;
    }

    setLoading(true);
    try {
      let successCount = 0;
      
      for (const targetId of targetIds) {
        try {
          const data = {
            module_id: moduleId,
            permission_type: permissionType
          };
          
          if (targetType === 'tag') data.tag_id = targetId;
          else if (targetType === 'user') data.user_id = targetId;

          await api.post('/teaching/permissions', data);
          successCount++;
        } catch (error) {
          console.error(`授权失败: ${targetId}`, error);
        }
      }

      message.success(`成功为 ${targetName} 批量授予权限 (${successCount}/${targetIds.length})`);
      
      // 重新加载权限列表
      const permissionsRes = await api.get(`/teaching/modules/${moduleId}/permissions`);
      setPermissions(permissionsRes.data.data || []);
      
      if (onRefresh) onRefresh();
    } catch (error) {
      message.error('批量授权失败');
    } finally {
      setLoading(false);
    }
  };

  // ==================== 渲染函数 ====================
  
  const renderUserItem = (user, groupId, tagId) => {
    const key = `user-${user.id}`;
    const isProcessing = processingItems.has(key);
    const hasUserPerm = hasPermission('user', user.id);
    const hasTagPerm = hasPermission('tag', tagId);
    const hasGroupPerm = hasPermission('group', groupId);
    const isInherited = !hasUserPerm && (hasTagPerm || hasGroupPerm);

    return (
      <List.Item
        key={user.id}
        style={{
          padding: '12px 16px',
          background: '#fff',
          borderRadius: 8,
          marginBottom: 8,
          border: '1px solid #f0f0f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
        }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <UserOutlined style={{ color: '#1890ff', fontSize: 16 }} />
            <span style={{ fontWeight: 500, fontSize: 14 }}>
              {user.real_name || user.username}
            </span>
            <span style={{ color: '#999', fontSize: 12 }}>
              {user.email}
            </span>
            {isInherited && (
              <Tooltip title={hasTagPerm ? '继承标签权限' : '继承组权限'}>
                <Tag color="blue" style={{ fontSize: 11 }}>
                  <CheckCircleOutlined /> 已继承
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Switch
            checked={hasUserPerm || isInherited}
            disabled={isProcessing || isInherited}
            loading={isProcessing}
            onChange={(checked) => handleTogglePermission('user', user.id, user.username, checked)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<MinusCircleOutlined />}
          />
        </Space>
      </List.Item>
    );
  };

  const renderTagSection = (tag, groupId) => {
    const key = `tag-${tag.id}`;
    const isProcessing = processingItems.has(key);
    const hasTagPerm = hasPermission('tag', tag.id);
    const hasGroupPerm = hasPermission('group', groupId);
    const isInherited = !hasTagPerm && hasGroupPerm;
    const userCount = tag.users?.length || 0;

    return (
      <div key={tag.id} style={{ marginBottom: 16 }}>
        <Card
          size="small"
          style={{
            background: '#fafafa',
            borderRadius: 8,
            border: '1px solid #e8e8e8'
          }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* 标签头部 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Tag color={tag.color || 'default'} style={{ fontSize: 13 }}>
                  <TagOutlined /> {tag.name}
                </Tag>
                <Badge count={userCount} showZero style={{ backgroundColor: '#52c41a' }} />
                {isInherited && (
                  <Tooltip title="继承组权限">
                    <Tag color="blue" style={{ fontSize: 11 }}>
                      <CheckCircleOutlined /> 已继承
                    </Tag>
                  </Tooltip>
                )}
              </Space>
              <Space>
                {userCount > 0 && !hasTagPerm && !isInherited && (
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ThunderboltOutlined />}
                    onClick={() => handleBatchGrant('user', tag.users.map(u => u.id), tag.name)}
                  >
                    批量授权用户
                  </Button>
                )}
                <Switch
                  checked={hasTagPerm || isInherited}
                  disabled={isProcessing || isInherited}
                  loading={isProcessing}
                  onChange={(checked) => handleTogglePermission('tag', tag.id, tag.name, checked)}
                  checkedChildren={<CheckCircleOutlined />}
                  unCheckedChildren={<MinusCircleOutlined />}
                />
              </Space>
            </div>

            {/* 用户列表 */}
            {userCount > 0 && (
              <div style={{ paddingLeft: 16 }}>
                <List
                  dataSource={tag.users}
                  renderItem={(user) => renderUserItem(user, groupId, tag.id)}
                  locale={{ emptyText: '该标签下暂无用户' }}
                />
              </div>
            )}
          </Space>
        </Card>
      </div>
    );
  };

  const renderGroupPanel = (group) => {
    const key = `group-${group.id}`;
    const isProcessing = processingItems.has(key);
    const hasGroupPerm = hasPermission('group', group.id);
    const tagCount = group.tags?.length || 0;

    const header = (
      <div 
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Space>
          <TeamOutlined style={{ fontSize: 18, color: '#1890ff' }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>{group.name}</span>
          <Badge count={tagCount} showZero style={{ backgroundColor: '#faad14' }} />
        </Space>
        <Space>
          {tagCount > 0 && !hasGroupPerm && (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<ThunderboltOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleBatchGrant('tag', group.tags.map(t => t.id), group.name);
              }}
            >
              批量授权标签
            </Button>
          )}
          <Switch
            checked={hasGroupPerm}
            disabled={isProcessing}
            loading={isProcessing}
            onChange={(checked) => {
              handleTogglePermission('group', group.id, group.name, checked);
            }}
            onClick={(_, e) => e.stopPropagation()}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<MinusCircleOutlined />}
          />
        </Space>
      </div>
    );

    return (
      <Panel 
        header={header} 
        key={`group-${group.id}`}
        style={{
          background: '#fff',
          borderRadius: 8,
          marginBottom: 12,
          border: '1px solid #e8e8e8',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}
      >
        {tagCount === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该组织暂无标签"
            style={{ padding: '40px 0' }}
          />
        ) : (
          <div style={{ padding: '8px 0' }}>
            {group.tags.map(tag => renderTagSection(tag, group.id))}
          </div>
        )}
      </Panel>
    );
  };

  // ==================== 主渲染 ====================
  
  if (loading && treeData.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" tip="加载权限数据..." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* 操作栏 */}
      <Card 
        style={{ 
          marginBottom: 16,
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space>
            <span style={{ fontWeight: 500 }}>权限类型：</span>
            <Radio.Group 
              value={permissionType} 
              onChange={(e) => setPermissionType(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="view">
                <LockOutlined /> 查看权限
              </Radio.Button>
              <Radio.Button value="edit">
                <UnlockOutlined /> 编辑权限
              </Radio.Button>
            </Radio.Group>
          </Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={loadTreeData}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </Card>

      {/* 说明卡片 */}
      <Alert
        message="权限管理说明"
        description={
          <div>
            <p style={{ marginBottom: 8 }}>
              • <strong>组级授权</strong>：授权后，该组织下所有标签和用户自动继承权限
            </p>
            <p style={{ marginBottom: 8 }}>
              • <strong>标签授权</strong>：授权后，该标签下所有用户自动继承权限
            </p>
            <p style={{ marginBottom: 0 }}>
              • <strong>用户授权</strong>：单独为用户授权，不受继承影响
            </p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 权限树 */}
      <Collapse
        activeKey={activeKeys}
        onChange={setActiveKeys}
        expandIconPosition="right"
        style={{
          background: 'transparent',
          border: 'none'
        }}
      >
        {treeData.map(group => renderGroupPanel(group))}
      </Collapse>

      {treeData.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无组织数据"
          style={{ marginTop: 60 }}
        />
      )}
    </div>
  );
};

export default PermissionTreeManager;
