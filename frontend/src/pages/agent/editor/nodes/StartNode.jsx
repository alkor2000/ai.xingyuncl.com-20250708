/**
 * 开始节点 - 工作流入口
 * 显示输入参数定义
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { PlayCircleOutlined, KeyOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const StartNode = ({ data, selected }) => {
  // 解析输入参数
  let inputParams = []
  if (data.config?.input_schema) {
    try {
      const schema = typeof data.config.input_schema === 'string' 
        ? JSON.parse(data.config.input_schema) 
        : data.config.input_schema
      
      inputParams = Object.entries(schema).map(([key, value]) => ({
        name: key,
        type: typeof value,
        value: String(value).substring(0, 20)
      }))
    } catch (e) {
      // 解析失败，忽略
    }
  }
  
  return (
    <div className={`custom-node start-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header">
        <PlayCircleOutlined className="node-icon" />
        <span className="node-title">{data.label || '开始'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        <div className="node-section">
          <div className="section-title">
            <KeyOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            输入参数
          </div>
          {inputParams.length > 0 ? (
            <div className="param-list">
              {inputParams.slice(0, 3).map((param, idx) => (
                <Tooltip key={idx} title={`${param.name}: ${param.value}`}>
                  <div className="param-item">
                    <span className="param-name">{param.name}</span>
                    <span className="param-type">{param.type}</span>
                  </div>
                </Tooltip>
              ))}
              {inputParams.length > 3 && (
                <div className="param-more">+{inputParams.length - 3} 更多</div>
              )}
            </div>
          ) : (
            <div className="param-empty">未配置参数</div>
          )}
        </div>
      </div>
      
      {/* 底部描述 */}
      <div className="node-footer">
        <span className="node-hint">工作流入口点</span>
      </div>
      
      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="custom-handle"
        style={{ background: '#52c41a' }}
      />
    </div>
  )
}

export default StartNode
