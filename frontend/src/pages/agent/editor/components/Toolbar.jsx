/**
 * 工作流编辑器工具栏 v1.1
 * 提供返回列表、删除选中项、API接入、测试运行、保存工作流等操作
 *
 * v1.1 国际化改造：
 *   接入 useTranslation，将原先硬编码的 9 处中文文案
 *   （返回列表 / 已发布 / 未保存 / 删除 / 删除选中的节点或连线 /
 *     API接入 / 管理外部API接入 / 测试运行 / 测试运行工作流 / 保存工作流）
 *   全部替换为 agent.toolbar.* 与 agent.workflow.* 翻译键。
 */

import React from 'react'
import { Button, Space, Tag, Tooltip } from 'antd'
import {
  SaveOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ApiOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

/**
 * 编辑器顶部工具栏组件
 *
 * @param {Object} workflow - 当前工作流对象
 * @param {boolean} hasUnsavedChanges - 是否存在未保存的更改
 * @param {Function} onSave - 保存回调
 * @param {Function} onBack - 返回列表回调
 * @param {Function} onDelete - 删除选中节点/连线回调
 * @param {Function} onTest - 测试运行回调
 * @param {Function} onApiAccess - 打开 API 接入管理回调
 * @param {Object} selectedNode - 当前选中的节点（用于控制删除按钮显示）
 * @param {Object} selectedEdge - 当前选中的连线（用于控制删除按钮显示）
 */
const Toolbar = ({
  workflow,
  hasUnsavedChanges,
  onSave,
  onBack,
  onDelete,
  onTest,
  onApiAccess,
  selectedNode,
  selectedEdge
}) => {
  const { t } = useTranslation()

  return (
    <div className="workflow-editor-toolbar">
      {/* 左侧区域：返回按钮 + 工作流名称与状态标签 */}
      <div className="toolbar-left">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          {t('agent.toolbar.back')}
        </Button>

        <div className="workflow-info">
          <h3>{workflow?.name}</h3>
          {/* 已发布状态标签 */}
          {!!workflow?.is_published && (
            <Tag color="success">{t('agent.workflow.published')}</Tag>
          )}
          {/* 未保存更改提示标签 */}
          {hasUnsavedChanges && (
            <Tag color="warning">{t('agent.toolbar.unsaved')}</Tag>
          )}
        </div>
      </div>

      {/* 右侧区域：操作按钮组 */}
      <div className="toolbar-right">
        <Space>
          {/* 删除选中项按钮：仅在有选中节点或连线时显示 */}
          {(selectedNode || selectedEdge) && (
            <Tooltip title={t('agent.toolbar.deleteTip')}>
              <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                {t('agent.toolbar.delete')}
              </Button>
            </Tooltip>
          )}

          {/* API 接入管理按钮 */}
          <Tooltip title={t('agent.toolbar.apiAccessTip')}>
            <Button icon={<ApiOutlined />} onClick={onApiAccess}>
              {t('agent.toolbar.apiAccess')}
            </Button>
          </Tooltip>

          {/* 测试运行按钮 */}
          <Tooltip title={t('agent.toolbar.testTip')}>
            <Button type="default" icon={<PlayCircleOutlined />} onClick={onTest}>
              {t('agent.toolbar.test')}
            </Button>
          </Tooltip>

          {/* 保存工作流按钮：无未保存更改时禁用 */}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            disabled={!hasUnsavedChanges}
          >
            {t('agent.toolbar.save')}
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default Toolbar
