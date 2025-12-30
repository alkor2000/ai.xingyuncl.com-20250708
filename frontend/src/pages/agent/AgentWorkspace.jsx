/**
 * Agent工作流主工作区 v2.0
 * 简化版本，直接渲染工作流列表
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import WorkflowList from './WorkflowList'
import './AgentWorkspace.less'

/**
 * Agent工作区主组件
 * 直接展示工作流列表，无Tab切换
 */
const AgentWorkspace = () => {
  const { t } = useTranslation()

  return (
    <div className="agent-workspace">
      <WorkflowList />
    </div>
  )
}

export default AgentWorkspace
