/**
 * 问题分类节点 - 智能问题分类
 * v3.3 - Handle位置对齐修复
 * v3.4 - 模型显示名称优化：优先使用config.model_display_name
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
  
  /**
   * v3.4: 提取模型显示名
   * 优先使用ConfigPanel保存的model_display_name，回退到智能提取
   */
  const getModelDisplayName = (modelName) => {
    /* 优先使用配置中保存的显示名称 */
    if (config.model_display_name) {
      return config.model_display_name
    }
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
   * v3.3: 精确计算每个分类Handle的top百分比
   */
  const getHandleTopPercent = (index, total) => {
    if (total <= 0) return 50
    
    /* 固定区域高度（header + AI模型 + 分类标题） */
    const fixedTopHeight = 54 + 70 + 35
    /* 每个分类项的高度 */
    const itemHeight = 46
    /* 分类项间距 */
    const itemGap = 8
    /* footer高度 */
    const footerHeight = 42
    /* body上下padding */
    const bodyPadding = 16
    
    /* 分类列表区域总高度 */
    const listHeight = total * itemHeight + (total - 1) * itemGap
    /* 节点总高度 */
    const totalHeight = fixedTopHeight + bodyPadding + listHeight + bodyPadding + footerHeight
    
    /* 当前分类项的中心Y坐标 */
    const itemTop = fixedTopHeight + bodyPadding + index * (itemHeight + itemGap)
    const itemCenterY = itemTop + itemHeight / 2
    
    /* 转换为百分比 */
    return (itemCenterY / totalHeight) * 100
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
      
      {/* 输出连接点 - 精确对齐每个分类项中心 */}
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
