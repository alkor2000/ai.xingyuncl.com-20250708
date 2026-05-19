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
import './HtmlCanvasPanel.less'

const { Text } = Typography

/**
 * 从消息内容中提取所有完整的HTML代码块
 * 只提取已闭合的 ```html ... ``` 代码块
 *
 * @param {string} content - 消息内容文本
 * @returns {string[]} - 提取到的HTML代码数组
 */
const extractHtmlBlocks = (content) => {
  if (!content) return []

  const blocks = []
  // 匹配 ```html 或 ```HTML 开头，以 ``` 结束的代码块
  const regex = /```(?:html|HTML)\s*\n([\s\S]*?)```/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const htmlContent = match[1].trim()
    // 只保留有实际内容的HTML块（至少包含一个HTML标签）
    if (htmlContent && htmlContent.length > 10 && /<[a-zA-Z]/.test(htmlContent)) {
      blocks.push(htmlContent)
    }
  }

  return blocks
}

/**
 * 从所有消息中收集HTML代码块
 * 只从AI助手消息中提取
 *
 * @param {Array} messages - 消息列表
 * @returns {Array<{html: string, messageId: string, index: number, messageIndex: number}>}
 */
const collectHtmlFromMessages = (messages) => {
  if (!messages || messages.length === 0) return []

  const allBlocks = []

  messages.forEach((msg, msgIndex) => {
    // 只从AI助手的消息中提取HTML
    if (msg.role !== 'assistant') return

    const blocks = extractHtmlBlocks(msg.content)
    blocks.forEach((html, blockIndex) => {
      allBlocks.push({
        html,
        messageId: msg.id,
        index: allBlocks.length,          // 全局索引
        blockIndex,                       // 在该消息中的索引
        messageIndex: msgIndex,           // 消息在列表中的索引
        label: `HTML #${allBlocks.length + 1}`
      })
    })
  })

  return allBlocks
}

// ================================================================
// 设备预览尺寸配置
// ================================================================
const DEVICE_SIZES = {
  desktop: { width: '100%', label: '桌面' },
  tablet: { width: '768px', label: '平板' },
  mobile: { width: '375px', label: '手机' }
}

// ================================================================
// 浏览器原生Fullscreen API兼容性封装
// 处理不同浏览器的前缀差异（webkit/moz/ms）
// ================================================================

/**
 * 请求元素进入全屏
 * @param {HTMLElement} element
 * @returns {Promise<void>}
 */
const requestFullscreen = (element) => {
  if (!element) return Promise.reject(new Error('元素不存在'))

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
    }, 200)
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
   */
  const handleToggleFullscreen = useCallback(async () => {
    // 检测API支持
    if (!isFullscreenSupported()) {
      // 降级：直接切换React state，由CSS .fullscreen 类模拟全屏
      setIsFullscreen(prev => !prev)
      antMessage.info('当前浏览器不支持真全屏，使用CSS模拟全屏')
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
      console.error('全屏切换失败:', error)
      antMessage.error('全屏操作失败：' + (error.message || '未知错误'))
      // 失败时降级
      setIsFullscreen(prev => !prev)
    }
  }, [])

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

  /** 复制HTML代码 */
  const handleCopyHtml = async () => {
    if (!currentHtml) return
    try {
      await navigator.clipboard.writeText(currentHtml)
      antMessage.success(t('chat.canvas.copySuccess') || '代码已复制')
    } catch (error) {
      antMessage.error(t('chat.canvas.copyFailed') || '复制失败')
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
              ? (t('chat.canvas.exitFullscreen') || '退出全屏')
              : (t('chat.canvas.fullscreen') || '全屏预览')
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
            <Tooltip title={t('chat.canvas.desktop') || '桌面'}>
              <Button
                type={deviceMode === 'desktop' ? 'primary' : 'text'}
                size="small"
                icon={<DesktopOutlined />}
                onClick={() => setDeviceMode('desktop')}
                ghost={deviceMode === 'desktop'}
              />
            </Tooltip>
            <Tooltip title={t('chat.canvas.tablet') || '平板'}>
              <Button
                type={deviceMode === 'tablet' ? 'primary' : 'text'}
                size="small"
                icon={<TabletOutlined />}
                onClick={() => setDeviceMode('tablet')}
                ghost={deviceMode === 'tablet'}
              />
            </Tooltip>
            <Tooltip title={t('chat.canvas.mobile') || '手机'}>
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
          <Tooltip title={t('chat.canvas.refresh') || '刷新'}>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
          </Tooltip>
          <Tooltip title={t('chat.canvas.copyCode') || '复制代码'}>
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyHtml} />
          </Tooltip>

          {/* 关闭按钮 */}
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onClose}
            className="close-btn"
          />
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
                {t('chat.canvas.streaming') || '内容生成中，显示最近完成的代码...'}
              </Text>
            </div>
          )}

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
          {t('chat.canvas.exitFullscreen') || '退出全屏'}
        </Button>
      )}
    </div>
  )
}

export default HtmlCanvasPanel
