/**
 * 用户标签分配组件 - 管理用户的标签
 */

import React, { useState, useEffect } from 'react'
import { 
  Modal, 
  Select, 
  Tag, 
  Space, 
  Spin,
  message,
  Alert,
  Empty
} from 'antd'
import {
  TagsOutlined,
  UserOutlined
} from '@ant-design/icons'
import apiClient from '../../../utils/api'

const UserTagAssign = ({ 
  visible, 
  user, 
  groupId,
  onCancel, 
  onSuccess 
}) => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [allTags, setAllTags] = useState([])
  const [userTagIds, setUserTagIds] = useState([])
  const [initialTagIds, setInitialTagIds] = useState([])

  // 加载组内所有标签
  const loadGroupTags = async () => {
    if (!groupId) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/user-tags/group/${groupId}`)
      setAllTags(response.data.data || [])
    } catch (error) {
      message.error('加载标签列表失败')
      console.error('加载标签失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 加载用户当前标签
  const loadUserTags = async () => {
    if (!user?.id) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/user-tags/user/${user.id}`)
      const tags = response.data.data || []
      const tagIds = tags.map(t => t.id)
      setUserTagIds(tagIds)
      setInitialTagIds(tagIds)
    } catch (error) {
      message.error('加载用户标签失败')
      console.error('加载用户标签失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible && user) {
      loadGroupTags()
      loadUserTags()
    }
  }, [visible, user, groupId])

  // 保存标签分配
  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient.put(`/admin/user-tags/user/${user.id}`, {
        tagIds: userTagIds
      })
      
      message.success('标签更新成功')
      onSuccess && onSuccess()
      handleClose()
    } catch (error) {
      message.error(error.response?.data?.message || '更新标签失败')
    } finally {
      setSaving(false)
    }
  }

  // 关闭弹窗
  const handleClose = () => {
    setUserTagIds([])
    setInitialTagIds([])
    setAllTags([])
    onCancel()
  }

  // 判断是否有改动
  const hasChanges = () => {
    if (userTagIds.length !== initialTagIds.length) return true
    return !userTagIds.every(id => initialTagIds.includes(id))
  }

  return (
    <Modal
      title={
        <Space>
          <UserOutlined />
          <span>管理用户标签</span>
          {user && (
            <Tag color="blue">{user.username}</Tag>
          )}
        </Space>
      }
      open={visible}
      onOk={handleSave}
      onCancel={handleClose}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={600}
      okButtonProps={{ disabled: !hasChanges() }}
    >
      <Spin spinning={loading}>
        <div style={{ marginBottom: 16 }}>
          <Alert
            message="标签说明"
            description="为用户分配标签后，可以通过标签快速筛选和管理用户。同一用户可以拥有多个标签。"
            type="info"
            showIcon
          />
        </div>

        {allTags.length > 0 ? (
          <>
            <div style={{ marginBottom: 8 }}>
              <strong>选择标签：</strong>
            </div>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="选择要分配的标签"
              value={userTagIds}
              onChange={setUserTagIds}
              optionLabelProp="label"
              maxTagCount="responsive"
            >
              {allTags.map(tag => (
                <Select.Option 
                  key={tag.id} 
                  value={tag.id}
                  label={tag.name}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div 
                      style={{
                        width: 16,
                        height: 16,
                        backgroundColor: tag.color,
                        borderRadius: 2,
                        flexShrink: 0
                      }}
                    />
                    <span>{tag.name}</span>
                    {tag.description && (
                      <span style={{ color: '#999', fontSize: 12 }}>
                        ({tag.description})
                      </span>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select>

            {/* 显示当前选中的标签 */}
            {userTagIds.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>已选标签：</strong>
                </div>
                <Space wrap>
                  {userTagIds.map(tagId => {
                    const tag = allTags.find(t => t.id === tagId)
                    return tag ? (
                      <Tag 
                        key={tag.id}
                        color={tag.color}
                        closable
                        onClose={() => {
                          setUserTagIds(userTagIds.filter(id => id !== tagId))
                        }}
                      >
                        {tag.name}
                      </Tag>
                    ) : null
                  })}
                </Space>
              </div>
            )}
          </>
        ) : (
          <Empty 
            description="该组暂无标签，请先创建标签"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Spin>
    </Modal>
  )
}

export default UserTagAssign
