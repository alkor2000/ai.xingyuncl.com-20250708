/**
 * 模块权限选择器组件
 * 核心组件：显示所有模块及其权限配置
 * 支持三级权限、课程级权限、继承显示
 * 
 * @module components/ModulePermissionSelector
 */

import React from 'react';
import { Card, Space, Tag, Button, Checkbox, Tooltip, Empty, Spin } from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  ReadOutlined,
  EditOutlined,
  CaretRightOutlined,
  CaretDownOutlined
} from '@ant-design/icons';
import {
  PERMISSION_LEVELS,
  PERMISSION_DESCRIPTIONS,
  EMPTY_MESSAGES,
  TAG_TEXTS
} from '../constants';
import { isPermissionDisabled } from '../utils';

/**
 * 模块权限选择器属性
 * @typedef {Object} ModulePermissionSelectorProps
 * @property {number} groupId - 组ID
 * @property {number|null} tagId - 标签ID（可选）
 * @property {number|null} userId - 用户ID（可选）
 * @property {Array} permissions - 当前权限配置
 * @property {Array} inheritedPermissions - 继承的权限配置
 * @property {Array} allModules - 所有模块列表
 * @property {Object} moduleLessons - 模块课程数据
 * @property {Object} loadingLessons - 课程加载状态
 * @property {Function} onPermissionToggle - 权限切换回调
 * @property {Function} onModuleExpand - 模块展开回调
 * @property {Function} onLoadLessons - 加载课程回调
 */

/**
 * 模块权限选择器组件
 */
