/**
 * 决策树的缩进展示：每个分叉一行问题，"是"走左、"否"走右，叶子给出类别与样本数
 */
import React from 'react'
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatPercent } from '../engine/metrics'

const TreeView = ({ root, labelOf, columnLabel, unit = () => '' }) => {
  const { t } = useTranslation()
  const render = (node, depth, branch) => {
    const prefix = branch === null ? null : <span className={`ailab-tree-branch ${branch}`}>{branch === 'yes' ? t('aiLab.tree.yes') : t('aiLab.tree.no')}</span>
    if (node.leaf) {
      return (
        <div className="ailab-tree-node leaf" style={{ marginLeft: depth * 22 }} key={`${depth}-${branch}`}>
          {prefix}<Tag color="blue">{labelOf(node.label)}</Tag>
          <span className="ailab-muted">{t('aiLab.rules.leafStat', { n: node.n, purity: formatPercent(node.n ? (node.counts?.[node.label] || 0) / node.n : 0) })}</span>
        </div>
      )
    }
    const question = node.type === 'number'
      ? `${columnLabel(node.col)} ≤ ${node.threshold}${unit(node.col) || ''}?`
      : `${columnLabel(node.col)} = ${node.value}?`
    return (
      <React.Fragment key={`${depth}-${branch}-${node.col}`}>
        <div className="ailab-tree-node" style={{ marginLeft: depth * 22 }}>{prefix}<code>{question}</code><span className="ailab-muted">{t('aiLab.tree.nodeStat', { n: node.n })}</span></div>
        {render(node.left, depth + 1, 'yes')}
        {render(node.right, depth + 1, 'no')}
      </React.Fragment>
    )
  }
  if (!root) return null
  return <div className="ailab-tree">{render(root, 0, null)}</div>
}

export default TreeView
