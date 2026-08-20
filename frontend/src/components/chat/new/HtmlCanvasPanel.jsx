/**
 * HTML画布面板组件
 *
 * 功能：
 *   - 自动渲染对话中AI回复的HTML代码
 *   - 从消息内容中提取 ```html ... ``` 代码块
 *   - iframe沙箱安全渲染
 *   - 真全屏预览（浏览器原生Fullscreen API，隐藏所有浏览器UI）
 *   - 多个HTML代码块时可切换查看
 *   - 流式输出时等待代码块闭合后再渲染
 *
 * 全屏实现：
 *   - 调用 element.requestFullscreen() 进入浏览器真全屏
 *   - 监听 fullscreenchange 事件同步React state
 *   - 支持ESC/F11/开发者工具等任意方式退出
 *   - 全屏状态下右上角显示悬浮退出按钮
 *   - API不支持时降级为CSS模拟全屏（position:fixed）
 *
 * HTML提取（历史修复，保留说明以免后人重蹈）：
 *   本文件曾自行用正则 /```(?:html|HTML)\s*\n([\s\S]*?)```/g 提取代码块。
 *   该正则为非贪婪匹配且不理解 Markdown 围栏规则，遇到 HTML 内部 JS 里的
 *   反引号字符串字面量（如 jsonStr.startsWith('```json')）会提前闭合，
 *   导致 iframe 拿到残缺 HTML（script 未闭合、缺 </html>）渲染失败，
 *   工具栏"复制代码"也复制到被截断的内容。
 *   现统一使用 utils/htmlBlockParser 的严格 CommonMark 逐行扫描解析器，
 *   与 Chat 页面（判断是否弹画布、统计块数）共用同一口径。
 *
 * ============================================================
 * 国际化关键决策
 * ============================================================
 *
 * 【1】剥离全部 13 处兜底
 *   原代码形如 t('chat.canvas.desktop') || '桌面'，共 11 处 || 形式
 *   与 2 处 t(key, '中文') 第二参数形式。
 *   经核查，这 12 个键在中英两侧语言包均真实存在，兜底从未生效过，
 *   属纯防御性遗留。兜底的危害在于：一旦键真的缺失，中文环境完全正常，
 *   英文环境静默显示中文，问题被永久隐藏。故一律剥离，让缺键立即暴露。
 *
 * 【2】修正 fullscreenFailed 的三参数调用 bug  ★实际显示缺陷
 *   原代码：t('chat.canvas.fullscreenFailed', '全屏操作失败：{{error}}', { error })
 *   i18next 的签名是 t(key, options)。第二参数为字符串时被当作 defaultValue，
 *   第三个参数会被直接忽略，因此 {{error}} 永远不会被插值，
 *   界面上会原样显示字面量 "{{error}}"。
 *   现改为标准两参数 t(key, { error })，并按 error.message 是否存在
 *   分流到 fullscreenFailed（带原因）或 fullscreenFailedNoReason（无原因），
 *   冒号写在译文内，不在 JS 中拼接。
 *
 * 【3】删除 DEVICE_SIZES 的 label 死字段
 *   三个 label（桌面/平板/手机）从未被渲染 —— 设备切换 Tooltip 走
 *   t('chat.canvas.desktop|tablet|mobile')。原注释已自述"保留作数据说明"，
 *   但含中文的死字段会持续污染 CJK 残留扫描结果，造成后续排查干扰，故删除。
 *
 * 【4】handleToggleFullscreen 的 useCallback 保留 t 依赖
 *   判据不是"是不是 hook"，而是"重跑代价是否可接受"。
 *   本 callback 未出现在任何 useEffect 的依赖数组中（仅被按钮 onClick 引用），
 *   因此语言切换导致它重建不产生任何副作用，加 t 依赖是正确写法。
 *   反例见 SmartAppChatModal：那里的 loadConversation 被初始化 effect 依赖，
 *   加 t 会经依赖链传导触发重新请求，必须改用 tRef 模式。
 *
 * 【5】不翻译的内容
 *   Error('Fullscreen API not supported') 等内部错误（开发者信息，且这些
 *   Error 对象不会展示给用户，只用于 Promise.reject 的控制流）、
 *   console.error 日志、iframe 的 title="HTML Preview"（技术标识，
 *   供屏幕阅读器识别 iframe 用途，非界面可见文案）、
 *   块序号 "1 / 3"（纯数字与符号）。
 *
 * Props:
 *   - messages: 消息列表
 *   - isStreaming: 是否正在流式输出
 *   - visible: 画布是否可见（由父组件的开关控制）
 *   - onClose: 关闭画布的回调（仅隐藏当前画布，不关闭开关）
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Button, Tooltip, Typography, Space, Tag } from 'antd'
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  DesktopOutlined,
  TabletOutlined,
  MobileOutlined,
  ReloadOutlined,
  CopyOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { message as antMessage } from 'antd'
// 统一使用共享的 CommonMark 围栏解析器，替代原有易误闭合的正则
import { collectHtmlFromMessages } from '../../../utils/htmlBlockParser'
import './HtmlCanvasPanel.less'

const { Text } = Typography

// ================================================================
// 设备预览尺寸配置
// 仅保留 width；原 label 字段（桌面/平板/手机）从未渲染，已删除，
// 设备名称统一由 t('chat.canvas.desktop|tablet|mobile') 提供
// ================================================================
const DEVICE_SIZES = {
  desktop: { width: '100%' },
  tablet: { width: '768px' },
  mobile: { width: '375px' }
}

/** iframe 聚焦延时：等待 iframe 完成渲染后再 focus */
const FOCUS_DELAY_MS = 200

