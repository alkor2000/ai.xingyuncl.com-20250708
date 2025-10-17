/**
 * 知识库节点 - 知识检索
 * 从知识库中检索相关内容
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { DatabaseOutlined, SearchOutlined, NumberOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const KnowledgeNode = ({ data, selected }) => {
  const config = data.config || {}
  const knowledgeBase = config.knowledge_base || '未选择'
  const searchMode = config.search_mode || 'vector'
  const topK = config.top_k || 5
  const threshold = config.threshold || 0.7
  
  // 检索模式显示名称
  const searchModeNames = {
    vector: '向量检索',
    keyword: '关键词检索',
    hybrid: '混合检索'
  }
  
  return (
    <div className={`custom-node knowledge-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header">
        <DatabaseOutlined className="node-icon" />
        <span className="node-title">{data.label || '知识检索'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* 知识库 */}
        <div className="node-section">
          <div className="section-title">
            <DatabaseOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            知识库
          </div>
          <div className="param-value">{knowledgeBase}</div>
        </div>
        
        {/* 检索配置 */}
        <div className="node-section">
          <div className="section-title">
            <SearchOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            检索配置
          </div>
          <div className="param-list">
            <div className="param-item">
              <span className="param-name">模式</span>
              <span className="param-value">{searchModeNames[searchMode]}</span>
            </div>
            <div className="param-item">
              <span className="param-name">Top-K</span>
              <span className="param-value">{topK}</span>
            </div>
            <div className="param-item">
              <span className="param-name">相似度</span>
              <span className="param-value">{threshold}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* 底部描述 */}
      <div className="node-footer">
        <span className="node-hint">知识库检索节点（预留）</span>
      </div>
      
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#722ed1' }}
      />
      
      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="custom-handle"
        style={{ background: '#722ed1' }}
      />
    </div>
  )
}

export default KnowledgeNode
