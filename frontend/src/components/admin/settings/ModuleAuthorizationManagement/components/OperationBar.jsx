/**
 * 顶部操作栏组件
 * 包含：新建授权、刷新、重置、保存按钮
 * 
 * @module components/OperationBar
 */

import React from 'react';
import { Card, Button, Space, Tag } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { BUTTON_TEXTS, WARNING_MESSAGES } from '../constants';

/**
 * 操作栏组件属性
 * @typedef {Object} OperationBarProps
 * @property {Function} onNewAuth - 新建授权回调
 * @property {Function} onRefresh - 刷新回调
 * @property {Function} onReset - 重置回调
 * @property {Function} onSave - 保存回调
 * @property {boolean} loading - 加载状态
 * @property {boolean} saving - 保存状态
 * @property {boolean} hasUnsavedChanges - 是否有未保存的更改
 */

/**
 * 顶部操作栏组件
 */
const OperationBar = React.memo(({
  onNewAuth,
  onRefresh,
  onReset,
  onSave,
  loading = false,
  saving = false,
  hasUnsavedChanges = false
}) => {
  return (
    <Card style={{ marginBottom: 16 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        {/* 左侧操作按钮 */}
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onNewAuth}
            disabled={loading}
          >
            {BUTTON_TEXTS.NEW_AUTH}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={loading}
          >
            {BUTTON_TEXTS.REFRESH}
          </Button>
        </Space>

        {/* 右侧保存按钮 */}
        <Space>
          {hasUnsavedChanges && (
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
              {WARNING_MESSAGES.UNSAVED_CHANGES}
            </Tag>
          )}
          <Button
            onClick={onReset}
            disabled={!hasUnsavedChanges || loading || saving}
          >
            {BUTTON_TEXTS.RESET}
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            loading={saving}
            disabled={!hasUnsavedChanges || loading}
          >
            {BUTTON_TEXTS.SAVE}
          </Button>
        </Space>
      </Space>
    </Card>
  );
});

OperationBar.displayName = 'OperationBar';

export default OperationBar;
