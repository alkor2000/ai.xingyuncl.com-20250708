/**
 * 工作流测试抽屉
 * 在编辑器中直接测试工作流
 */

import React, { useState } from 'react'
import { Drawer, Button, Form, Input, Alert, Steps, Card, Tag, Space, Spin, message } from 'antd'
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import useAgentStore from '../../../../stores/agentStore'

const { TextArea } = Input
const { Step } = Steps

const TestDrawer = ({ open, onClose, workflow, nodes }) => {
  const [form] = Form.useForm()
  const { executeWorkflow } = useAgentStore()
  
  const [executing, setExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [error, setError] = useState(null)
  
  // 获取 START 节点的输入参数配置
  const getStartNodeConfig = () => {
    const startNode = nodes.find(n => n.type === 'start')
    if (!startNode) return {}
    
    try {
      const inputSchema = startNode.data?.config?.input_schema
      if (typeof inputSchema === 'string') {
        return JSON.parse(inputSchema)
      }
      return inputSchema || {}
    } catch (e) {
      return {}
    }
  }
  
  // 执行工作流
  const handleExecute = async (values) => {
    if (!workflow?.id) {
      message.error('工作流ID不存在')
      return
    }
    
    setExecuting(true)
    setError(null)
    setExecutionResult(null)
    
    try {
      // 解析输入参数
      let inputData = {}
      if (values.input_json) {
        try {
          inputData = JSON.parse(values.input_json)
        } catch (e) {
          message.error('输入参数格式错误，请检查JSON格式')
          setExecuting(false)
          return
        }
      }
      
      const result = await executeWorkflow(workflow.id, inputData)
      setExecutionResult(result)
      message.success('工作流执行成功')
    } catch (err) {
      setError(err.message || '执行失败')
      message.error('工作流执行失败')
    } finally {
      setExecuting(false)
    }
  }
  
  // 渲染节点执行状态
  const renderNodeExecutions = () => {
    if (!executionResult?.nodeExecutions) return null
    
    return (
      <div style={{ marginTop: 16 }}>
        <h4>节点执行详情</h4>
        <Steps direction="vertical" current={executionResult.nodeExecutions.length}>
          {executionResult.nodeExecutions.map((nodeExec, index) => {
            const statusIcon = nodeExec.status === 'completed' 
              ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
              : nodeExec.status === 'failed'
              ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              : <LoadingOutlined />
            
            return (
              <Step
                key={nodeExec.node_id}
                title={
                  <Space>
                    {nodeExec.node_type}
                    <Tag color={nodeExec.status === 'completed' ? 'success' : 'error'}>
                      {nodeExec.status}
                    </Tag>
                  </Space>
                }
                description={
                  <Card size="small" style={{ marginTop: 8 }}>
                    {nodeExec.output && (
                      <div>
                        <strong>输出：</strong>
                        <pre style={{ 
                          background: '#f5f5f5', 
                          padding: 8, 
                          borderRadius: 4,
                          marginTop: 8,
                          maxHeight: 200,
                          overflow: 'auto'
                        }}>
                          {typeof nodeExec.output === 'string' 
                            ? nodeExec.output 
                            : JSON.stringify(nodeExec.output, null, 2)
                          }
                        </pre>
                      </div>
                    )}
                    {nodeExec.error_message && (
                      <Alert
                        type="error"
                        message={nodeExec.error_message}
                        style={{ marginTop: 8 }}
                      />
                    )}
                    <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                      <ClockCircleOutlined /> 执行时间: {nodeExec.execution_time || 0}ms
                    </div>
                  </Card>
                }
                icon={statusIcon}
              />
            )
          })}
        </Steps>
      </div>
    )
  }
  
  return (
    <Drawer
      title="测试运行工作流"
      placement="right"
      width={600}
      onClose={onClose}
      open={open}
      destroyOnClose
    >
      <Alert
        message="测试模式"
        description="在这里可以快速测试工作流的执行效果，无需离开编辑器。请确保工作流已保存。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleExecute}
      >
        <Form.Item
          label="输入参数（JSON格式）"
          name="input_json"
          help="根据START节点配置的参数格式输入"
        >
          <TextArea
            rows={6}
            placeholder='例如: {"param1": "value1", "query": "你好"}'
            disabled={executing}
          />
        </Form.Item>
        
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            icon={<PlayCircleOutlined />}
            loading={executing}
            block
            size="large"
          >
            {executing ? '执行中...' : '开始执行'}
          </Button>
        </Form.Item>
      </Form>
      
      {executing && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" tip="工作流执行中，请稍候..." />
        </div>
      )}
      
      {error && (
        <Alert
          message="执行失败"
          description={error}
          type="error"
          showIcon
          closable
          style={{ marginTop: 16 }}
        />
      )}
      
      {executionResult && (
        <div style={{ marginTop: 16 }}>
          <Card title="执行结果" size="small">
            <div>
              <Tag color={executionResult.status === 'completed' ? 'success' : 'error'}>
                {executionResult.status}
              </Tag>
              <span style={{ marginLeft: 8 }}>
                执行ID: {executionResult.executionId}
              </span>
            </div>
            
            {executionResult.output && (
              <div style={{ marginTop: 16 }}>
                <strong>最终输出：</strong>
                <pre style={{ 
                  background: '#f5f5f5', 
                  padding: 12, 
                  borderRadius: 4,
                  marginTop: 8,
                  maxHeight: 300,
                  overflow: 'auto'
                }}>
                  {typeof executionResult.output === 'string' 
                    ? executionResult.output 
                    : JSON.stringify(executionResult.output, null, 2)
                  }
                </pre>
              </div>
            )}
            
            {executionResult.credits && (
              <div style={{ marginTop: 16 }}>
                <Alert
                  message={`消耗积分: ${executionResult.credits.used}`}
                  type="info"
                  showIcon
                />
              </div>
            )}
          </Card>
          
          {renderNodeExecutions()}
        </div>
      )}
    </Drawer>
  )
}

export default TestDrawer
