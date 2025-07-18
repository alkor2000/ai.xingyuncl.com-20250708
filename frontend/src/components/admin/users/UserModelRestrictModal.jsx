/**
 * 用户模型限制管理弹窗组件
 */

import React, { useState, useEffect } from 'react'
import { Modal, Checkbox, Space, Tag, Alert, Spin, message, Empty } from 'antd'
import { RobotOutlined, ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'
import apiClient from '../../../utils/api'

const UserModelRestrictModal = ({
  visible,
  user,
  onCancel,
  onSuccess
}) => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelPermissions, setModelPermissions] = useState(null)
  const [restrictedModelIds, setRestrictedModelIds] = useState([])

  // 加载用户的模型权限信息
  const loadModelPermissions = async () => {
    if (!user?.id) return
    
    setLoading(true)
    try {
      const response = await apiClient.get(`/admin/users/${user.id}/model-permissions`)
      const data = response.data.data
      setModelPermissions(data)
      
      // 设置当前限制的模型ID列表
      const restrictedIds = data.models
        .filter(m => m.is_restricted)
        .map(m => m.id)
      setRestrictedModelIds(restrictedIds)
    } catch (error) {
      message.error('获取模型权限信息失败')
      console.error('加载模型权限失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 保存模型限制
  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient.put(`/admin/users/${user.id}/model-restrictions`, {
        restricted_model_ids: restrictedModelIds
      })
      
      message.success('模型权限更新成功')
      if (onSuccess) {
        onSuccess()
      }
      onCancel()
    } catch (error) {
      message.error(error.response?.data?.message || '更新模型权限失败')
    } finally {
      setSaving(false)
    }
  }

  // 处理复选框变化
  const handleCheckboxChange = (modelId, checked) => {
    if (checked) {
      // 添加限制
      setRestrictedModelIds([...restrictedModelIds, modelId])
    } else {
      // 移除限制
      setRestrictedModelIds(restrictedModelIds.filter(id => id !== modelId))
    }
  }

  useEffect(() => {
    if (visible && user) {
      loadModelPermissions()
    }
  }, [visible, user])

  // 计算统计信息
  const totalModels = modelPermissions?.models?.length || 0
  const restrictedCount = restrictedModelIds.length
  const availableCount = totalModels - restrictedCount

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined />
          {user ? `管理 [${user.username}] 的AI模型权限` : '管理模型权限'}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleSave}
      confirmLoading={saving}
      width={700}
      okText="保存"
      cancelText="取消"
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
        </div>
      ) : modelPermissions ? (
        <>
          {/* 提示信息 */}
          <Alert
            message="设置说明"
            description={
              <div>
                <p>• 勾选的模型将被<strong>限制使用</strong>，用户无法在聊天中选择这些模型</p>
                <p>• 未勾选的模型用户可以正常使用</p>
                <p>• 至少需要保留一个可用模型</p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          {/* 统计信息 */}
          <div style={{ marginBottom: 16, padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
            <Space size="large">
              <span>
                用户组：<Tag color="blue">{modelPermissions.group_name || '默认分组'}</Tag>
              </span>
              <span>
                总模型数：<strong>{totalModels}</strong>
              </span>
              <span>
                限制使用：<strong style={{ color: '#ff4d4f' }}>{restrictedCount}</strong>
              </span>
              <span>
                可以使用：<strong style={{ color: '#52c41a' }}>{availableCount}</strong>
              </span>
            </Space>
          </div>

          {/* 模型列表 */}
          {totalModels > 0 ? (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {modelPermissions.models.map(model => {
                  const isRestricted = restrictedModelIds.includes(model.id)
                  const isLastAvailable = availableCount === 1 && !isRestricted
                  
                  return (
                    <div
                      key={model.id}
                      style={{
                        padding: '12px',
                        border: '1px solid #e8e8e8',
                        borderRadius: '4px',
                        background: isRestricted ? '#fff1f0' : '#f6ffed'
                      }}
                    >
                      <Checkbox
                        checked={isRestricted}
                        disabled={isLastAvailable}
                        onChange={(e) => handleCheckboxChange(model.id, e.target.checked)}
                      >
                        <Space>
                          <span style={{ fontWeight: 'bold' }}>{model.display_name}</span>
                          <Tag color="blue">{model.credits_per_chat} 积分/次</Tag>
                          {model.stream_enabled && (
                            <Tag color="processing">流式</Tag>
                          )}
                          {model.image_upload_enabled && (
                            <Tag color="success">支持图片</Tag>
                          )}
                          {isRestricted ? (
                            <Tag color="error" icon={<ExclamationCircleOutlined />}>
                              已限制
                            </Tag>
                          ) : (
                            <Tag color="success" icon={<CheckCircleOutlined />}>
                              可使用
                            </Tag>
                          )}
                        </Space>
                      </Checkbox>
                      {isLastAvailable && (
                        <div style={{ marginTop: 4, marginLeft: 24, color: '#ff4d4f', fontSize: '12px' }}>
                          * 这是最后一个可用模型，不能限制
                        </div>
                      )}
                    </div>
                  )
                })}
              </Space>
            </div>
          ) : (
            <Empty description="该用户组暂无可用模型" />
          )}

          {/* 限制过多警告 */}
          {restrictedCount > totalModels * 0.8 && availableCount > 0 && (
            <Alert
              message="警告"
              description={`您已限制了 ${restrictedCount} 个模型，用户只剩 ${availableCount} 个可用模型`}
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </>
      ) : (
        <Empty description="暂无数据" />
      )}
    </Modal>
  )
}

export default UserModelRestrictModal
