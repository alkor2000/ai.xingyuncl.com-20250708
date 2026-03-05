/**
 * 问题分类节点 - 智能问题分类
 * v1.0 - 基础分类功能（单输出）
 * v2.0 - 多输出端口支持，每个分类对应一个输出Handle
 * v3.0 - 视觉优化：节点更大更清晰，颜色对比度优化
 * v3.1 - 改用均匀分布算法
 * v3.2 - 关键修复：Handle位置用CSS变量+!important覆盖ReactFlow默认top:50%
 *         使用 className 而非 style.top，确保自定义位置生效
 */

import React from 'react'
import { Handle, Position } from 'reactflow'
import { 
  BranchesOutlined,
  TagOutlined,
  RobotOutlined
} from '@ant-design/icons'
import { Tag, Tooltip } from 'antd'

const ClassifierNode = ({ data, selected }) => {
  const config = data.config || {}
  const model = config.model || ''
  const categories = config.categories || []
  const backgroundKnowledge = config.background_knowledge || ''
  
  /** 提取模型显示名 */
  const getModelDisplayName = (modelName) => {
    if (!modelName) return '未选择'
    const parts = modelName.split('/')
    let name = parts[parts.length - 1]
    name = name.replace(/-\d{8}$/, '')
    return name
  }
  
  /** 生成分类对应的颜色 */
  const getCategoryColor = (index) => {
    const colors = [
      '#52c41a', '#1890ff', '#722ed1', '#eb2f96', '#fa8c16',
      '#13c2c2', '#faad14', '#f5222d', '#2f54eb', '#a0d911'
    ]
    return colors[index % colors.length]
  }
  
  /**
   * v3.2: 计算每个分类Handle的top百分比
   * 在 40%~85% 范围内均匀分布（这个范围大致对应分类列表在节点中的垂直位置）
   */
  const getHandleTopPercent = (index, total) => {
    if (total <= 0) return 50
    if (total === 1) return 62
    /* 分类列表大致在节点的40%~85%高度范围 */
    const minPercent = 42
    const maxPercent = 85
    const step = (maxPercent - minPercent) / (total - 1)
    return minPercent + step * index
  }
  
  return (
    <div className={`custom-node classifier-node enhanced ${selected ? 'selected' : ''}`}>
      {/* 头部 */}
      <div className="node-header">
        <BranchesOutlined className="node-icon" />
        <span className="node-title">{data.label || '问题分类'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* AI模型 */}
        <div className="node-section">
          <div className="section-title">
            <RobotOutlined style={{ fontSize: '15px', marginRight: '4px' }} />
            AI模型
          </div>
          <div className="model-name" style={!model ? { color: '#999', background: '#fafafa', fontStyle: 'italic' } : {}}>
            {getModelDisplayName(model)}
          </div>
        </div>
        
        {/* 分类列表 */}
        <div className="node-section">
          <div className="section-title">
            <TagOutlined style={{ fontSize: '15px', marginRight: '4px' }} />
            分类输出 ({categories.length}个)
          </div>
          <div className="classifier-category-list">
            {categories.length > 0 ? (
              categories.map((cat, index) => (
                <div 
                  key={cat.id || index}
                  className="classifier-category-item"
                  style={{ borderLeftColor: getCategoryColor(index) }}
                >
                  <div className="classifier-category-header">
                    <Tag 
                      color={getCategoryColor(index)}
                      style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}
                    >
                      {index + 1}. {cat.name}
                    </Tag>
                    <span className="classifier-category-arrow" style={{ color: getCategoryColor(index) }}>
                      →
                    </span>
                  </div>
                  {cat.description && (
                    <div className="classifier-category-desc">
                      {cat.description}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: '#999', fontSize: '14px', padding: '8px 0' }}>
                未定义分类
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 底部 */}
      <div className="node-footer" style={{ 
        background: backgroundKnowledge ? '#fff7e6' : '#fafafa'
      }}>
        {backgroundKnowledge ? (
          <Tooltip title={backgroundKnowledge}>
            <span style={{ color: '#d48806', fontSize: '13px' }}>
              📚 已配置背景知识
            </span>
          </Tooltip>
        ) : (
          <span className="node-hint">请配置分类</span>
        )}
      </div>
      
      {/* 输入连接点 - 左侧居中 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#d48806' }}
      />
      
      {/* 
        v3.2: 输出连接点 - 每个分类一个
        使用 CSS 变量 --handle-top 配合 CSS 中的 !important 覆盖 ReactFlow 默认定位
      */}
      {categories.length > 0 ? (
        categories.map((cat, index) => (
          <Handle
            key={cat.id || `cat-${index}`}
            type="source"
            position={Position.Right}
            id={`output-${cat.id || `cat-${index}`}`}
            className="custom-handle classifier-output-handle"
            style={{ 
              background: getCategoryColor(index),
              '--handle-top': `${getHandleTopPercent(index, categories.length)}%`
            }}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          className="custom-handle"
          style={{ background: '#d48806' }}
        />
      )}
    </div>
  )
}

export default ClassifierNode
