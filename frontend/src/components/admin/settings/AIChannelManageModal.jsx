/**
 * AI渠道管理弹窗
 *
 * 背景：为避免"每个AI模型都要单独填一遍API密钥+API端点"的重复劳动，
 * 引入"渠道"概念——渠道=一个API接入点(名称+Base URL+Key)，创建/编辑AI模型时
 * 可直接选择某个渠道，系统会自动使用该渠道当前的URL和Key，无需重复填写。
 *
 * 技术方案（刻意不新增数据库表，避免开发/生产环境的迁移同步成本）：
 *   渠道列表以JSON数组的形式存储在已有的system_settings表(setting_key='ai_channels_config')，
 *   与本系统已有的oss_config/sso_config/embedding_config等配置存储方式完全一致的模式，
 *   零数据库结构变更。每个渠道的api_key在存储前使用cryptoHelper加密，本弹窗展示的
 *   api_key_masked为后端脱敏后的值（首尾可见中间掩码），弹窗本身不会拿到明文密钥。
 *
 * 与AI模型的关联方式：
 *   AI模型表(ai_models)不新增channel_id字段，选择渠道创建/编辑模型时，前端仅传递
 *   channel_id，后端在AIModelController中实时解析该渠道当前的base_url+api_key
 *   并填入模型的api_endpoint/api_key字段直接存库——即"渠道"只是创建/编辑时的一个
 *   填充助手，不建立持久化的强关联；这意味着后续渠道密钥更换后，已创建的模型不会
 *   自动同步，需要在模型编辑时重新选择该渠道才会拉取最新值。
 */

import React, { useEffect, useState } from 'react'
import { Modal, List, Button, Input, Form, Row, Col, Space, Popconfirm, Typography, Empty, message } from 'antd'
import { EditOutlined, DeleteOutlined, PlusOutlined, ApiOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../../stores/adminStore'

const { Text } = Typography

const AIChannelManageModal = ({ visible, onCancel }) => {
  const { t } = useTranslation()
  const { aiChannels, getAIChannels, createAIChannel, updateAIChannel, deleteAIChannel } = useAdminStore()

  const [form] = Form.useForm()
  const [submitLoading, setSubmitLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  // 当前正在编辑的渠道ID，null表示处于"新增"态
  const [editingChannelId, setEditingChannelId] = useState(null)

  // 弹窗打开时刷新渠道列表；关闭时复位编辑态，避免下次打开残留上次编辑内容
  useEffect(() => {
    if (visible) {
      setListLoading(true)
      getAIChannels()
        .catch(() => message.error(t('admin.channels.error.load')))
        .finally(() => setListLoading(false))
    } else {
      setEditingChannelId(null)
      form.resetFields()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  /** 点击列表项的"编辑"：把渠道信息填入底部表单，api_key留空(脱敏值不可回填明文) */
  const handleEditClick = (channel) => {
    setEditingChannelId(channel.id)
    form.setFieldsValue({
      name: channel.name,
      base_url: channel.base_url,
      api_key: undefined
    })
  }

  /** 取消编辑，恢复为"新增"态 */
  const handleCancelEdit = () => {
    setEditingChannelId(null)
    form.resetFields()
  }

  /** 删除渠道 */
  const handleDelete = async (channelId) => {
    try {
      await deleteAIChannel(channelId)
      message.success(t('admin.channels.success.delete'))
      if (editingChannelId === channelId) {
        handleCancelEdit()
      }
    } catch (error) {
      message.error(error.response?.data?.message || t('admin.channels.error.delete'))
    }
  }

  /** 提交底部表单：根据是否处于编辑态分别调用创建/更新接口 */
  const handleSubmit = async (values) => {
    setSubmitLoading(true)
    try {
      if (editingChannelId) {
        await updateAIChannel(editingChannelId, values)
        message.success(t('admin.channels.success.update'))
      } else {
        await createAIChannel(values)
        message.success(t('admin.channels.success.create'))
      }
      setEditingChannelId(null)
      form.resetFields()
    } catch (error) {
      const fallbackMsg = editingChannelId ? t('admin.channels.error.update') : t('admin.channels.error.create')
      message.error(error.response?.data?.message || fallbackMsg)
    } finally {
      setSubmitLoading(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <ApiOutlined />
          {t('admin.channels.title')}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={760}
      destroyOnClose
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('admin.channels.description')}
      </Text>

      <List
        style={{ marginTop: 16, maxHeight: 320, overflowY: 'auto' }}
        loading={listLoading}
        dataSource={aiChannels}
        locale={{ emptyText: <Empty description={t('admin.channels.empty')} /> }}
        renderItem={(channel) => (
          <List.Item
            key={channel.id}
            actions={[
              <Button
                key="edit"
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEditClick(channel)}
              />,
              <Popconfirm
                key="delete"
                title={t('admin.channels.delete.confirm')}
                onConfirm={() => handleDelete(channel.id)}
                okText={t('button.confirm')}
                cancelText={t('button.cancel')}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={channel.name}
              description={
                <Space size={8} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>{channel.base_url}</Text>
                  <Text code style={{ fontSize: 12 }}>{channel.api_key_masked || '-'}</Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}
      >
        <Row gutter={8} align="bottom">
          <Col span={5}>
            <Form.Item
              name="name"
              label={t('admin.channels.form.name')}
              rules={[{ required: true, message: t('admin.channels.form.name.required') }]}
            >
              <Input placeholder={t('admin.channels.form.name.placeholder')} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="base_url"
              label={t('admin.channels.form.baseUrl')}
              rules={[{ required: true, message: t('admin.channels.form.baseUrl.required') }]}
            >
              <Input placeholder={t('admin.channels.form.baseUrl.placeholder')} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item
              name="api_key"
              label={t('admin.channels.form.apiKey')}
              rules={[{ required: !editingChannelId, message: t('admin.channels.form.apiKey.required') }]}
            >
              <Input.Password
                placeholder={editingChannelId
                  ? t('admin.channels.form.apiKey.placeholder.edit')
                  : t('admin.channels.form.apiKey.placeholder.new')}
                autoComplete="new-password"
              />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item label=" ">
              <Space>
                <Button type="primary" htmlType="submit" loading={submitLoading} icon={<PlusOutlined />}>
                  {editingChannelId ? t('admin.channels.update') : t('admin.channels.add')}
                </Button>
              </Space>
            </Form.Item>
          </Col>
        </Row>
        {editingChannelId && (
          <div style={{ textAlign: 'right', marginTop: -8 }}>
            <Button size="small" onClick={handleCancelEdit}>
              {t('admin.channels.cancelEdit')}
            </Button>
          </div>
        )}
      </Form>
    </Modal>
  )
}

export default AIChannelManageModal
