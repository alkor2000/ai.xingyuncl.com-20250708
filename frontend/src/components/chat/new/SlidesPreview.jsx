/**
 * 幻灯片预览（画布 pptx 产物）
 *
 * - 用 utils/canvas/slideDeck 把 Marp 风格 Markdown 解析成 deck，
 *   与 exportPptx 共用同一份结构、同一套主题（slideThemes）和同一张封面背景图（slideArt）
 * - 固定 960×540 的"逻辑画幅"，按容器尺寸等比缩放（transform: scale），
 *   全屏时自然铺满，不需要两套布局
 * - 上一页/下一页、页码、底部缩略图条；容器聚焦后支持 ←/→/PageUp/PageDown/空格
 * - 当前页索引由本组件持有，markdown 变化（换块或重新生成）时回到第一页
 *
 * v2.1 模板：主题带版式开关（cover/decor/content/art），SlideView 按 slideThemeClassNames
 * 输出类名交给 SlidesPreview.less 排版；封面背景优先用户自备图（slideBackgrounds），
 * 其次程序生成图（slideArt），最后纯色/渐变。SlideView 也被主题选择器的缩略图复用。
 *
 * 只负责"看"，导出与主题切换在 HtmlCanvasPanel 工具栏。
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Button, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { parseSlideDeck, SLIDE_LAYOUTS, SMART_LAYOUTS } from '../../../utils/canvas/slideDeck'
import { getSlideTheme, slideThemeToCssVars, slideThemeClassNames } from '../../../utils/canvas/slideThemes'
import { renderCoverArt } from '../../../utils/canvas/slideArt'
import { getThemeBackgrounds } from '../../../utils/canvas/slideBackgrounds'
import './SlidesPreview.less'

const { Text } = Typography

/** 逻辑画幅（16:9），与 pptx 的 10in × 5.625in 同比例 */
export const SLIDE_LOGICAL_WIDTH = 960
export const SLIDE_LOGICAL_HEIGHT = 540
/** 缩略图缩放比例 */
const THUMB_SCALE = 0.12

