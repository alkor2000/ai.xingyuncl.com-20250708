/**
 * LLM节点 - AI大模型对话
 * v1.3 - 模型显示名称优化：优先使用config.model_display_name
 * v1.4 - max_tokens默认fallback从2000改为5000
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { RobotOutlined, ThunderboltOutlined, FileTextOutlined } from '@ant-design/icons'

const LLMNode = ({ data, selected }) => {
  const config = data.config || {}
  const model = config.model || ''
  const temperature = config.temperature ?? 0.7
  /* v1.4: 默认fallback改为5000，与ConfigPanel initialValue保持一致 */
  const maxTokens = config.max_tokens ?? 5000
  const systemPrompt = config.system_prompt || ''
  
  /**
   * 获取模型显示名称
   * 优先使用ConfigPanel保存的display_name，回退到智能提取
   */
  const getModelDisplayName = (modelId) => {
    /* 优先使用配置中保存的显示名称 */
    if (config.model_display_name) {
      return config.model_display_name
    }
    
    if (!modelId) return '未选择模型'
    
    /* 如果包含 provider/ 前缀，取最后部分 */
    let name = modelId
    if (name.includes('/')) {
      const parts = name.split('/')
      name = parts[parts.length - 1]
    }
    
    /* 去除尾部日期版本号 */
    name = name.replace(/-\d{8}$/, '')
    
    return name
  }
  
  const modelName = getModelDisplayName(model)
  
  /**
   * 截断系统提示词用于预览
   * 保留前200个字符
   */
  const getPromptPreview = (prompt) => {
    if (!prompt) return ''
    const trimmed = prompt.substring(0, 200)
    return trimmed + (prompt.length > 200 ? '...' : '')
  }
  
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
            <RobotOutlined style={{ fontSize: '15px', marginRight: '4px' }} />
            AI模型
          </div>
          <div className="param-value model-name" style={!model ? { color: '#999', fontStyle: 'italic' } : {}}>
            {modelName}
          </div>
        </div>
        
        {/* 参数配置 */}
        <div className="node-section">
          <div className="section-title">
            <ThunderboltOutlined style={{ fontSize: '15px', marginRight: '4px' }} />
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
              <FileTextOutlined style={{ fontSize: '15px', marginRight: '4px' }} />
              系统提示词
            </div>
            <div className="prompt-preview llm-prompt-expanded">
              {getPromptPreview(systemPrompt)}
            </div>
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
