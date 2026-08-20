/**
 * Agent工作流主工作区 v2.1
 * 简化版容器组件，直接渲染工作流列表，无 Tab 切换
 *
 * v2.1 清理：
 *   移除未被使用的 useTranslation 引入。
 *   本组件自身不渲染任何文案，国际化由子组件 WorkflowList 自行处理，
 *   保留无用的 hook 调用会造成不必要的重渲染订阅。
 */

import React from 'react'
import WorkflowList from './WorkflowList'
import './AgentWorkspace.less'

/**
 * Agent工作区主组件
 * 作为路由级容器，仅负责布局外壳，具体内容由 WorkflowList 承载
 */
const AgentWorkspace = () => {
  return (
    <div className="agent-workspace">
      <WorkflowList />
    </div>
  )
}

export default AgentWorkspace
