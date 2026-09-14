/**
 * 幻灯片模板选择器：弹出一个网格，每个模板用真实的封面样张（SlideView 缩到 0.15）做缩略图，
 * 所见即所得——缩略图与预览、.pptx 导出用的是同一套主题定义和同一张背景图。
 * 有用户自备背景图的模板右上角打一个小标记。
 */

import React, { useMemo, useState } from 'react'
import { Popover, Button, Tooltip } from 'antd'
import { BgColorsOutlined, CheckOutlined, PictureOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { SLIDE_THEMES, slideThemeToCssVars } from '../../../utils/canvas/slideThemes'
import { customBackgroundThemes } from '../../../utils/canvas/slideBackgrounds'
import { SlideView, THEME_SAMPLE_SLIDE, resolveThemeBackgrounds, SLIDE_LOGICAL_WIDTH, SLIDE_LOGICAL_HEIGHT } from './SlidesPreview'
import './SlideThemePicker.less'

const THUMB_SCALE = 0.15

const ThemeCard = ({ theme, active, hasCustom, onSelect, t }) => {
  const cssVars = useMemo(() => slideThemeToCssVars(theme), [theme])
  const backgrounds = useMemo(() => resolveThemeBackgrounds(theme), [theme])
  return (
    <button
      type="button"
      className={`slide-theme-card ${active ? 'active' : ''}`}
      onClick={() => onSelect(theme.key)}
      style={cssVars}
    >
      <div className="slide-theme-thumb" style={{ width: SLIDE_LOGICAL_WIDTH * THUMB_SCALE, height: SLIDE_LOGICAL_HEIGHT * THUMB_SCALE }}>
        <div
          className="slide-frame"
          style={{ width: SLIDE_LOGICAL_WIDTH, height: SLIDE_LOGICAL_HEIGHT, transform: `scale(${THUMB_SCALE})`, transformOrigin: 'top left' }}
        >
          <SlideView slide={THEME_SAMPLE_SLIDE} deckTitle="" total={1} theme={theme} backgrounds={backgrounds} />
        </div>
        {active && <span className="slide-theme-check"><CheckOutlined /></span>}
        {hasCustom && (
          <Tooltip title={t('chat.canvas.theme.customImage')}>
            <span className="slide-theme-custom"><PictureOutlined /></span>
          </Tooltip>
        )}
      </div>
      <div className="slide-theme-name">{t(`chat.canvas.theme.${theme.key}`)}</div>
    </button>
  )
}

const SlideThemePicker = ({ value, onChange }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const customThemes = useMemo(() => new Set(customBackgroundThemes()), [])
  const current = SLIDE_THEMES[value] || SLIDE_THEMES.classic

  const content = (
    <div className="slide-theme-grid">
      {Object.values(SLIDE_THEMES).map(theme => (
        <ThemeCard
          key={theme.key}
          theme={theme}
          active={theme.key === current.key}
          hasCustom={customThemes.has(theme.key)}
          onSelect={(key) => { onChange(key); setOpen(false) }}
          t={t}
        />
      ))}
    </div>
  )

  return (
    <Popover
      content={content}
      title={t('chat.canvas.theme.label')}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      overlayClassName="slide-theme-popover"
    >
      <Button type="text" size="small" icon={<BgColorsOutlined />}>
        {t(`chat.canvas.theme.${current.key}`)}
      </Button>
    </Popover>
  )
}

export default SlideThemePicker
