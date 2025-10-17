/**
 * 结束节点 - 工作流出口
 * 显示输出映射配置
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { CheckCircleOutlined, ExportOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const EndNode = ({ data, selected }) => {
  const config = data.config || {}
  const outputMapping = config.output_mapping || ''
  
  return (
    <div className={`custom-node end-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header">
        <CheckCircleOutlined className="node-icon" />
        <span className="node-title">{data.label || '结束'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        <div className="node-section">
          <div className="section-title">
            <ExportOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            输出映射
          </div>
          {outputMapping ? (
            <Tooltip title={outputMapping}>
              <div className="output-preview">
                {outputMapping.substring(0, 40)}
                {outputMapping.length > 40 && '...'}
              </div>
            </Tooltip>
          ) : (
            <div className="param-empty">使用默认输出</div>
          )}
        </div>
      </div>
      
      {/* 底部描述 */}
      <div className="node-footer">
        <span className="node-hint">工作流结束点</span>
      </div>
      
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#ff4d4f' }}
      />
    </div>
  )
}

export default EndNode
