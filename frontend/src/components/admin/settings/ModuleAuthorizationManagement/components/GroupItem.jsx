/**
 * 组织面板组件
 * 显示单个组织的权限配置
 * 支持：组级权限配置、标签列表展开、权限边界检查
 * 
 * 版本：v1.1.0 (2025-11-09)
 * 更新：支持权限上限和组管理员限制
 * 
 * @module components/GroupItem
 */

import React from 'react';
import { Collapse, Space, Badge, Button, Empty, Divider, Tooltip, Tag } from 'antd';
import { 
  TeamOutlined, 
  DeleteOutlined, 
  PlusOutlined, 
  MinusOutlined,
  LockOutlined,
  InfoCircleOutlined 
} from '@ant-design/icons';
import ModulePermissionSelector from './ModulePermissionSelector';
import TagItem from './TagItem';
import { BUTTON_TEXTS, EMPTY_MESSAGES } from '../constants';

const { Panel } = Collapse;

/**
 * 组织面板组件属性
 * @typedef {Object} GroupItemProps
 * @property {Object} group - 组织数据
 * @property {Array} allModules - 所有模块列表
 * @property {Object} moduleLessons - 模块课程数据
 * @property {Object} loadingLessons - 课程加载状态
 * @property {Object} userPagination - 用户分页信息
 * @property {Object} loadingUsers - 用户加载状态
 * @property {Object} permissionLimits - 权限上限配置
 * @property {boolean} isGroupAdmin - 是否为组管理员
 * @property {Function} onRemove - 移除组织回调
 * @property {Function} onPermissionToggle - 权限切换回调
 * @property {Function} onInheritanceToggle - 继承开关回调
 * @property {Function} onModuleExpand - 模块展开回调
 * @property {Function} onLoadLessons - 加载课程回调
 * @property {Function} onToggleTags - 展开/收起标签回调
 * @property {Function} onToggleUsers - 展开/收起用户回调
 * @property {Function} onLoadUsers - 加载用户回调
 */

/**
 * 组织面板组件
 */
const GroupItem = React.memo(({
  group,
  allModules,
  moduleLessons,
  loadingLessons,
  userPagination,
  loadingUsers,
  permissionLimits = {},
  isGroupAdmin = false,
  onRemove,
  onPermissionToggle,
  onInheritanceToggle,
  onModuleExpand,
  onLoadLessons,
  onToggleTags,
  onToggleUsers,
  onLoadUsers
}) => {
  const header = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%'
      }}
    >
      <Space>
        <TeamOutlined style={{ fontSize: 18, color: '#1890ff' }} />
        <strong style={{ fontSize: 15 }}>{group.groupName}</strong>
        <Badge count={group.userCount} showZero style={{ backgroundColor: '#52c41a' }} />
        {isGroupAdmin && (
          <Tag color="blue" icon={<InfoCircleOutlined />}>
            本组授权管理
          </Tag>
        )}
      </Space>
      
      {/* 组管理员不能移除组织 */}
      {isGroupAdmin ? (
        <Tooltip title="组管理员不能移除组织授权">
          <Button
            disabled
            size="small"
            icon={<LockOutlined />}
          >
            {BUTTON_TEXTS.REMOVE_AUTH}
          </Button>
        </Tooltip>
      ) : (
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(group.groupId);
          }}
        >
          {BUTTON_TEXTS.REMOVE_AUTH}
        </Button>
      )}
    </div>
  );

  return (
    <Panel
      header={header}
      key={`group-${group.groupId}`}
      style={{
        marginBottom: 16,
        background: 'white',
        borderRadius: 8,
        border: '1px solid #e8e8e8',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{ padding: '8px 0' }}>
        {/* 权限上限提示（组管理员专用） */}
        {isGroupAdmin && Object.keys(permissionLimits).length > 0 && (
          <div style={{ 
            marginBottom: 12, 
            padding: '8px 12px',
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: 4
          }}>
            <Space>
              <InfoCircleOutlined style={{ color: '#1890ff' }} />
              <span style={{ fontSize: 12, color: '#1890ff' }}>
                权限分配受超级管理员授权限制，灰色禁用的选项表示超出授权范围
              </span>
            </Space>
          </div>
        )}

        {/* 组级权限配置 */}
        <ModulePermissionSelector
          groupId={group.groupId}
          tagId={null}
          userId={null}
          permissions={group.modulePermissions || []}
          inheritedPermissions={null}
          allModules={allModules}
          moduleLessons={moduleLessons}
          loadingLessons={loadingLessons}
          permissionLimits={permissionLimits}
          isGroupAdmin={isGroupAdmin}
          onPermissionToggle={onPermissionToggle}
          onModuleExpand={onModuleExpand}
          onLoadLessons={onLoadLessons}
        />

        {/* 标签列表 */}
        <div style={{ marginTop: 16 }}>
          <Button
            type="dashed"
            icon={group.showTags ? <MinusOutlined /> : <PlusOutlined />}
            onClick={() => onToggleTags(group.groupId)}
            block
          >
            {group.showTags ? BUTTON_TEXTS.COLLAPSE_TAGS : BUTTON_TEXTS.EXPAND_TAGS}
          </Button>

          {group.showTags && (
            <div>
              <Divider orientation="left">标签列表</Divider>

              {!group.tags || group.tags.length === 0 ? (
                <Empty
                  description={EMPTY_MESSAGES.NO_TAGS}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {group.tags.map(tag => (
                    <TagItem
                      key={tag.tagId}
                      groupId={group.groupId}
                      tag={tag}
                      groupPermissions={group.modulePermissions}
                      allModules={allModules}
                      moduleLessons={moduleLessons}
                      loadingLessons={loadingLessons}
                      userPagination={userPagination}
                      loadingUsers={loadingUsers[`${group.groupId}-${tag.tagId}`]}
                      permissionLimits={permissionLimits}
                      isGroupAdmin={isGroupAdmin}
                      onPermissionToggle={onPermissionToggle}
                      onInheritanceToggle={onInheritanceToggle}
                      onModuleExpand={onModuleExpand}
                      onLoadLessons={onLoadLessons}
                      onToggleUsers={onToggleUsers}
                      onLoadUsers={onLoadUsers}
                    />
                  ))}
                </Space>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
});

GroupItem.displayName = 'GroupItem';

export default GroupItem;