// ================================================================
// 浏览器原生Fullscreen API兼容性封装
// 处理不同浏览器的前缀差异（webkit/moz/ms）
// 注：本区块内的 Error 消息为开发者控制流信息，不展示给用户，故不国际化
// ================================================================

/**
 * 请求元素进入全屏
 * @param {HTMLElement} element
 * @returns {Promise<void>}
 */
const requestFullscreen = (element) => {
  if (!element) return Promise.reject(new Error('Target element does not exist'))

  if (element.requestFullscreen) {
    return element.requestFullscreen()
  } else if (element.webkitRequestFullscreen) {
    return element.webkitRequestFullscreen()
  } else if (element.mozRequestFullScreen) {
    return element.mozRequestFullScreen()
  } else if (element.msRequestFullscreen) {
    return element.msRequestFullscreen()
  }
  return Promise.reject(new Error('Fullscreen API not supported'))
}

/**
 * 退出全屏
 * @returns {Promise<void>}
 */
const exitFullscreen = () => {
  if (document.exitFullscreen) {
    return document.exitFullscreen()
  } else if (document.webkitExitFullscreen) {
    return document.webkitExitFullscreen()
  } else if (document.mozCancelFullScreen) {
    return document.mozCancelFullScreen()
  } else if (document.msExitFullscreen) {
    return document.msExitFullscreen()
  }
  return Promise.reject(new Error('Fullscreen API not supported'))
}

/**
 * 获取当前全屏元素（兼容多浏览器）
 * @returns {Element|null}
 */
const getFullscreenElement = () => {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
    || null
}

/**
 * 判断浏览器是否支持Fullscreen API
 */
const isFullscreenSupported = () => {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.fullscreenEnabled
    || document.webkitFullscreenEnabled
    || document.mozFullScreenEnabled
    || document.msFullscreenEnabled
  )
}

