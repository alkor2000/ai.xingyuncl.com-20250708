/**
 * HTML画布面板组件
 * 
 * 功能：
 *   - 自动渲染对话中AI回复的HTML代码
 *   - 从消息内容中提取 ```html ... ``` 代码块
 *   - iframe沙箱安全渲染
 *   - 支持全屏预览和返回（醒目大按钮）
 *   - 多个HTML代码块时可切换查看
 *   - 流式输出时等待代码块闭合后再渲染
 * 
 * v1.1 修复：
 *   - 去掉关闭按钮的Tooltip，避免面板关闭时布局重排导致抖动
 *   - 全屏按钮改为醒目的primary样式，放在工具栏最左侧
 *   - 去掉"HTML预览"标题文字，节省空间
 * 
 * v1.2 修复：
 *   - iframe加载完成后自动focus，让键盘事件直接作用于HTML内容
 *   - 全屏切换后也自动focus到iframe
 *   - 切换HTML块、刷新后也自动focus
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
// 主组件
// ================================================================
const HtmlCanvasPanel = ({ messages, isStreaming, visible, onClose }) => {
  const { t } = useTranslation()
  
  // 全屏状态
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 当前查看的HTML块索引（默认最新）
  const [currentIndex, setCurrentIndex] = useState(-1)
  // 设备预览模式
  const [deviceMode, setDeviceMode] = useState('desktop')
  // iframe刷新key
  const [refreshKey, setRefreshKey] = useState(0)
  
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
  // v1.2: iframe自动聚焦
  // 让键盘事件直接作用于HTML内容（如游戏的方向键控制）
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
          // 先focus iframe元素本身
          iframe.focus()
          // 再尝试focus iframe内部的body（需要same-origin）
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
   * 通过onLoad事件触发
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
  // 操作处理
  // ================================================================

  /** 切换全屏 */
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev)
  }, [])

  /** ESC退出全屏 */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

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
    <div className={`html-canvas-panel ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 工具栏 */}
      <div className="canvas-toolbar">
        {/* 左侧：全屏按钮（醒目） + HTML块切换器 */}
        <div className="toolbar-left">
          {/* v1.1: 全屏/退出全屏 - 醒目的primary按钮 */}
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

          {/* v1.1: 关闭按钮 - 不用Tooltip，避免面板消失时抖动 */}
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
          
          {/* v1.2: 添加onLoad自动聚焦 */}
          <iframe
            key={`${currentIndex}-${refreshKey}`}
            ref={iframeRef}
            srcDoc={currentHtml}
            title="HTML Preview"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            className="preview-iframe"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>
    </div>
  )
}

export default HtmlCanvasPanel
