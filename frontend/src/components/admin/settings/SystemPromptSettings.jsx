/**
 * 系统提示词设置组件
 */

import React, { useState, useEffect } from 'react'
import { Card, message } from 'antd'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'
import SystemPromptTable from './SystemPromptTable'
import SystemPromptFormModal from './SystemPromptFormModal'

const SystemPromptSettings = ({ disabled = false }) => {
  const { t } = useTranslation()
  const { getSystemPrompts } = useAdminStore()
  const [modalVisible, setModalVisible] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(null)

  // 加载系统提示词列表
  useEffect(() => {
    getSystemPrompts()
  }, [getSystemPrompts])

  // 处理编辑
  const handleEdit = (prompt) => {
    setEditingPrompt(prompt)
    setModalVisible(true)
  }

  // 处理成功
  const handleSuccess = () => {
    setModalVisible(false)
    setEditingPrompt(null)
    getSystemPrompts() // 刷新列表
  }

  // 处理取消
  const handleCancel = () => {
    setModalVisible(false)
    setEditingPrompt(null)
  }

  return (
    <Card 
      title="系统提示词管理" 
      extra={
        <span style={{ color: '#999', fontSize: '14px' }}>
          配置预设的AI角色和行为规则
        </span>
      }
    >
      <SystemPromptTable 
        onEdit={handleEdit} 
        disabled={disabled}
      />
      
      <SystemPromptFormModal
        visible={modalVisible}
        prompt={editingPrompt}
        onCancel={handleCancel}
        onSuccess={handleSuccess}
      />
    </Card>
  )
}

export default SystemPromptSettings