const ModulePermissionSelector = React.memo(({
  groupId,
  tagId = null,
  userId = null,
  permissions = [],
  inheritedPermissions = null,
  allModules = [],
  moduleLessons = {},
  loadingLessons = {},
  onPermissionToggle,
  onModuleExpand,
  onLoadLessons
}) => {
  if (allModules.length === 0) {
    return (
      <Card size="small" style={{ marginTop: 12, background: '#fafafa' }}>
        <Empty
          description={EMPTY_MESSAGES.NO_MODULES}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    );
  }

  return (
    <Card size="small" style={{ marginTop: 12, background: '#fafafa' }}>
      {/* 权限说明 */}
      <div style={{ marginBottom: 12 }}>
        <strong>模块与课程权限配置：</strong>
        <Space style={{ marginLeft: 8 }} size={4} wrap>
          <Tag color="cyan" style={{ fontSize: 11 }}>
            <ReadOutlined /> 查看课程
          </Tag>
          <Tag color="blue" style={{ fontSize: 11 }}>
            <FileTextOutlined /> 查看教案
          </Tag>
          <Tag color="purple" style={{ fontSize: 11 }}>
            <EditOutlined /> 编辑权限
          </Tag>
        </Space>
      </div>

      {/* 模块列表 */}
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {allModules.map(module => {
          const perm = permissions.find(p => p.moduleId === module.id);
          const inherited = inheritedPermissions?.find(p => p.moduleId === module.id);

          // 计算实际权限（考虑继承）
          const hasViewLesson = perm?.view_lesson || inherited?.view_lesson || false;
          const hasViewPlan = perm?.view_plan || inherited?.view_plan || false;
          const hasEdit = perm?.edit || inherited?.edit || false;
          const isInherited = !perm && inherited;
          const isExpanded = perm?.expanded || false;

          const lessons = moduleLessons[module.id] || [];
          const hasLessons = (module.lesson_count || 0) > 0;
          const isLoadingLessons = loadingLessons[module.id] || false;

          return (
            <div
              key={module.id}
              style={{
                padding: '8px 12px',
                background: 'white',
                border: '1px solid #e8e8e8',
                borderRadius: 4
              }}
            >
              {/* 模块头部 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%'
                }}
              >
                {/* 左侧：模块信息 */}
                <Space size="small">
                  {hasLessons && (
                    <Button
                      type="text"
                      size="small"
                      icon={isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                      onClick={() => {
                        if (!isExpanded && lessons.length === 0) {
                          onLoadLessons(module.id);
                        }
                        onModuleExpand(groupId, tagId, userId, module.id);
                      }}
                      loading={isLoadingLessons}
                    />
                  )}
                  <BookOutlined style={{ color: '#1890ff' }} />
                  <span>{module.name}</span>
                  {hasLessons && (
                    <Tag color="geekblue" style={{ fontSize: 11 }}>
                      {module.lesson_count}课
                    </Tag>
                  )}
                  {isInherited && (
                    <Tag color="blue" style={{ fontSize: 11 }}>
                      {TAG_TEXTS.INHERITED}
                    </Tag>
                  )}
                </Space>

                {/* 右侧：权限复选框 */}
                <Space size="small">
                  <Tooltip title={PERMISSION_DESCRIPTIONS[PERMISSION_LEVELS.VIEW_LESSON]}>
                    <Checkbox
                      checked={hasViewLesson}
                      disabled={
                        isInherited ||
                        isPermissionDisabled(PERMISSION_LEVELS.VIEW_LESSON, { hasViewPlan, hasEdit })
                      }
                      onChange={() =>
                        onPermissionToggle(
                          groupId,
                          tagId,
                          userId,
                          module.id,
                          null,
                          PERMISSION_LEVELS.VIEW_LESSON,
                          hasViewLesson
                        )
                      }
                    >
                      <ReadOutlined /> 查看课程
                    </Checkbox>
                  </Tooltip>

                  <Tooltip title={PERMISSION_DESCRIPTIONS[PERMISSION_LEVELS.VIEW_PLAN]}>
                    <Checkbox
                      checked={hasViewPlan}
                      disabled={
                        isInherited ||
                        isPermissionDisabled(PERMISSION_LEVELS.VIEW_PLAN, { hasEdit })
                      }
                      onChange={() =>
                        onPermissionToggle(
                          groupId,
                          tagId,
                          userId,
                          module.id,
                          null,
                          PERMISSION_LEVELS.VIEW_PLAN,
                          hasViewPlan
                        )
                      }
                    >
                      <FileTextOutlined /> 查看教案
                    </Checkbox>
                  </Tooltip>

                  <Tooltip title={PERMISSION_DESCRIPTIONS[PERMISSION_LEVELS.EDIT]}>
                    <Checkbox
                      checked={hasEdit}
                      disabled={isInherited}
                      onChange={() =>
                        onPermissionToggle(
                          groupId,
                          tagId,
                          userId,
                          module.id,
                          null,
                          PERMISSION_LEVELS.EDIT,
                          hasEdit
                        )
                      }
                    >
                      <EditOutlined /> 编辑
                    </Checkbox>
                  </Tooltip>
                </Space>
              </div>

              {/* 课程列表（展开时显示）*/}
              {isExpanded && lessons.length > 0 && (
                <div
                  style={{
                    marginLeft: 32,
                    marginTop: 8,
                    paddingLeft: 12,
                    borderLeft: '2px solid #e8e8e8'
                  }}
                >
                  {lessons.map(lesson => {
                    const lessonPerm = perm?.lessons?.find(l => l.lessonId === lesson.id);

                    // 计算课程权限
                    let lessonHasViewLesson = false;
                    let lessonHasViewPlan = false;
                    let lessonHasEdit = false;
                    let lessonExplicitlyDenied = false;

                    if (lessonPerm) {
                      if (lessonPerm.view_lesson === false) {
                        lessonHasViewLesson = false;
                        lessonExplicitlyDenied = true;
                      } else if (lessonPerm.view_lesson === true) {
                        lessonHasViewLesson = true;
                      }

                      lessonHasViewPlan = lessonPerm.view_plan === true;
                      lessonHasEdit = lessonPerm.edit === true;
                    } else {
                      // 继承模块权限
                      lessonHasViewLesson = perm?.view_lesson || inherited?.view_lesson || false;
                      lessonHasViewPlan = perm?.view_plan || inherited?.view_plan || false;
                      lessonHasEdit = perm?.edit || inherited?.edit || false;
                    }

                    return (
                      <div
                        key={lesson.id}
                        style={{
                          padding: '6px 10px',
                          background: lessonExplicitlyDenied ? '#fff2f0' : '#f9f9f9',
                          marginBottom: 6,
                          borderRadius: 3,
                          border: lessonExplicitlyDenied
                            ? '1px solid #ffccc7'
                            : '1px solid transparent'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            width: '100%'
                          }}
                        >
                          {/* 左侧：课程信息 */}
                          <Space size="small">
                            <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
                            <span style={{ fontSize: 13 }}>{lesson.title}</span>
                            {lessonPerm && !lessonExplicitlyDenied && (
                              <Tag color="cyan" style={{ fontSize: 10 }}>
                                {TAG_TEXTS.INDEPENDENT}
                              </Tag>
                            )}
                            {lessonExplicitlyDenied && (
                              <Tag color="red" style={{ fontSize: 10 }}>
                                {TAG_TEXTS.EXPLICIT_DENY}
                              </Tag>
                            )}
                            {!lessonPerm && (
                              <Tag color="blue" style={{ fontSize: 10 }}>
                                {TAG_TEXTS.INHERIT_FROM_MODULE}
                              </Tag>
                            )}
                          </Space>

                          {/* 右侧：课程权限复选框 */}
                          <Space size="small">
                            <Checkbox
                              checked={lessonHasViewLesson}
                              disabled={
                                isPermissionDisabled(PERMISSION_LEVELS.VIEW_LESSON, {
                                  hasViewPlan: lessonHasViewPlan,
                                  hasEdit: lessonHasEdit
                                })
                              }
                              onChange={() =>
                                onPermissionToggle(
                                  groupId,
                                  tagId,
                                  userId,
                                  module.id,
                                  lesson.id,
                                  PERMISSION_LEVELS.VIEW_LESSON,
                                  lessonHasViewLesson
                                )
                              }
                              style={{ fontSize: 12 }}
                            >
                              <ReadOutlined style={{ fontSize: 11 }} /> 课程
                            </Checkbox>

                            <Checkbox
                              checked={lessonHasViewPlan}
                              disabled={isPermissionDisabled(PERMISSION_LEVELS.VIEW_PLAN, {
                                hasEdit: lessonHasEdit
                              })}
                              onChange={() =>
                                onPermissionToggle(
                                  groupId,
                                  tagId,
                                  userId,
                                  module.id,
                                  lesson.id,
                                  PERMISSION_LEVELS.VIEW_PLAN,
                                  lessonHasViewPlan
                                )
                              }
                              style={{ fontSize: 12 }}
                            >
                              <FileTextOutlined style={{ fontSize: 11 }} /> 教案
                            </Checkbox>

                            <Checkbox
                              checked={lessonHasEdit}
                              onChange={() =>
                                onPermissionToggle(
                                  groupId,
                                  tagId,
                                  userId,
                                  module.id,
                                  lesson.id,
                                  PERMISSION_LEVELS.EDIT,
                                  lessonHasEdit
                                )
                              }
                              style={{ fontSize: 12 }}
                            >
                              <EditOutlined style={{ fontSize: 11 }} /> 编辑
                            </Checkbox>
                          </Space>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 加载课程中 */}
              {isExpanded && isLoadingLessons && (
                <div style={{ textAlign: 'center', padding: 12 }}>
                  <Spin size="small" tip="加载课程中..." />
                </div>
              )}
            </div>
          );
        })}
      </Space>
    </Card>
  );
});

ModulePermissionSelector.displayName = 'ModulePermissionSelector';

export default ModulePermissionSelector;
