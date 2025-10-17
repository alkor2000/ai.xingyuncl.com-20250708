/**
 * LLM节点 - AI大模型对话
 * 显示模型配置详情
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { RobotOutlined, ThunderboltOutlined, FileTextOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const LLMNode = ({ data, selected }) => {
  const config = data.config || {}
  const model = config.model || 'claude-3-5-sonnet-20241022'
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.max_tokens ?? 1000
  const systemPrompt = config.system_prompt || ''
  
  // 模型显示名称
  const modelNames = {
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
    'gpt-4': 'GPT-4',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo'
  }
  
  const modelName = modelNames[model] || model
  
  return (
    <div className={`custom-node llm-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header">
        <RobotOutlined className="node-icon" />
        <span className="node-title">{data.label || 'LLM对话'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* AI模型 */}
        <div className="node-section">
          <div className="section-title">
            <RobotOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            AI模型
          </div>
          <div className="param-value model-name">{modelName}</div>
        </div>
        
        {/* 参数配置 */}
        <div className="node-section">
          <div className="section-title">
            <ThunderboltOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            参数
          </div>
          <div className="param-list">
            <div className="param-item">
              <span className="param-name">温度</span>
              <span className="param-value">{temperature}</span>
            </div>
            <div className="param-item">
              <span className="param-name">最大Token</span>
              <span className="param-value">{maxTokens}</span>
            </div>
          </div>
        </div>
        
        {/* 系统提示词预览 */}
        {systemPrompt && (
          <div className="node-section">
            <div className="section-title">
              <FileTextOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
              系统提示词
            </div>
            <Tooltip title={systemPrompt}>
              <div className="prompt-preview">
                {systemPrompt.split('\n').slice(0, 2).map((line, idx) => (
                  <div key={idx} className="prompt-line">
                    {line.substring(0, 30)}{line.length > 30 ? '...' : ''}
                  </div>
                ))}
                {systemPrompt.split('\n').length > 2 && (
                  <div className="prompt-more">...</div>
                )}
              </div>
            </Tooltip>
          </div>
        )}
      </div>
      
      {/* 底部描述 */}
      <div className="node-footer">
        <span className="node-hint">AI模型对话节点</span>
      </div>
      
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#1890ff' }}
      />
      
      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="custom-handle"
        style={{ background: '#1890ff' }}
      />
    </div>
  )
}

export default LLMNode
