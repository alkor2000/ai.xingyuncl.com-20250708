/**
 * LLM节点 - AI大模型对话
 * 显示模型配置详情
 * v1.1 - P3优化：去除硬编码模型名和映射表，动态显示模型名
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { RobotOutlined, ThunderboltOutlined, FileTextOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const LLMNode = ({ data, selected }) => {
  const config = data.config || {}
  // v1.1: 去除硬编码默认值，未配置时显示提示文字
  const model = config.model || ''
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.max_tokens ?? 2000
  const systemPrompt = config.system_prompt || ''
  
  /**
   * 智能提取模型显示名称
   * v1.1: 不再使用硬编码映射表，而是从模型名中智能提取可读名称
   * 支持各种格式：
   * - "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet"
   * - "openai/gpt-4o" → "gpt-4o"
   * - "gpt-4" → "gpt-4"
   * @param {string} modelId - 原始模型标识符
   * @returns {string} 可读的显示名称
   */
  const getModelDisplayName = (modelId) => {
    if (!modelId) return '未选择模型'
    
    // 如果包含 provider/ 前缀（如 openai/gpt-4o），取最后部分
    let name = modelId
    if (name.includes('/')) {
      const parts = name.split('/')
      name = parts[parts.length - 1]
    }
    
    // 去除尾部日期版本号（如 -20241022、-20250101）
    name = name.replace(/-\d{8}$/, '')
    
    return name
  }
  
  const modelName = getModelDisplayName(model)
  
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
          <div className="param-value model-name" style={!model ? { color: '#999', fontStyle: 'italic' } : {}}>
            {modelName}
          </div>
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
