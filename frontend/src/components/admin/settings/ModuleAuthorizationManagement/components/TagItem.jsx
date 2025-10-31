/**
 * 标签卡片组件
 * 显示单个标签的权限配置
 * 支持：继承开关、独立权限配置、用户列表展开
 * 
 * @module components/TagItem
 */

import React from 'react';
import { Card, Space, Tag, Switch, Button, Empty, Divider, Pagination } from 'antd';
import { TagOutlined, PlusOutlined, MinusOutlined } from '@ant-design/icons';
import ModulePermissionSelector from './ModulePermissionSelector';
import UserItem from './UserItem';
import { TAG_TEXTS, BUTTON_TEXTS, EMPTY_MESSAGES } from '../constants';

/**
 * 标签卡片组件属性
 * @typedef {Object} TagItemProps
 * @property {number} groupId - 组ID
 * @property {Object} tag - 标签数据
 * @property {Array} groupPermissions - 组权限
 * @property {Array} allModules - 所有模块列表
 * @property {Object} moduleLessons - 模块课程数据
 * @property {Object} loadingLessons - 课程加载状态
 * @property {Object} userPagination - 用户分页信息
 * @property {boolean} loadingUsers - 用户加载状态
 * @property {Function} onPermissionToggle - 权限切换回调
 * @property {Function} onInheritanceToggle - 继承开关回调
 * @property {Function} onModuleExpand - 模块展开回调
 * @property {Function} onLoadLessons - 加载课程回调
 * @property {Function} onToggleUsers - 展开/收起用户回调
 * @property {Function} onLoadUsers - 加载用户回调
 */

/**
 * 标签卡片组件
 */
const TagItem = React.memo(({
  groupId,
  tag,
  groupPermissions,
  allModules,
  moduleLessons,
  loadingLessons,
  userPagination,
  loadingUsers,
  onPermissionToggle,
  onInheritanceToggle,
  onModuleExpand,
  onLoadLessons,
  onToggleUsers,
  onLoadUsers
}) => {
  const tagUserKey = `${groupId}-${tag.tagId}`;
  const pagination = userPagination[tagUserKey];

  return (
    <Card
      key={tag.tagId}
      size="small"
      style={{
        marginLeft: 40,
        marginBottom: 12,
        background: '#f5f5f5'
      }}
      title={
        <Space>
          <Tag color={tag.tagColor}>
            <TagOutlined /> {tag.tagName}
          </Tag>
          <Tag>{tag.userCount || 0} 人</Tag>
        </Space>
      }
    >
      <div>
        {/* 继承开关 */}
        <Space style={{ marginBottom: 12 }}>
          <Switch
            checked={tag.inheritFromGroup}
            onChange={(checked) => {
              onInheritanceToggle(
                groupId,
                tag.tagId,
                null,
                checked,
                groupPermissions
              );
            }}
          />
          <span>继承组权限</span>
          {!tag.inheritFromGroup && (
            <Tag color="orange" style={{ fontSize: 11 }}>
              {TAG_TEXTS.INDEPENDENT}
            </Tag>
          )}
        </Space>

        {/* 独立权限配置 */}
        {!tag.inheritFromGroup && (
          <ModulePermissionSelector
            groupId={groupId}
            tagId={tag.tagId}
            userId={null}
            permissions={tag.modulePermissions || []}
            inheritedPermissions={tag.inheritFromGroup ? groupPermissions : null}
            allModules={allModules}
            moduleLessons={moduleLessons}
            loadingLessons={loadingLessons}
            onPermissionToggle={onPermissionToggle}
            onModuleExpand={onModuleExpand}
            onLoadLessons={onLoadLessons}
          />
        )}

        {/* 用户列表展开按钮 */}
        <div style={{ marginTop: 16 }}>
          <Button
            type="dashed"
            icon={tag.showUsers ? <MinusOutlined /> : <PlusOutlined />}
            onClick={() => onToggleUsers(groupId, tag.tagId)}
            loading={loadingUsers}
            block
            size="small"
          >
            {tag.showUsers
              ? BUTTON_TEXTS.COLLAPSE_USERS(tag.userCount)
              : BUTTON_TEXTS.EXPAND_USERS(tag.userCount)}
          </Button>

          {/* 用户列表 */}
          {tag.showUsers && (
            <div>
              <Divider orientation="left" style={{ fontSize: 13 }}>
                用户列表
              </Divider>

              {!tag.users || tag.users.length === 0 ? (
                <Empty
                  description={EMPTY_MESSAGES.NO_USERS}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <>
                  {tag.users.map(user => (
                    <UserItem
                      key={user.userId}
                      groupId={groupId}
                      tagId={tag.tagId}
                      user={user}
                      groupPermissions={groupPermissions}
                      tagPermissions={tag.modulePermissions}
                      tagInheritsGroup={tag.inheritFromGroup}
                      allModules={allModules}
                      moduleLessons={moduleLessons}
                      loadingLessons={loadingLessons}
                      onPermissionToggle={onPermissionToggle}
                      onInheritanceToggle={onInheritanceToggle}
                      onModuleExpand={onModuleExpand}
                      onLoadLessons={onLoadLessons}
                    />
                  ))}

                  {/* 分页 */}
                  {pagination && pagination.pages > 1 && (
                    <div style={{ textAlign: 'center', marginTop: 16 }}>
                      <Pagination
                        current={pagination.page}
                        total={pagination.total}
                        pageSize={pagination.limit}
                        onChange={(page) => onLoadUsers(groupId, tag.tagId, page)}
                        showSizeChanger={false}
                        showTotal={(total) => `共 ${total} 位用户`}
                        size="small"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});

TagItem.displayName = 'TagItem';

export default TagItem;