const hexToRgba = (hex, alpha) => {
  const n = parseInt(String(hex).slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * 主题的背景资源：用户图 > 程序生成图 > 无（由 CSS 渐变/纯色兜底）
 * @returns {{ coverImage: string|null, coverIsPhoto: boolean, contentImage: string|null }}
 */
export const resolveThemeBackgrounds = (theme) => {
  const custom = getThemeBackgrounds(theme.key)
  if (custom.cover) return { coverImage: custom.cover, coverIsPhoto: true, contentImage: custom.content }
  return { coverImage: renderCoverArt(theme.key), coverIsPhoto: false, contentImage: custom.content }
}

// ============================================================================
// 行内 runs
// ============================================================================

const InlineRuns = ({ runs }) => (
  <>
    {(runs || []).map((run, idx) => {
      let node = run.text
      if (run.code) node = <code className="slide-code-inline">{node}</code>
      if (run.bold) node = <strong>{node}</strong>
      if (run.italic) node = <em>{node}</em>
      if (run.strike) node = <s>{node}</s>
      if (run.link) {
        node = <a href={run.link} target="_blank" rel="noopener noreferrer">{node}</a>
      }
      return <React.Fragment key={idx}>{node}</React.Fragment>
    })}
  </>
)

// ============================================================================
// 单页
// ============================================================================

const ListBlock = ({ block }) => {
  const Tag = block.type === 'numbered' ? 'ol' : 'ul'
  return (
    <Tag className="slide-list">
      {block.items.map((item, idx) => (
        <li key={idx} className={`level-${item.level}`}>
          <InlineRuns runs={item.runs} />
        </li>
      ))}
    </Tag>
  )
}

const TableBlock = ({ block }) => (
  <table className="slide-table">
    <thead>
      <tr>
        {block.header.map((cell, idx) => <th key={idx}><InlineRuns runs={cell} /></th>)}
      </tr>
    </thead>
    <tbody>
      {block.rows.map((row, rIdx) => (
        <tr key={rIdx}>
          {row.map((cell, cIdx) => <td key={cIdx}><InlineRuns runs={cell} /></td>)}
        </tr>
      ))}
    </tbody>
  </table>
)

const SlideBlock = ({ block }) => {
  switch (block.type) {
    case 'heading':
      return <div className="slide-subheading"><InlineRuns runs={block.runs} /></div>
    case 'bullets':
    case 'numbered':
      return <ListBlock block={block} />
    case 'table':
      return <TableBlock block={block} />
    case 'image':
      // alt 为业务数据；图片加载失败时浏览器显示 alt 文本
      return <div className="slide-image"><img src={block.url} alt={block.alt} /></div>
    case 'quote':
      return <blockquote className="slide-quote"><InlineRuns runs={block.runs} /></blockquote>
    case 'code':
      return <pre className="slide-codeblock"><code>{block.text}</code></pre>
    default:
      return <p className="slide-paragraph"><InlineRuns runs={block.runs} /></p>
  }
}

// ============================================================================
// 智能排版（slideDeck.detectSmartLayout 的结果）
// ============================================================================

const ColumnsView = ({ smart }) => (
  <>
    {smart.intro && <p className="slide-paragraph slide-intro"><InlineRuns runs={smart.intro.runs} /></p>}
    <div className={`slide-columns cols-${smart.columns.length}`}>
      {smart.columns.map((col, idx) => (
        <div className="slide-col" key={idx}>
          <div className="slide-col-title"><InlineRuns runs={col.title} /></div>
          {col.blocks.map((block, bIdx) => <SlideBlock key={bIdx} block={block} />)}
        </div>
      ))}
    </div>
  </>
)

/** 超过 4 步折成两行（与 exportPptx.addSmartFlow 的分行规则一致），行尾不画箭头 */
const FlowView = ({ smart }) => {
  const n = smart.steps.length
  const perRow = n <= 4 ? n : Math.ceil(n / 2)
  const rows = []
  for (let i = 0; i < n; i += perRow) rows.push(smart.steps.slice(i, i + perRow).map((runs, j) => ({ runs, idx: i + j })))
  return (
    <>
      {smart.intro && <p className="slide-paragraph slide-intro"><InlineRuns runs={smart.intro.runs} /></p>}
      <div className={`slide-flow steps-${n}`}>
        {rows.map((row, rIdx) => (
          <div className="slide-flow-row" key={rIdx}>
            {row.map(({ runs, idx }, j) => (
              <React.Fragment key={idx}>
                <div className="slide-flow-step">
                  {/* 步骤序号为纯数字，无需国际化 */}
                  <div className="slide-flow-badge">{idx + 1}</div>
                  <div className="slide-flow-text"><InlineRuns runs={runs} /></div>
                </div>
                {j < row.length - 1 && <div className="slide-flow-arrow" aria-hidden="true">➜</div>}
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

const CardsView = ({ smart }) => (
  <>
    {smart.intro && <p className="slide-paragraph slide-intro"><InlineRuns runs={smart.intro.runs} /></p>}
    <div className={`slide-cards cards-${smart.cards.length}`}>
      {smart.cards.map((card, idx) => (
        <div className="slide-card" key={idx}>
          <div className="slide-card-title"><InlineRuns runs={card.title} /></div>
          <div className="slide-card-body"><InlineRuns runs={card.body} /></div>
        </div>
      ))}
    </div>
  </>
)

const ImageTextView = ({ smart }) => (
  <div className="slide-imagetext">
    <div className="slide-imagetext-text">
      {smart.blocks.map((block, idx) => <SlideBlock key={idx} block={block} />)}
    </div>
    <div className="slide-imagetext-image">
      <img src={smart.image.url} alt={smart.image.alt} />
    </div>
  </div>
)

const QuoteView = ({ smart }) => (
  <div className="slide-bigquote">
    <span className="slide-bigquote-mark" aria-hidden="true">“</span>
    <div className="slide-bigquote-text"><InlineRuns runs={smart.runs} /></div>
  </div>
)

const SMART_VIEWS = {
  [SMART_LAYOUTS.COLUMNS]: ColumnsView,
  [SMART_LAYOUTS.FLOW]: FlowView,
  [SMART_LAYOUTS.CARDS]: CardsView,
  [SMART_LAYOUTS.IMAGE_TEXT]: ImageTextView,
  [SMART_LAYOUTS.QUOTE]: QuoteView
}

const SmartBody = ({ smart }) => {
  const View = SMART_VIEWS[smart.type]
  return View ? <View smart={smart} /> : null
}

/**
 * 内容量分级：与 exportPptx 的字号自适应对应，预览端用 CSS 类粗略缩字
 */
const densityClass = (slide) => {
  if (slide.textLength > 520) return 'density-xs'
  if (slide.textLength > 360) return 'density-sm'
  if (slide.textLength > 220) return 'density-md'
  return 'density-lg'
}

/**
 * 封面背景样式：照片盖一层主题色半透明保证文字可读；程序生成图直接铺；split 只铺左色块
 */
const coverBackgroundStyle = (theme, backgrounds) => {
  const { coverImage, coverIsPhoto } = backgrounds
  if (!coverImage) return {}
  const layer = coverIsPhoto
    ? `linear-gradient(${hexToRgba(theme.coverBg, 0.58)}, ${hexToRgba(theme.coverBg, 0.58)}), url("${coverImage}")`
    : `url("${coverImage}")`
  if (theme.cover === 'split') {
    return { '--slide-split-image': layer }
  }
  return { backgroundImage: layer, backgroundSize: 'cover', backgroundPosition: 'center' }
}

const contentBackgroundStyle = (backgrounds) => {
  if (!backgrounds.contentImage) return {}
  return { backgroundImage: `url("${backgrounds.contentImage}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
}

/**
 * 单页渲染。theme 缺省取 classic；backgrounds 由父级解析一次后传入（缩略图复用）。
 */
export const SlideView = ({ slide, deckTitle, total, theme: themeProp, backgrounds: backgroundsProp }) => {
  if (!slide) return null
  const theme = themeProp || getSlideTheme()
  const backgrounds = backgroundsProp || resolveThemeBackgrounds(theme)
  const classes = slideThemeClassNames(theme)

  if (slide.layout === SLIDE_LAYOUTS.TITLE) {
    return (
      <div className={`slide slide-cover ${classes}`} style={coverBackgroundStyle(theme, backgrounds)}>
        <div className="slide-cover-inner">
          <div className="slide-cover-title"><InlineRuns runs={slide.title} /></div>
          {slide.subtitle && <div className="slide-cover-subtitle">{slide.subtitle}</div>}
        </div>
        <div className="slide-cover-bar" />
      </div>
    )
  }

  if (slide.layout === SLIDE_LAYOUTS.SECTION) {
    return (
      <div className={`slide slide-section ${classes}`}>
        <div className="slide-section-title"><InlineRuns runs={slide.title} /></div>
        <div className="slide-section-bar" />
        {slide.subtitle && <div className="slide-section-subtitle">{slide.subtitle}</div>}
      </div>
    )
  }

  return (
    <div
      className={`slide slide-content ${densityClass(slide)} ${classes} ${backgrounds.contentImage ? 'has-content-image' : ''}`}
      style={contentBackgroundStyle(backgrounds)}
    >
      <div className="slide-header">
        <div className="slide-title"><InlineRuns runs={slide.title} /></div>
        <div className="slide-title-bar" />
      </div>
      <div className={`slide-body ${slide.smart ? `smart-${slide.smart.type}` : ''}`}>
        {slide.smart
          ? <SmartBody smart={slide.smart} />
          : slide.blocks.map((block, idx) => <SlideBlock key={idx} block={block} />)}
      </div>
      <div className="slide-footer">
        <span className="slide-footer-title">{deckTitle}</span>
        {/* 页码为纯数字，无需国际化 */}
        <span className="slide-footer-number">{slide.index + 1} / {total}</span>
      </div>
    </div>
  )
}

/** 主题选择器用的封面样张：不依赖 deck，用占位标题 */
export const THEME_SAMPLE_SLIDE = Object.freeze({
  index: 0, layout: SLIDE_LAYOUTS.TITLE, title: [{ text: 'Aa 标题' }], titleText: 'Aa 标题',
  subtitle: '副标题 Subtitle', blocks: [], notes: '', textLength: 0
})

// ============================================================================
// 预览主体
// ============================================================================

const SlidesPreview = ({ markdown, themeKey }) => {
  const { t } = useTranslation()
  const deck = useMemo(() => parseSlideDeck(markdown), [markdown])
  const theme = getSlideTheme(themeKey)
  const cssVars = useMemo(() => slideThemeToCssVars(theme), [theme])
  const backgrounds = useMemo(() => resolveThemeBackgrounds(theme), [theme])

  const [current, setCurrent] = useState(0)
  const [scale, setScale] = useState(0.5)
  const stageRef = useRef(null)
  const rootRef = useRef(null)

  const total = deck.slides.length

  // 内容变化回到第一页；页数减少时收敛到最后一页
  useEffect(() => { setCurrent(0) }, [markdown])
  useEffect(() => {
    if (total > 0 && current > total - 1) setCurrent(total - 1)
  }, [total, current])

  // 按容器尺寸等比缩放逻辑画幅
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      const next = Math.min(rect.width / SLIDE_LOGICAL_WIDTH, rect.height / SLIDE_LOGICAL_HEIGHT)
      if (Number.isFinite(next) && next > 0) setScale(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const goPrev = useCallback(() => setCurrent(c => Math.max(0, c - 1)), [])
  const goNext = useCallback(() => setCurrent(c => Math.min(total - 1, c + 1)), [total])

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPrev() }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goNext() }
    else if (e.key === 'Home') { e.preventDefault(); setCurrent(0) }
    else if (e.key === 'End') { e.preventDefault(); setCurrent(Math.max(0, total - 1)) }
  }

  if (total === 0) {
    return (
      <div className="slides-preview slides-preview-empty" style={cssVars}>
        <Text type="secondary">{t('chat.canvas.slides.empty')}</Text>
      </div>
    )
  }

  const slide = deck.slides[current]

  return (
    <div
      ref={rootRef}
      className="slides-preview"
      style={cssVars}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="slides-stage" ref={stageRef} onClick={() => rootRef.current?.focus()}>
        <div
          className="slide-frame"
          style={{
            width: SLIDE_LOGICAL_WIDTH,
            height: SLIDE_LOGICAL_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale})`
          }}
        >
          {/* key 让翻页时整页重挂载：否则 React 会复用同位置的 div，全局
              `* { transition: background-color }` 会把上一页装饰条的颜色渐变到正文区，闪一下蓝色 */}
          <SlideView key={current} slide={slide} deckTitle={deck.title} total={total} theme={theme} backgrounds={backgrounds} />
        </div>
      </div>

      <div className="slides-nav">
        <Button
          type="text"
          size="small"
          icon={<LeftOutlined />}
          onClick={goPrev}
          disabled={current <= 0}
          aria-label={t('chat.canvas.slides.prev')}
        />
        {/* 页码为纯数字，无需国际化 */}
        <span className="slides-counter">{current + 1} / {total}</span>
        <Button
          type="text"
          size="small"
          icon={<RightOutlined />}
          onClick={goNext}
          disabled={current >= total - 1}
          aria-label={t('chat.canvas.slides.next')}
        />
      </div>

      <div className="slides-thumbs">
        {deck.slides.map((s, idx) => (
          <button
            type="button"
            key={idx}
            className={`slide-thumb ${idx === current ? 'active' : ''}`}
            onClick={() => setCurrent(idx)}
            style={{ width: SLIDE_LOGICAL_WIDTH * THUMB_SCALE, height: SLIDE_LOGICAL_HEIGHT * THUMB_SCALE }}
          >
            <div
              className="slide-frame"
              style={{
                width: SLIDE_LOGICAL_WIDTH,
                height: SLIDE_LOGICAL_HEIGHT,
                transform: `scale(${THUMB_SCALE})`,
                transformOrigin: 'top left'
              }}
            >
              <SlideView slide={s} deckTitle={deck.title} total={total} theme={theme} backgrounds={backgrounds} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default SlidesPreview
