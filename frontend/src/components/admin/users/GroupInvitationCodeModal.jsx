/**
 * 组邀请码管理Modal组件
 */

import React, { useState, useEffect } from 'react'
import { 
  Modal, 
  Form, 
  Input, 
  Switch, 
  InputNumber, 
  DatePicker, 
  Button, 
  message, 
  Space, 
  Alert,
  Divider,
  Typography,
  Tag,
  Tooltip,
  Row,
  Col
} from 'antd'
import { 
  LinkOutlined, 
  CopyOutlined, 
  ReloadOutlined,
  InfoCircleOutlined 
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import moment from 'moment'

const { Text } = Typography

const GroupInvitationCodeModal = ({
  visible,
  group,
  onOk,
  onCancel,
  loading = false
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [enabled, setEnabled] = useState(false)
  const [invitationCode, setInvitationCode] = useState('')

  useEffect(() => {
    if (group && visible) {
      // 设置初始值
      const isEnabled = group.invitation_enabled || false
      setEnabled(isEnabled)
      setInvitationCode(group.invitation_code || generateRandomCode())
      
      form.setFieldsValue({
        enabled: isEnabled,
        code: group.invitation_code || generateRandomCode(),
        max_uses: group.invitation_max_uses || null,
        expire_at: group.invitation_expire_at ? moment(group.invitation_expire_at) : null
      })
    }
  }, [group, visible, form])

  // 生成随机5位邀请码
  const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  // 重新生成邀请码
  const regenerateCode = () => {
    const newCode = generateRandomCode()
    setInvitationCode(newCode)
    form.setFieldsValue({ code: newCode })
    message.success('已生成新的邀请码')
  }

  // 复制邀请码
  const copyCode = () => {
    const code = form.getFieldValue('code')
    if (!code) return
    
    navigator.clipboard.writeText(code).then(() => {
      message.success('邀请码已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  }

  // 处理提交
  const handleSubmit = () => {
    form.validateFields().then(values => {
      // 格式化数据
      const data = {
        enabled: values.enabled,
        code: values.enabled ? values.code.toUpperCase() : null,
        max_uses: values.enabled ? values.max_uses : null,
        expire_at: values.enabled && values.expire_at ? 
          values.expire_at.format('YYYY-MM-DD HH:mm:ss') : null
      }
      
      onOk(data)
    }).catch(error => {
      console.error('表单验证失败:', error)
    })
  }

  // 获取已使用信息
  const getUsageInfo = () => {
    if (!group) return null
    
    const usageCount = group.invitation_usage_count || 0
    const maxUses = group.invitation_max_uses
    
    if (maxUses) {
      return `已使用 ${usageCount} / ${maxUses} 次`
    }
    return `已使用 ${usageCount} 次`
  }

  return (
    <Modal
      title={
        <Space>
          <LinkOutlined />
          <span>管理邀请码 - {group?.name}</span>
        </Space>
      }
      open={visible}
      onOk={handleSubmit}
      onCancel={onCancel}
      confirmLoading={loading}
      width={600}
      okText="保存"
      cancelText="取消"
    >
      {group && group.invitation_enabled && (
        <Alert
          message="当前邀请码状态"
          description={
            <Space direction="vertical">
              <div>邀请码：<Tag style={{ fontFamily: 'monospace' }}>{group.invitation_code}</Tag></div>
              <div>{getUsageInfo()}</div>
              {group.invitation_expire_at && (
                <div>
                  过期时间：{moment(group.invitation_expire_at).format('YYYY-MM-DD HH:mm')}
                  {moment(group.invitation_expire_at).isBefore(moment()) && (
                    <Tag color="error" style={{ marginLeft: 8 }}>已过期</Tag>
                  )}
                </div>
              )}
            </Space>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          enabled: false,
          code: generateRandomCode(),
          max_uses: null,
          expire_at: null
        }}
      >
        <Form.Item
          name="enabled"
          valuePropName="checked"
          label="启用邀请码"
        >
          <Switch
            checkedChildren="已启用"
            unCheckedChildren="未启用"
            onChange={setEnabled}
          />
        </Form.Item>

        {enabled && (
          <>
            <Divider />
            
            <Form.Item
              name="code"
              label="邀请码"
              rules={[
                { required: true, message: '请输入邀请码' },
                { len: 5, message: '邀请码必须是5位字符' },
                { 
                  pattern: /^[A-Za-z0-9]{5}$/, 
                  message: '邀请码只能包含字母和数字' 
                }
              ]}
              extra="5位英文字母或数字，不区分大小写"
            >
              <Input
                placeholder="输入5位邀请码"
                style={{ textTransform: 'uppercase' }}
                maxLength={5}
                addonAfter={
                  <Space>
                    <Tooltip title="重新生成">
                      <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={regenerateCode}
                      />
                    </Tooltip>
                    <Tooltip title="复制邀请码">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={copyCode}
                      />
                    </Tooltip>
                  </Space>
                }
              />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="max_uses"
                  label={
                    <Space>
                      <span>最大使用次数</span>
                      <Tooltip title="留空表示无限制">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <InputNumber
                    min={1}
                    placeholder="无限制"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item
                  name="expire_at"
                  label={
                    <Space>
                      <span>过期时间</span>
                      <Tooltip title="留空表示永不过期">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <DatePicker
                    showTime
                    format="YYYY-MM-DD HH:mm"
                    placeholder="选择过期时间"
                    style={{ width: '100%' }}
                    disabledDate={(current) => {
                      // 不能选择今天之前的日期
                      return current && current < moment().startOf('day')
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Alert
              message="使用说明"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                  <li>用户注册时输入邀请码，将自动加入该组</li>
                  <li>邀请码不区分大小写，系统会自动转换为大写</li>
                  <li>修改邀请码后，原邀请码将失效</li>
                  <li>使用记录将被保存，可在"查看邀请记录"中查看</li>
                </ul>
              }
              type="info"
              showIcon
            />
          </>
        )}
      </Form>
    </Modal>
  )
}

export default GroupInvitationCodeModal
