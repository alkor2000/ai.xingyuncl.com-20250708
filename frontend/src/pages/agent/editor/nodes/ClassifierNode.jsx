/**
 * 问题分类节点 - 智能问题分类
 * v1.0 - 基础分类功能（单输出）
 * v2.0 - 多输出端口支持，每个分类对应一个输出Handle
 * v3.0 - 视觉优化：
 *   1. 节点更大更清晰
 *   2. 直接显示分类描述
 *   3. Handle位置与分类列表项精确对齐
 *   4. 颜色对比度优化
 */

import React, { useRef, useEffect, useState } from 'react'
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
  
  // 分类项的DOM引用，用于精确计算Handle位置
  const categoryRefs = useRef([])
  const nodeRef = useRef(null)
  const [handlePositions, setHandlePositions] = useState([])
  
  /**
   * 计算每个分类项对应的Handle垂直位置
   * 基于DOM实际位置而非百分比估算，确保Handle与分类项精确对齐
   */
  useEffect(() => {
    if (categories.length === 0 || !nodeRef.current) return
    
    // 延迟计算，等DOM渲染完成
    const timer = setTimeout(() => {
      const nodeRect = nodeRef.current?.getBoundingClientRect()
      if (!nodeRect) return
      
      const positions = categoryRefs.current.map((ref) => {
        if (!ref) return 50
        const itemRect = ref.getBoundingClientRect()
        // 计算分类项中心点相对于节点的百分比位置
        const itemCenter = itemRect.top + itemRect.height / 2
        const relativeTop = itemCenter - nodeRect.top
        const percent = (relativeTop / nodeRect.height) * 100
        return Math.max(10, Math.min(90, percent))
      })
      
      setHandlePositions(positions)
    }, 50)
    
    return () => clearTimeout(timer)
  }, [categories, data])
  
  // 提取模型显示名
  const getModelDisplayName = (modelName) => {
    if (!modelName) return '未选择'
    const parts = modelName.split('/')
    let name = parts[parts.length - 1]
    name = name.replace(/-\d{8}$/, '')
    return name
  }
  
  // 生成分类对应的颜色
  const getCategoryColor = (index) => {
    const colors = [
      '#52c41a', '#1890ff', '#722ed1', '#eb2f96', '#fa8c16',
      '#13c2c2', '#faad14', '#f5222d', '#2f54eb', '#a0d911'
    ]
    return colors[index % colors.length]
  }
  
  return (
    <div 
      ref={nodeRef}
      className={`custom-node classifier-node enhanced ${selected ? 'selected' : ''}`}
    >
      {/* 头部 - 深色背景白色文字，高对比度 */}
      <div className="node-header">
        <BranchesOutlined className="node-icon" />
        <span className="node-title">{data.label || '问题分类'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* AI模型 */}
        <div className="node-section">
          <div className="section-title">
            <RobotOutlined style={{ fontSize: '13px', marginRight: '4px' }} />
            AI模型
          </div>
          <div className="model-name" style={!model ? { color: '#999', background: '#fafafa', fontStyle: 'italic' } : {}}>
            {getModelDisplayName(model)}
          </div>
        </div>
        
        {/* 分类列表 - 显示名称+描述，每项对应一个输出Handle */}
        <div className="node-section">
          <div className="section-title">
            <TagOutlined style={{ fontSize: '13px', marginRight: '4px' }} />
            分类输出 ({categories.length}个)
          </div>
          <div className="classifier-category-list">
            {categories.length > 0 ? (
              categories.map((cat, index) => (
                <div 
                  key={cat.id || index}
                  ref={(el) => categoryRefs.current[index] = el}
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
              <div style={{ color: '#999', fontSize: '13px', padding: '8px 0' }}>
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
            <span style={{ color: '#d48806', fontSize: '12px' }}>
              📚 已配置背景知识
            </span>
          </Tooltip>
        ) : (
          <span className="node-hint">请配置分类</span>
        )}
      </div>
      
      {/* 输入连接点 - 左侧 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#d48806' }}
      />
      
      {/* 输出连接点 - 右侧，每个分类一个，精确对齐 */}
      {categories.length > 0 ? (
        categories.map((cat, index) => (
          <Handle
            key={cat.id || `cat-${index}`}
            type="source"
            position={Position.Right}
            id={`output-${cat.id || `cat-${index}`}`}
            className="custom-handle"
            style={{ 
              background: getCategoryColor(index),
              top: handlePositions[index] ? `${handlePositions[index]}%` : `${25 + (50 / Math.max(categories.length - 1, 1)) * index}%`
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
