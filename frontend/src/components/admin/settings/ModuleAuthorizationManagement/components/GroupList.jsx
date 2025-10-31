/**
 * 组织列表容器组件
 * 管理所有授权组织的显示
 * 
 * @module components/GroupList
 */

import React from 'react';
import { Collapse, Card, Empty, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import GroupItem from './GroupItem';
import { EMPTY_MESSAGES } from '../constants';

/**
 * 组织列表组件属性
 * @typedef {Object} GroupListProps
 * @property {Array} groups - 授权组织列表
 * @property {Array} allModules - 所有模块列表
 * @property {Object} moduleLessons - 模块课程数据
 * @property {Object} loadingLessons - 课程加载状态
 * @property {Object} userPagination - 用户分页信息
 * @property {Object} loadingUsers - 用户加载状态
 * @property {Function} onNewAuth - 新建授权回调
 * @property {Function} onRemoveGroup - 移除组织回调
 * @property {Function} onPermissionToggle - 权限切换回调
 * @property {Function} onInheritanceToggle - 继承开关回调
 * @property {Function} onModuleExpand - 模块展开回调
 * @property {Function} onLoadLessons - 加载课程回调
 * @property {Function} onToggleTags - 展开/收起标签回调
 * @property {Function} onToggleUsers - 展开/收起用户回调
 * @property {Function} onLoadUsers - 加载用户回调
 */

/**
 * 组织列表容器组件
 */
const GroupList = React.memo(({
  groups,
  allModules,
  moduleLessons,
  loadingLessons,
  userPagination,
  loadingUsers,
  onNewAuth,
  onRemoveGroup,
  onPermissionToggle,
  onInheritanceToggle,
  onModuleExpand,
  onLoadLessons,
  onToggleTags,
  onToggleUsers,
  onLoadUsers
}) => {
  // 空状态
  if (!groups || groups.length === 0) {
    return (
      <Card>
        <Empty
          description={
            <div>
              <p>{EMPTY_MESSAGES.NO_GROUPS}</p>
              <p style={{ color: '#999' }}>{EMPTY_MESSAGES.NO_GROUPS_DESC}</p>
            </div>
          }
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={onNewAuth}>
            新建授权
          </Button>
        </Empty>
      </Card>
    );
  }

  // 组织列表
  return (
    <Collapse
      expandIconPosition="right"
      style={{ background: 'transparent', border: 'none' }}
      defaultActiveKey={groups.map(g => `group-${g.groupId}`)}
    >
      {groups.map(group => (
        <GroupItem
          key={group.groupId}
          group={group}
          allModules={allModules}
          moduleLessons={moduleLessons}
          loadingLessons={loadingLessons}
          userPagination={userPagination}
          loadingUsers={loadingUsers}
          onRemove={onRemoveGroup}
          onPermissionToggle={onPermissionToggle}
          onInheritanceToggle={onInheritanceToggle}
          onModuleExpand={onModuleExpand}
          onLoadLessons={onLoadLessons}
          onToggleTags={onToggleTags}
          onToggleUsers={onToggleUsers}
          onLoadUsers={onLoadUsers}
        />
      ))}
    </Collapse>
  );
});

GroupList.displayName = 'GroupList';

export default GroupList;
