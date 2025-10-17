/**
 * Agent工作流主工作区
 * 统一入口，内部使用Tab切换：工作流列表、执行历史
 */

import React, { useState } from 'react'
import { Card, Tabs } from 'antd'
import {
  AppstoreOutlined,
  HistoryOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import WorkflowList from './WorkflowList'
import ExecutionHistory from './ExecutionHistory'
import './AgentWorkspace.less'

const AgentWorkspace = () => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('workflows')

  // Tab配置
  const tabItems = [
    {
      key: 'workflows',
      label: (
        <span>
          <AppstoreOutlined />
          工作流列表
        </span>
      ),
      children: <WorkflowList />
    },
    {
      key: 'executions',
      label: (
        <span>
          <HistoryOutlined />
          执行历史
        </span>
      ),
      children: <ExecutionHistory />
    }
  ]

  return (
    <div className="agent-workspace">
      <Card
        className="agent-workspace-card"
        bodyStyle={{ padding: 0 }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="large"
          className="agent-workspace-tabs"
        />
      </Card>
    </div>
  )
}

export default AgentWorkspace
