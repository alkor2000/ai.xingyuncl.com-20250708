/**
 * 权限说明提示组件
 * 显示三级权限体系的使用说明
 * 
 * @module components/PermissionHelpAlert
 */

import React from 'react';
import { Alert, Tag, Space, Divider } from 'antd';
import { ReadOutlined, FileTextOutlined, EditOutlined } from '@ant-design/icons';
import { HELP_TEXTS } from '../constants';

/**
 * 权限帮助提示组件
 */
const PermissionHelpAlert = React.memo(() => {
  return (
    <Alert
      message={HELP_TEXTS.THREE_LEVEL_TITLE}
      description={
        <div>
          <Space direction="vertical" size={4}>
            <div>
              <Tag color="cyan">
                <ReadOutlined /> Level 1 - 查看课程
              </Tag>
              学生权限，仅能查看课程内容
            </div>
            <div>
              <Tag color="blue">
                <FileTextOutlined /> Level 2 - 查看教案
              </Tag>
              教师权限，可查看课程+教案
            </div>
            <div>
              <Tag color="purple">
                <EditOutlined /> Level 3 - 编辑权限
              </Tag>
              完全控制，可查看课程+教案+编辑
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, color: '#666' }}>
              {HELP_TEXTS.CASCADE_RULE}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>
              {HELP_TEXTS.INHERIT_RULE}
            </div>
          </Space>
        </div>
      }
      type="info"
      showIcon
      closable
      style={{ marginBottom: 16 }}
    />
  );
});

PermissionHelpAlert.displayName = 'PermissionHelpAlert';

export default PermissionHelpAlert;
