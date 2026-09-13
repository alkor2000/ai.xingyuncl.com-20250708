/**
 * 规则列表的可读展示："如果 花瓣长 ≤ 2.45 且 材质 = 纸 → 山鸢尾"，手写规则与决策树展开的规则共用
 */
import React from 'react'
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatPercent } from '../engine/metrics'

const OP_TEXT = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', '!=': '≠' }

export const describeCondition = (c, columnLabel, unit) => `${columnLabel(c.col)} ${OP_TEXT[c.op] || c.op} ${c.value}${unit(c.col) || ''}`

const RuleList = ({ rules, labelOf, columnLabel, unit = () => '', hits, defaultLabel }) => {
  const { t } = useTranslation()
  return (
    <ol className="ailab-rule-list">
      {(rules || []).map((r, i) => (
        <li key={i}>
          <span className="ailab-rule-if">{t('aiLab.rules.if')}</span>{' '}
          {(r.conditions || []).map((c, j) => (
            <span key={j}>{j > 0 && <span className="ailab-rule-and"> {t('aiLab.rules.and')} </span>}<code>{describeCondition(c, columnLabel, unit)}</code></span>
          ))}
          <span className="ailab-rule-then"> → </span><Tag color="blue">{labelOf(r.label)}</Tag>
          {typeof r.n === 'number' && <span className="ailab-muted">{t('aiLab.rules.leafStat', { n: r.n, purity: formatPercent(r.purity) })}</span>}
          {hits && hits[i] && <span className="ailab-muted">{t('aiLab.rules.hitStat', { hit: hits[i].hit, correct: hits[i].correct })}</span>}
        </li>
      ))}
      {defaultLabel && <li><span className="ailab-rule-if">{t('aiLab.rules.otherwise')}</span> <span className="ailab-rule-then"> → </span><Tag>{labelOf(defaultLabel)}</Tag>{hits && hits.default && <span className="ailab-muted">{t('aiLab.rules.hitStat', { hit: hits.default.hit, correct: hits.default.correct })}</span>}</li>}
    </ol>
  )
}

export default RuleList
