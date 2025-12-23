/**
 * 批量创建用户弹窗组件
 * 
 * 功能：
 * - 支持用户名规则生成（前缀 + 连接符 + 序号）
 * - 从组积分池扣减积分
 * - 支持自定义密码或随机生成
 * - 预览用户名示例
 * - 创建结果导出（用户名和密码列表）
 * 
 * v1.1 新增
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Alert,
  Space,
  Divider,
  Table,
  Typography,
  Tooltip,
  Card,
  Row,
  Col,
  Statistic,
  Switch,
  message
} from 'antd'
import {
  UserAddOutlined,
  InfoCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Text, Title } = Typography
const { Option } = Select

/**
 * 批量创建用户弹窗
 * @param {boolean} visible - 是否显示
 * @param {Array} userGroups - 用户组列表
 * @param {Object} currentUser - 当前登录用户
 * @param {boolean} loading - 加载状态
 * @param {Function} onSubmit - 提交回调
 * @param {Function} onCancel - 取消回调
 */
const BatchCreateUsersModal = ({
  visible,
  userGroups = [],
  currentUser = {},
  loading = false,
  onSubmit,
  onCancel
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  
  // 状态管理
  const [useCustomPassword, setUseCustomPassword] = useState(false)
  const [createResult, setCreateResult] = useState(null)
  const [previewVisible, setPreviewVisible] = useState(false)
  
  // 判断用户角色
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isGroupAdmin = currentUser?.role === 'admin'
  
  // 过滤可选的用户组
  const availableGroups = useMemo(() => {
    if (isSuperAdmin) {
      return userGroups.filter(g => g.is_active && g.id !== 1) // 超管可选所有活跃组（除默认组）
    }
    // 组管理员只能选自己的组
    return userGroups.filter(g => g.id === currentUser?.group_id)
  }, [userGroups, currentUser, isSuperAdmin])
  
  // 获取选中组的信息
  const selectedGroupId = Form.useWatch('group_id', form)
  const selectedGroup = useMemo(() => {
    return userGroups.find(g => g.id === selectedGroupId)
  }, [userGroups, selectedGroupId])
  
  // 计算组积分池剩余
  const poolRemaining = useMemo(() => {
    if (!selectedGroup) return 0
    return (selectedGroup.credits_pool || 0) - (selectedGroup.credits_pool_used || 0)
  }, [selectedGroup])
  
  // 表单值监听，用于预览
  const formValues = Form.useWatch([], form)
  
  // 生成用户名预览
  const usernamePreview = useMemo(() => {
    if (!formValues) return []
    
    const {
      username_prefix = '',
      username_connector = '_',
      start_number = 1,
      number_digits = 3,
      count = 0
    } = formValues
    
    if (!username_prefix || count <= 0) return []
    
    const previews = []
    const previewCount = Math.min(count, 5) // 最多预览5个
    
    for (let i = 0; i < previewCount; i++) {
      const num = start_number + i
      const paddedNum = String(num).padStart(number_digits, '0')
      previews.push(`${username_prefix}${username_connector}${paddedNum}`)
    }
    
    if (count > 5) {
      previews.push('...')
      const lastNum = start_number + count - 1
      const lastPaddedNum = String(lastNum).padStart(number_digits, '0')
      previews.push(`${username_prefix}${username_connector}${lastPaddedNum}`)
    }
    
    return previews
  }, [formValues])
  
  // 计算总需积分
  const totalCreditsNeeded = useMemo(() => {
    if (!formValues) return 0
    const { count = 0, credits_per_user = 0 } = formValues
    return count * credits_per_user
  }, [formValues])
  
  // 检查积分是否充足
  const isCreditsEnough = totalCreditsNeeded <= poolRemaining
  
  // 重置表单
  useEffect(() => {
    if (visible) {
      setCreateResult(null)
      form.resetFields()
      
      // 如果是组管理员，自动选择自己的组
      if (isGroupAdmin && currentUser?.group_id) {
        form.setFieldValue('group_id', currentUser.group_id)
      }
    }
  }, [visible, form, isGroupAdmin, currentUser])
  
  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      
      // 检查积分
      if (values.credits_per_user > 0 && !isCreditsEnough) {
        message.error('组积分池余额不足')
        return
      }
      
      // 调用父组件提交
      const result = await onSubmit(values)
      
      if (result && result.success) {
        setCreateResult(result)
        message.success(`成功创建 ${result.created_count} 个用户`)
      }
    } catch (error) {
      console.error('批量创建用户失败:', error)
    }
  }
  
  // 复制用户列表到剪贴板
  const handleCopyUsers = () => {
    if (!createResult?.users) return
    
    const text = createResult.users.map(u => 
      `${u.username}\t${u.password}`
    ).join('\n')
    
    navigator.clipboard.writeText(text)
      .then(() => message.success('已复制到剪贴板'))
      .catch(() => message.error('复制失败'))
  }
  
  // 导出用户列表为CSV
  const handleExportUsers = () => {
    if (!createResult?.users) return
    
    const headers = ['用户名', '密码', '初始积分']
    const rows = createResult.users.map(u => [u.username, u.password, u.credits])
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n')
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `batch_users_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    
    message.success('已导出用户列表')
  }
  
  // 结果表格列定义
  const resultColumns = [
    {
      title: '序号',
      dataIndex: 'index',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 150
    },
    {
      title: '密码',
      dataIndex: 'password',
      key: 'password',
      width: 120,
      render: (text) => (
        <Text copyable={{ text }}>{text}</Text>
      )
    },
    {
      title: '初始积分',
      dataIndex: 'credits',
      key: 'credits',
      width: 100
    }
  ]
  
  // 渲染创建结果
  const renderResult = () => (
    <div>
      <Alert
        message={
          <Space>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <span>批量创建成功</span>
          </Space>
        }
        description={
          <div>
            <p>成功创建 <strong>{createResult.created_count}</strong> 个用户</p>
            {createResult.total_credits_used > 0 && (
              <p>共消耗组积分池 <strong>{createResult.total_credits_used}</strong> 积分</p>
            )}
          </div>
        }
        type="success"
        showIcon={false}
        style={{ marginBottom: 16 }}
      />
      
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<CopyOutlined />} onClick={handleCopyUsers}>
          复制用户列表
        </Button>
        <Button icon={<DownloadOutlined />} onClick={handleExportUsers}>
          导出CSV文件
        </Button>
      </Space>
      
      <Table
        dataSource={createResult.users}
        columns={resultColumns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ y: 300 }}
      />
    </div>
  )
  
  // 渲染表单
  const renderForm = () => (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        username_connector: '_',
        start_number: 1,
        number_digits: 3,
        count: 10,
        credits_per_user: 0
      }}
    >
      {/* 目标用户组 */}
      <Form.Item
        name="group_id"
        label="目标用户组"
        rules={[{ required: true, message: '请选择目标用户组' }]}
        extra="新用户将被添加到此组，积分从组积分池扣除"
      >
        <Select
          placeholder="请选择用户组"
          disabled={isGroupAdmin}
        >
          {availableGroups.map(group => (
            <Option key={group.id} value={group.id}>
              <Space>
                <span style={{ color: group.color }}>{group.name}</span>
                <Text type="secondary">
                  (剩余积分: {(group.credits_pool || 0) - (group.credits_pool_used || 0)})
                </Text>
              </Space>
            </Option>
          ))}
        </Select>
      </Form.Item>
      
      {/* 组信息展示 */}
      {selectedGroup && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Statistic
                title="组积分池总额"
                value={selectedGroup.credits_pool || 0}
                suffix="积分"
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="已使用"
                value={selectedGroup.credits_pool_used || 0}
                suffix="积分"
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="剩余可用"
                value={poolRemaining}
                suffix="积分"
                valueStyle={{ color: poolRemaining > 0 ? '#3f8600' : '#cf1322' }}
              />
            </Col>
          </Row>
        </Card>
      )}
      
      <Divider orientation="left">用户名规则</Divider>
      
      <Row gutter={16}>
        <Col span={12}>
          {/* 用户名前缀 */}
          <Form.Item
            name="username_prefix"
            label="用户名前缀"
            rules={[
              { required: true, message: '请输入用户名前缀' },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: '只能包含字母、数字、下划线和横线' }
            ]}
            extra="如: student, user, test"
          >
            <Input placeholder="例如: student" maxLength={20} />
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* 连接符 */}
          <Form.Item
            name="username_connector"
            label="连接符"
            extra="前缀和序号之间的连接符"
          >
            <Select>
              <Option value="_">下划线 (_)</Option>
              <Option value="-">横线 (-)</Option>
              <Option value="">无连接符</Option>
            </Select>
          </Form.Item>
        </Col>
      </Row>
      
      <Row gutter={16}>
        <Col span={8}>
          {/* 起始序号 */}
          <Form.Item
            name="start_number"
            label="起始序号"
            rules={[{ required: true, message: '请输入起始序号' }]}
          >
            <InputNumber min={1} max={99999} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          {/* 序号位数 */}
          <Form.Item
            name="number_digits"
            label={
              <Space>
                序号位数
                <Tooltip title="序号补零的位数，如3位则显示001、002">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            }
          >
            <Select>
              <Option value={1}>1位 (1, 2, 3...)</Option>
              <Option value={2}>2位 (01, 02, 03...)</Option>
              <Option value={3}>3位 (001, 002, 003...)</Option>
              <Option value={4}>4位 (0001, 0002...)</Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={8}>
          {/* 创建数量 */}
          <Form.Item
            name="count"
            label="创建数量"
            rules={[
              { required: true, message: '请输入创建数量' },
              { type: 'number', min: 1, max: 500, message: '数量必须在1-500之间' }
            ]}
          >
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
      
      {/* 用户名预览 */}
      {usernamePreview.length > 0 && (
        <Alert
          message="用户名预览"
          description={
            <Space wrap>
              {usernamePreview.map((name, index) => (
                <Text key={index} code>{name}</Text>
              ))}
            </Space>
          }
          type="info"
          showIcon
          icon={<EyeOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}
      
      <Divider orientation="left">积分与密码</Divider>
      
      <Row gutter={16}>
        <Col span={12}>
          {/* 每用户积分 */}
          <Form.Item
            name="credits_per_user"
            label={
              <Space>
                每用户初始积分
                <Tooltip title="从组积分池扣除，0表示不分配积分">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: '请输入每用户积分' }]}
          >
            <InputNumber min={0} max={poolRemaining} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* 总需积分显示 */}
          <Form.Item label="总需积分">
            <Statistic
              value={totalCreditsNeeded}
              suffix="积分"
              valueStyle={{ 
                color: isCreditsEnough ? '#3f8600' : '#cf1322',
                fontSize: 20
              }}
            />
          </Form.Item>
        </Col>
      </Row>
      
      {/* 积分不足警告 */}
      {totalCreditsNeeded > 0 && !isCreditsEnough && (
        <Alert
          message="组积分池余额不足"
          description={`需要 ${totalCreditsNeeded} 积分，当前剩余 ${poolRemaining} 积分`}
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}
      
      {/* 密码设置 */}
      <Form.Item label="密码设置">
        <Space>
          <Switch
            checked={useCustomPassword}
            onChange={setUseCustomPassword}
          />
          <Text>{useCustomPassword ? '使用统一密码' : '随机生成密码'}</Text>
        </Space>
      </Form.Item>
      
      {useCustomPassword && (
        <Form.Item
          name="password"
          label="统一密码"
          rules={[
            { required: useCustomPassword, message: '请输入统一密码' },
            { min: 6, message: '密码长度至少6位' }
          ]}
          extra="所有用户将使用此密码"
        >
          <Input.Password placeholder="请输入统一密码" />
        </Form.Item>
      )}
      
      {!useCustomPassword && (
        <Alert
          message="将为每个用户生成8位随机密码（字母+数字）"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
    </Form>
  )
  
  return (
    <Modal
      title={
        <Space>
          <UserAddOutlined />
          {createResult ? '批量创建结果' : '批量创建用户'}
        </Space>
      }
      open={visible}
      onCancel={() => {
        setCreateResult(null)
        onCancel()
      }}
      width={700}
      footer={
        createResult ? (
          <Button type="primary" onClick={() => {
            setCreateResult(null)
            onCancel()
          }}>
            完成
          </Button>
        ) : (
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={loading}
              disabled={totalCreditsNeeded > 0 && !isCreditsEnough}
            >
              开始创建
            </Button>
          </Space>
        )
      }
      destroyOnClose
    >
      {createResult ? renderResult() : renderForm()}
    </Modal>
  )
}

export default BatchCreateUsersModal
