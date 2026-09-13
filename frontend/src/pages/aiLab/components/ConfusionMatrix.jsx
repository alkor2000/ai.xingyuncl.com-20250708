/**
 * 混淆矩阵：行=实际类别，列=预测类别；颜色深浅按行内占比
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

const ConfusionMatrix = ({ confusion, labelOf }) => {
  const { t } = useTranslation()
  if (!confusion?.labels?.length) return null
  const { labels, matrix } = confusion
  return (
    <div className="ailab-cm-wrap">
      <table className="ailab-cm">
        <thead>
          <tr>
            <th className="ailab-cm-corner">{t('aiLab.metrics.actualVsPredicted')}</th>
            {labels.map((l) => <th key={l}>{labelOf(l)}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((row, i) => {
            const total = matrix[i].reduce((a, b) => a + b, 0) || 1
            return (
              <tr key={row}>
                <th>{labelOf(row)}</th>
                {labels.map((col, j) => {
                  const v = matrix[i][j]
                  const ratio = v / total
                  const diag = i === j
                  return (
                    <td
                      key={col}
                      className={diag ? 'diag' : ''}
                      style={{ background: diag ? `rgba(46,125,90,${0.15 + ratio * 0.6})` : `rgba(176,84,14,${ratio * 0.7})` }}
                    >
                      {v}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default ConfusionMatrix
