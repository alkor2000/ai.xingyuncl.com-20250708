/**
 * 问题分类节点 - 智能问题分类
 * v1.0 - 基础分类功能（单输出）
 * v2.0 - 多输出端口支持，每个分类对应一个输出Handle
 * 使用AI对用户问题进行智能分类
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
  
  // 提取模型显示名
  const getModelDisplayName = (modelName) => {
    if (!modelName) return '未选择'
    // 如果是 provider/model 格式，只显示 model 部分
    const parts = modelName.split('/')
    return parts[parts.length - 1]
  }
  
  // 计算输出Handle的垂直位置
  // 根据分类数量均匀分布在右侧
  const getHandleTopPosition = (index, total) => {
    if (total <= 1) return '50%'
    // 留出上下边距，从20%到80%的范围内分布
    const startPercent = 25
    const endPercent = 75
    const range = endPercent - startPercent
    const step = range / (total - 1)
    return `${startPercent + step * index}%`
  }
  
  // 生成分类对应的颜色
  const getCategoryColor = (index) => {
    const colors = [
      '#52c41a', // 绿
      '#1890ff', // 蓝
      '#722ed1', // 紫
      '#eb2f96', // 粉
      '#fa8c16', // 橙
      '#13c2c2', // 青
      '#faad14', // 黄
      '#f5222d', // 红
      '#2f54eb', // 深蓝
      '#a0d911'  // 青柠
    ]
    return colors[index % colors.length]
  }
  
  return (
    <div className={`custom-node classifier-node enhanced ${selected ? 'selected' : ''}`}
      style={{ minHeight: categories.length > 3 ? `${100 + categories.length * 20}px` : '120px' }}
    >
      {/* 头部 */}
      <div className="node-header" style={{ 
        background: 'linear-gradient(135deg, #faad14 0%, #fa8c16 100%)' 
      }}>
        <BranchesOutlined className="node-icon" />
        <span className="node-title">{data.label || '问题分类'}</span>
      </div>
      
      {/* 主体 */}
      <div className="node-body">
        {/* AI模型 */}
        <div className="node-section">
          <div className="section-title">
            <RobotOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            AI模型
          </div>
          <div className="param-list">
            <div className="param-item">
              <span className="param-value" style={{ 
                color: model ? '#1890ff' : '#999',
                fontSize: '12px'
              }}>
                {getModelDisplayName(model)}
              </span>
            </div>
          </div>
        </div>
        
        {/* 分类列表 - 显示所有分类并标注对应的输出端口 */}
        <div className="node-section">
          <div className="section-title">
            <TagOutlined style={{ fontSize: '12px', marginRight: '4px' }} />
            分类输出 ({categories.length}个)
          </div>
          <div style={{ marginTop: '6px' }}>
            {categories.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {categories.map((cat, index) => (
                  <Tooltip key={cat.id || index} title={cat.description || cat.name}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <Tag 
                        color={getCategoryColor(index)}
                        style={{ 
                          margin: 0,
                          fontSize: '11px',
                          maxWidth: '100px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {index + 1}. {cat.name}
                      </Tag>
                      <span style={{ 
                        fontSize: '10px', 
                        color: getCategoryColor(index),
                        fontWeight: 'bold'
                      }}>
                        →
                      </span>
                    </div>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <span style={{ color: '#999', fontSize: '11px' }}>未定义分类</span>
            )}
          </div>
        </div>
      </div>
      
      {/* 底部 - 背景知识提示 */}
      <div className="node-footer" style={{ 
        background: backgroundKnowledge ? '#fff7e6' : '#f5f5f5',
        borderTop: '1px solid #e8e8e8',
        padding: '6px 10px',
        borderRadius: '0 0 8px 8px'
      }}>
        {backgroundKnowledge ? (
          <span style={{ color: '#fa8c16', fontSize: '11px' }}>
            📚 已配置背景知识
          </span>
        ) : (
          <span className="node-hint">请配置分类</span>
        )}
      </div>
      
      {/* 输入连接点 - 左侧单入口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="custom-handle"
        style={{ background: '#faad14' }}
      />
      
      {/* 输出连接点 - 右侧多出口，每个分类对应一个 */}
      {categories.length > 0 ? (
        // 有分类时，生成多个输出Handle
        categories.map((cat, index) => (
          <Handle
            key={cat.id || `cat-${index}`}
            type="source"
            position={Position.Right}
            id={`output-${cat.id || `cat-${index}`}`}
            className="custom-handle classifier-handle"
            style={{ 
              background: getCategoryColor(index),
              top: getHandleTopPosition(index, categories.length),
              width: '10px',
              height: '10px'
            }}
          />
        ))
      ) : (
        // 无分类时，显示默认单输出
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          className="custom-handle"
          style={{ background: '#faad14' }}
        />
      )}
    </div>
  )
}

export default ClassifierNode
