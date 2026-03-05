/**
 * 工作流编辑器工具栏
 * 提供保存工作流、返回、删除、测试等操作
 * 
 * v1.1 更新：
 * - 保存按钮文案从"保存"改为"保存工作流"，与配置面板的"保存节点"区分
 */

import React from 'react'
import { Button, Space, Tag, Tooltip } from 'antd'
import {
  SaveOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'

const Toolbar = ({
  workflow,
  hasUnsavedChanges,
  onSave,
  onBack,
  onDelete,
  onTest,
  selectedNode,
  selectedEdge
}) => {
  return (
    <div className="workflow-editor-toolbar">
      <div className="toolbar-left">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
        >
          返回列表
        </Button>
        
        <div className="workflow-info">
          <h3>{workflow?.name}</h3>
          {workflow?.is_published && (
            <Tag color="success">已发布</Tag>
          )}
          {hasUnsavedChanges && (
            <Tag color="warning">未保存</Tag>
          )}
        </div>
      </div>
      
      <div className="toolbar-right">
        <Space>
          {/* 删除选中项按钮 */}
          {(selectedNode || selectedEdge) && (
            <Tooltip title="删除选中的节点或连线">
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={onDelete}
              >
                删除
              </Button>
            </Tooltip>
          )}
          
          {/* 测试运行按钮 */}
          <Tooltip title="测试运行工作流">
            <Button
              type="default"
              icon={<PlayCircleOutlined />}
              onClick={onTest}
            >
              测试运行
            </Button>
          </Tooltip>
          
          {/* v1.1: 文案从"保存"改为"保存工作流" */}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            disabled={!hasUnsavedChanges}
          >
            保存工作流
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default Toolbar
