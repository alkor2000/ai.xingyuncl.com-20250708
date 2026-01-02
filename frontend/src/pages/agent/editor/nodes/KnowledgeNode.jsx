/**
 * 知识库节点 - 知识检索/直接加载
 * v2.0 - 支持显示已选Wiki和Token数量
 * 从知识库中加载内容作为上下文
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { 
  DatabaseOutlined, 
  FileTextOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { Tag, Tooltip } from 'antd'

const KnowledgeNode = ({ data, selected }) => {
  const config = data.config || {}
  const source = config.source || 'wiki'
  const mode = config.mode || 'direct'
  const wikiIds = config.wiki_ids || []
  const selectedWikis = config.selected_wikis || []
  
  // 计算总Token
  const totalTokens = selectedWikis.reduce((sum, w) => sum + (w.tokens || 0), 0)
  const formatTokens = (tokens) => {
    if (tokens === 0) return '0'
    if (tokens < 1000) return `${tokens}`
    return `${(tokens / 1000).toFixed(1)}K`
  }
  
  // 加载模式显示名称
  const modeNames = {
    direct: '直接加载',
    vector: '向量检索',
    keyword: '关键词检索'
  }
  
  // 范围图标
  const scopeIcons = {
    personal: <UserOutlined style={{ fontSize: '10px', color: '#007AFF' }} />,
    team: <TeamOutlined style={{ fontSize: '10px', color: '#34C759' }} />,
    global: <GlobalOutlined style={{ fontSize: '10px', color: '#FF9500' }} />
  }
  
  return (
    <div className={`custom-node knowledge-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)' }}>
        <DatabaseOutlined className="node-icon" />
        <span className="node-title">{data.label || '知识检索'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* 数据来源和模式 */}
        <div className="node-section">
          <div className="section-title">
            <FileTextOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            配置
          </div>
          <div className="param-list">
            <div className="param-item">
              <span className="param-name">来源</span>
              <span className="param-value">{source === 'wiki' ? '知识库' : source}</span>
            </div>
            <div className="param-item">
              <span className="param-name">模式</span>
              <span className="param-value">{modeNames[mode] || mode}</span>
            </div>
          </div>
        </div>
        
        {/* 已选知识库 */}
        {wikiIds.length > 0 ? (
          <div className="node-section">
            <div className="section-title">
              <DatabaseOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
              已选知识库 ({wikiIds.length}个)
            </div>
            <div style={{ marginTop: '6px' }}>
              {selectedWikis.length > 0 ? (
                <>
                  {selectedWikis.slice(0, 2).map((wiki, index) => (
                    <Tooltip key={wiki.id || index} title={`${wiki.title} - ${wiki.tokens_display || '?'} tokens`}>
                      <Tag 
                        color="purple" 
                        style={{ 
                          marginBottom: '4px', 
                          fontSize: '11px',
                          maxWidth: '120px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {scopeIcons[wiki.scope]}
                        <span style={{ marginLeft: '4px' }}>{wiki.title}</span>
                      </Tag>
                    </Tooltip>
                  ))}
                  {selectedWikis.length > 2 && (
                    <Tag color="default" style={{ fontSize: '11px' }}>
                      +{selectedWikis.length - 2}
                    </Tag>
                  )}
                </>
              ) : (
                <Tag color="default" style={{ fontSize: '11px' }}>
                  {wikiIds.length} 个已选
                </Tag>
              )}
            </div>
          </div>
        ) : (
          <div className="node-section">
            <div className="section-title" style={{ color: '#999' }}>
              未选择知识库
            </div>
          </div>
        )}
      </div>
      
      {/* 底部 - Token统计 */}
      <div className="node-footer" style={{ 
        background: totalTokens > 0 ? '#f6ffed' : '#f5f5f5',
        borderTop: '1px solid #e8e8e8',
        padding: '6px 10px',
        borderRadius: '0 0 8px 8px'
      }}>
        {totalTokens > 0 ? (
          <span style={{ color: '#52c41a', fontSize: '11px', fontWeight: 500 }}>
            📊 总计 {formatTokens(totalTokens)} tokens
          </span>
        ) : (
          <span className="node-hint">请配置知识库</span>
        )}
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
