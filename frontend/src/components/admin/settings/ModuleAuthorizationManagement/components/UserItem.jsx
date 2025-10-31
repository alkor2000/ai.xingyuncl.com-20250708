/**
 * 用户卡片组件
 * 显示单个用户的权限配置
 * 支持：继承开关、独立权限配置
 * 
 * @module components/UserItem
 */

import React from 'react';
import { Card, Space, Switch, Tag } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import ModulePermissionSelector from './ModulePermissionSelector';
import { TAG_TEXTS, SUCCESS_MESSAGES } from '../constants';

/**
 * 用户卡片组件属性
 * @typedef {Object} UserItemProps
 * @property {number} groupId - 组ID
 * @property {number} tagId - 标签ID
 * @property {Object} user - 用户数据
 * @property {Array} groupPermissions - 组权限
 * @property {Array} tagPermissions - 标签权限
 * @property {boolean} tagInheritsGroup - 标签是否继承组
 * @property {Array} allModules - 所有模块列表
 * @property {Object} moduleLessons - 模块课程数据
 * @property {Object} loadingLessons - 课程加载状态
 * @property {Function} onPermissionToggle - 权限切换回调
 * @property {Function} onInheritanceToggle - 继承开关回调
 * @property {Function} onModuleExpand - 模块展开回调
 * @property {Function} onLoadLessons - 加载课程回调
 */

/**
 * 用户卡片组件
 */
const UserItem = React.memo(({
  groupId,
  tagId,
  user,
  groupPermissions,
  tagPermissions,
  tagInheritsGroup,
  allModules,
  moduleLessons,
  loadingLessons,
  onPermissionToggle,
  onInheritanceToggle,
  onModuleExpand,
  onLoadLessons
}) => {
  // 计算继承的权限（用于复制）
  const inheritedPermissions = user.inheritFromTag
    ? (tagInheritsGroup ? groupPermissions : tagPermissions)
    : null;

  return (
    <Card
      size="small"
      style={{
        marginLeft: 60,
        marginBottom: 12,
        background: '#f0f0f0'
      }}
      title={
        <Space>
          <UserOutlined style={{ color: '#52c41a' }} />
          <span>{user.username}</span>
          {user.remark && (
            <span style={{ color: '#999', fontSize: 12 }}>({user.remark})</span>
          )}
          {user.email && (
            <span style={{ color: '#999', fontSize: 12 }}>{user.email}</span>
          )}
        </Space>
      }
    >
      {/* 继承开关 */}
      <div>
        <Space style={{ marginBottom: 12 }}>
          <Switch
            checked={user.inheritFromTag}
            onChange={(checked) => {
              onInheritanceToggle(
                groupId,
                tagId,
                user.userId,
                checked,
                inheritedPermissions
              );
            }}
          />
          <span>继承上级权限</span>
          {!user.inheritFromTag && (
            <Tag color="orange" style={{ fontSize: 11 }}>
              {TAG_TEXTS.INDEPENDENT}
            </Tag>
          )}
        </Space>

        {/* 独立权限配置 */}
        {!user.inheritFromTag && (
          <ModulePermissionSelector
            groupId={groupId}
            tagId={tagId}
            userId={user.userId}
            permissions={user.modulePermissions || []}
            inheritedPermissions={inheritedPermissions}
            allModules={allModules}
            moduleLessons={moduleLessons}
            loadingLessons={loadingLessons}
            onPermissionToggle={onPermissionToggle}
            onModuleExpand={onModuleExpand}
            onLoadLessons={onLoadLessons}
          />
        )}
      </div>
    </Card>
  );
});

UserItem.displayName = 'UserItem';

export default UserItem;