// ================================================================
// 主组件
// ================================================================
const HtmlCanvasPanel = ({ messages, isStreaming, visible, onClose }) => {
  const { t } = useTranslation()

  // 全屏状态（由fullscreenchange事件驱动更新，不直接由按钮控制）
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 当前查看的HTML块索引（默认最新）
  const [currentIndex, setCurrentIndex] = useState(-1)
  // 设备预览模式
  const [deviceMode, setDeviceMode] = useState('desktop')
  // iframe刷新key
  const [refreshKey, setRefreshKey] = useState(0)

  // 画布根容器ref（用于requestFullscreen的目标元素）
  const panelRef = useRef(null)
  const iframeRef = useRef(null)

  // ================================================================
  // 从消息中提取所有HTML代码块
  // ================================================================
  const htmlBlocks = useMemo(() => {
    return collectHtmlFromMessages(messages)
  }, [messages])

  // 当有新HTML块时自动切换到最新的
  useEffect(() => {
    if (htmlBlocks.length > 0) {
      setCurrentIndex(htmlBlocks.length - 1)
    }
  }, [htmlBlocks.length])

  // 当前显示的HTML内容
  const currentBlock = htmlBlocks[currentIndex] || null
  const currentHtml = currentBlock?.html || ''

  // ================================================================
  // iframe自动聚焦（让键盘事件直接作用于HTML内容）
  // ================================================================

  /**
   * 将焦点设置到iframe上
   * 使用短延时确保iframe已完成渲染
   */
  const focusIframe = useCallback(() => {
    setTimeout(() => {
      try {
        const iframe = iframeRef.current
        if (iframe) {
          iframe.focus()
          if (iframe.contentWindow) {
            iframe.contentWindow.focus()
          }
        }
      } catch (e) {
        // 跨域情况下contentWindow.focus可能失败，静默忽略
      }
    }, FOCUS_DELAY_MS)
  }, [])

  /**
   * iframe加载完成后自动聚焦
   */
  const handleIframeLoad = useCallback(() => {
    focusIframe()
  }, [focusIframe])

  /**
   * 全屏切换后自动聚焦到iframe
   */
  useEffect(() => {
    if (visible && currentHtml) {
      focusIframe()
    }
  }, [isFullscreen, visible, focusIframe, currentHtml])

  /**
   * 切换HTML块或刷新后自动聚焦
   */
  useEffect(() => {
    if (visible && currentHtml) {
      focusIframe()
    }
  }, [currentIndex, refreshKey, visible, focusIframe, currentHtml])

  // ================================================================
  // 浏览器原生全屏API：监听fullscreenchange事件
  // 用户通过ESC/F11/调用exitFullscreen等任意方式退出时都能同步状态
  // ================================================================
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenEl = getFullscreenElement()
      // 当前全屏元素是本组件的根容器时isFullscreen为true，否则为false
      setIsFullscreen(fullscreenEl === panelRef.current)
    }

    // 兼容多浏览器前缀
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // ================================================================
  // 操作处理
  // ================================================================

  /**
   * 切换全屏
   * 调用浏览器原生Fullscreen API，让浏览器UI完全隐藏
   * API不支持或调用失败时降级为CSS模拟全屏
   *
   * 依赖数组含 t 是正确的：本 callback 不被任何 useEffect 依赖，
   * 重建不产生副作用，而内部需要以当前语言弹出提示
   */
  const handleToggleFullscreen = useCallback(async () => {
    // 检测API支持
    if (!isFullscreenSupported()) {
      // 降级：直接切换React state，由CSS .fullscreen 类模拟全屏
      setIsFullscreen(prev => !prev)
      antMessage.info(t('chat.canvas.fullscreenNotSupported'))
      return
    }

    try {
      const currentFullscreenEl = getFullscreenElement()

      if (currentFullscreenEl) {
        // 已在全屏：退出
        await exitFullscreen()
        // 注意：state 由 fullscreenchange 事件回调统一更新，此处不手动 setState
      } else {
        // 不在全屏：进入
        if (panelRef.current) {
          await requestFullscreen(panelRef.current)
        }
      }
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error)
      // 浏览器抛出的原因为技术诊断信息，作为 {{error}} 插值内容；
      // 无原因时走独立的无占位符键，冒号形态由译文自行决定
      const reason = error?.message || ''
      antMessage.error(
        reason
          ? t('chat.canvas.fullscreenFailed', { error: reason })
          : t('chat.canvas.fullscreenFailedNoReason')
      )
      // 失败时降级为CSS模拟全屏
      setIsFullscreen(prev => !prev)
    }
  }, [t])

  /** 切换到上一个/下一个HTML块 */
  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }
  const handleNext = () => {
    if (currentIndex < htmlBlocks.length - 1) setCurrentIndex(currentIndex + 1)
  }

  /** 刷新iframe */
  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  /**
   * 复制HTML代码
   * currentHtml 由严格解析器提供，不会被内部反引号截断
   * 兼容非 HTTPS / 老浏览器缺失 navigator.clipboard 的降级方案
   */
  const handleCopyHtml = async () => {
    if (!currentHtml) return

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentHtml)
      } else {
        // 降级方案：临时 textarea + execCommand
        const textarea = document.createElement('textarea')
        textarea.value = currentHtml
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!ok) throw new Error('execCommand copy failed')
      }
      antMessage.success(t('chat.canvas.copySuccess'))
    } catch (error) {
      console.error('Failed to copy HTML code:', error)
      antMessage.error(t('chat.canvas.copyFailed'))
    }
  }

  // ================================================================
  // 如果不可见或没有HTML内容，不渲染
  // ================================================================
  if (!visible || htmlBlocks.length === 0) {
    return null
  }

  // ================================================================
  // 渲染
  // ================================================================
  return (
    <div
      ref={panelRef}
      className={`html-canvas-panel ${isFullscreen ? 'fullscreen' : ''}`}
    >
      {/* 工具栏 */}
      <div className="canvas-toolbar">
        {/* 左侧：全屏按钮（醒目） + HTML块切换器 */}
        <div className="toolbar-left">
          {/* 全屏/退出全屏 - 醒目的primary按钮 */}
          <Button
            type="primary"
            size="small"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={handleToggleFullscreen}
            className="fullscreen-btn"
          >
            {isFullscreen
              ? t('chat.canvas.exitFullscreen')
              : t('chat.canvas.fullscreen')
            }
          </Button>

          {/* 多个HTML块时显示切换器 */}
          {htmlBlocks.length > 1 && (
            <div className="block-switcher">
              <Button
                type="text"
                size="small"
                icon={<LeftOutlined />}
                onClick={handlePrev}
                disabled={currentIndex <= 0}
              />
              {/* 纯数字与斜杠，无需国际化 */}
              <Tag color="blue" style={{ margin: '0 4px', userSelect: 'none' }}>
                {currentIndex + 1} / {htmlBlocks.length}
              </Tag>
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                onClick={handleNext}
                disabled={currentIndex >= htmlBlocks.length - 1}
              />
            </div>
          )}
        </div>

        {/* 右侧：设备切换 + 操作按钮 */}
        <div className="toolbar-right">
          {/* 设备预览切换 */}
          <Space size={2}>
            <Tooltip title={t('chat.canvas.desktop')}>
              <Button
                type={deviceMode === 'desktop' ? 'primary' : 'text'}
                size="small"
                icon={<DesktopOutlined />}
                onClick={() => setDeviceMode('desktop')}
                ghost={deviceMode === 'desktop'}
              />
            </Tooltip>
            <Tooltip title={t('chat.canvas.tablet')}>
              <Button
                type={deviceMode === 'tablet' ? 'primary' : 'text'}
                size="small"
                icon={<TabletOutlined />}
                onClick={() => setDeviceMode('tablet')}
                ghost={deviceMode === 'tablet'}
              />
            </Tooltip>
            <Tooltip title={t('chat.canvas.mobile')}>
              <Button
                type={deviceMode === 'mobile' ? 'primary' : 'text'}
                size="small"
                icon={<MobileOutlined />}
                onClick={() => setDeviceMode('mobile')}
                ghost={deviceMode === 'mobile'}
              />
            </Tooltip>
          </Space>

          <div className="toolbar-divider" />

          {/* 刷新和复制 */}
          <Tooltip title={t('chat.canvas.refresh')}>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
          </Tooltip>
          <Tooltip title={t('chat.canvas.copyCode')}>
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyHtml} />
          </Tooltip>

          {/* 关闭按钮 */}
          <Tooltip title={t('chat.canvas.close')}>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={onClose}
              className="close-btn"
            />
          </Tooltip>
        </div>
      </div>

      {/* HTML渲染区域 */}
      <div className="canvas-content">
        <div
          className={`iframe-wrapper device-${deviceMode}`}
          style={{
            maxWidth: deviceMode !== 'desktop' ? DEVICE_SIZES[deviceMode].width : '100%',
            margin: deviceMode !== 'desktop' ? '0 auto' : undefined
          }}
        >
          {/* 流式输出中且当前查看的是最新块时显示提示 */}
          {isStreaming && currentIndex === htmlBlocks.length - 1 && (
            <div className="streaming-hint">
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {t('chat.canvas.streaming')}
              </Text>
            </div>
          )}

          {/* title 为技术标识，供屏幕阅读器识别 iframe 用途，非界面可见文案 */}
          <iframe
            key={`${currentIndex}-${refreshKey}`}
            ref={iframeRef}
            srcDoc={currentHtml}
            title="HTML Preview"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            allow="fullscreen"
            className="preview-iframe"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>

      {/* ================================================================
          全屏模式下的悬浮退出按钮
          位置：右上角，z-index极高保证在所有内容之上
          始终可见，让用户随时能退出
          ================================================================ */}
      {isFullscreen && (
        <Button
          type="primary"
          danger
          size="large"
          icon={<FullscreenExitOutlined />}
          onClick={handleToggleFullscreen}
          className="canvas-floating-exit-btn"
        >
          {t('chat.canvas.exitFullscreen')}
        </Button>
      )}
    </div>
  )
}

export default HtmlCanvasPanel
