/**
 * 消息气泡里的产物卡片
 *
 * 助手消息里的 ```html / ```pdf / ```pptx / ```docx 代码块不再把源码摊在气泡里，
 * 而是由 MessageContent 换成这张卡片：种类图标 + 标题 + 页数/生成中 + "在画布中查看"。
 * 点击按钮通过 requestOpenCanvas 让画布打开并切到这个产物。
 * 渲染在 <p> 里（react-markdown 会把链接包在段落里），所以外层用 span。
 */

import React from 'react'
import { Button } from 'antd'
import { FilePptOutlined, FileWordOutlined, FilePdfOutlined, Html5Outlined, LoadingOutlined, ExpandAltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { requestOpenCanvas } from '../../utils/canvasEvents'
import './ArtifactCard.less'

const KIND_ICONS = {
  pptx: FilePptOutlined,
  docx: FileWordOutlined,
  pdf: FilePdfOutlined,
  html: Html5Outlined
}

const ArtifactCard = ({ card, messageId }) => {
  const { t } = useTranslation()
  const Icon = KIND_ICONS[card.kind] || Html5Outlined
  const kindLabel = t(`chat.canvas.kind.${card.kind}`)
  const meta = !card.closed
    ? t('chat.canvas.card.generating')
    : card.kind === 'pptx' && card.pages
      ? t('chat.canvas.card.pages', { count: card.pages })
      : kindLabel

  return (
    <span className={`artifact-card kind-${card.kind} ${card.closed ? '' : 'generating'}`}>
      <span className="artifact-card-icon">{card.closed ? <Icon /> : <LoadingOutlined />}</span>
      <span className="artifact-card-body">
        <span className="artifact-card-title">{card.title || kindLabel}</span>
        <span className="artifact-card-meta">{meta}</span>
      </span>
      <Button
        size="small"
        type="primary"
        ghost
        icon={<ExpandAltOutlined />}
        onClick={() => requestOpenCanvas({ messageId, ordinal: card.ordinal })}
      >
        {t('chat.canvas.card.open')}
      </Button>
    </span>
  )
}

export default ArtifactCard
