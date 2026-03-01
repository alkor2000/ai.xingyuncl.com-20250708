/**
 * 知识库节点 - 知识检索/直接加载
 * v2.0 - 支持显示已选Wiki和Token数量
 * v3.0 - 视觉优化：颜色对比度增强，节点更大更清晰
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
    personal: <UserOutlined style={{ fontSize: '11px', color: '#1890ff' }} />,
    team: <TeamOutlined style={{ fontSize: '11px', color: '#52c41a' }} />,
    global: <GlobalOutlined style={{ fontSize: '11px', color: '#fa8c16' }} />
  }
  
  return (
    <div className={`custom-node knowledge-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 - 深紫色背景白色文字 */}
      <div className="node-header">
        <DatabaseOutlined className="node-icon" />
        <span className="node-title">{data.label || '知识检索'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* 配置信息 */}
        <div className="node-section">
          <div className="section-title">
            <FileTextOutlined style={{ fontSize: '13px', marginRight: '4px' }} />
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
              <DatabaseOutlined style={{ fontSize: '13px', marginRight: '4px' }} />
              已选知识库 ({wikiIds.length}个)
            </div>
            <div style={{ marginTop: '6px' }}>
              {selectedWikis.length > 0 ? (
                <>
                  {selectedWikis.slice(0, 3).map((wiki, index) => (
                    <Tooltip key={wiki.id || index} title={`${wiki.title} - ${wiki.tokens_display || '?'} tokens`}>
                      <Tag 
                        color="purple" 
                        style={{ 
                          marginBottom: '4px', 
                          fontSize: '12px',
                          maxWidth: '180px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {scopeIcons[wiki.scope]}
                        <span>{wiki.title}</span>
                      </Tag>
                    </Tooltip>
                  ))}
                  {selectedWikis.length > 3 && (
                    <Tag color="default" style={{ fontSize: '12px' }}>
                      +{selectedWikis.length - 3}
                    </Tag>
                  )}
                </>
              ) : (
                <Tag color="default" style={{ fontSize: '12px' }}>
                  {wikiIds.length} 个已选
                </Tag>
              )}
            </div>
          </div>
        ) : (
          <div className="node-section">
            <div style={{ color: '#999', fontSize: '13px', padding: '4px 0' }}>
              未选择知识库
            </div>
          </div>
        )}
      </div>
      
      {/* 底部 - Token统计 */}
      <div className="node-footer" style={{ 
        background: totalTokens > 0 ? '#f6ffed' : '#fafafa'
      }}>
        {totalTokens > 0 ? (
          <span style={{ color: '#389e0d', fontSize: '12px', fontWeight: 500 }}>
            📊 总计 {formatTokens(totalTokens)} tokens
          </span>
        ) : (
          <span className="node-hint">请配置知识库</span>
        )}
      </div>
      
      {/* 连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#531dab' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="custom-handle"
        style={{ background: '#531dab' }}
      />
    </div>
  )
}

export default KnowledgeNode
