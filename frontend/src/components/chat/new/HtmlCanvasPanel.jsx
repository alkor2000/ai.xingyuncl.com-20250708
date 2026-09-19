/**
 * 画布面板组件（HTML / PDF / PPT / Word）
 *
 * 功能：
 *   - 自动渲染对话中AI回复的HTML代码（v2.0 起还包括 pdf / pptx / docx 产物，见下文）
 *   - 从消息内容中提取 ```html ... ``` 代码块
 *   - iframe沙箱安全渲染
 *   - 真全屏预览（浏览器原生Fullscreen API，隐藏所有浏览器UI）
 *   - 多个HTML代码块时可切换查看
 *   - 流式输出时等待代码块闭合后再渲染
 *   - 导出当前预览的HTML源码为本地文件下载（v1.1新增）
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
 *   v1.1新增的"导出HTML"功能同样复用该解析结果（currentHtml），
 *   确保下载内容与iframe渲染内容、复制内容三者完全一致。
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
 *   块序号 "1 / 3"（纯数字与符号）、从HTML内容<title>标签提取的文件名
 *   （业务数据，用户自己生成的内容，不参与翻译）。
 *
 * 【6】v1.1新增：导出HTML为本地文件下载
 *   - 技术方案与 Chat.jsx 的 handleExportChat（导出聊天记录）保持一致：
 *     Blob + URL.createObjectURL + 隐藏 <a download> 元素触发浏览器下载，
 *     全站已有该模式的先例，无需引入新依赖。
 *   - 下载内容直接使用 currentHtml（严格 CommonMark 解析器提取的完整内容），
 *     与当前iframe预览、复制代码功能三者内容完全一致，不会出现"导出的文件
 *     和预览的不一样"的困惑。
 *   - 文件名优先从HTML内容的 <title> 标签提取（更符合用户直觉，例如AI生成
 *     的"贪吃蛇游戏"页面会下载为"贪吃蛇游戏.html"），提取失败或标签不存在
 *     时回退为带时间戳的默认名"html-preview-{timestamp}.html"。
 *   - 提取出的标题会做文件名非法字符清理（Windows/Mac文件系统均不允许的
 *     字符 \ / : * ? " < > |），并将空白字符替换为下划线，避免下载失败。
 *   - 多个HTML块场景下，文件名追加块序号（如"页面_1.html"/"页面_2.html"），
 *     避免用户切换查看不同块后连续下载时互相覆盖同名文件。
 *   - 成功/失败提示复用与 copyCode/copySuccess/copyFailed 同构的
 *     export/exportSuccess/exportFailed 三键命名，保持语言包风格一致。
 *
 * ============================================================
 * v2.0：画布产物多格式化（HTML / PDF / PPT / Word）
 * ============================================================
 *
 * 画布不再只认 ```html。utils/htmlBlockParser.collectArtifactsFromMessages 按
 * 语言标识把 AI 回复里的围栏代码块提取成带 kind 的产物，本面板按 kind 分发：
 *
 *   html  iframe 预览（原逻辑不变）+ 下载 .html + 打印/另存为 PDF
 *   pdf   内容同样是完整 HTML（模型按 A4 打印样式写），iframe 预览，主操作是打印/另存为 PDF
 *   pptx  SlidesPreview 幻灯片预览（主题可切换）+ pptxgenjs 生成 .pptx
 *   docx  DocPreview A4 纸张预览 + docx 库生成 .docx
 *
 * 设计取舍：
 *   - 浏览器没有原生 pptx/docx 渲染器，预览是同一份内容的 HTML 渲染，
 *     下载是转换后的 Office 文件；结构一致，排版细节由 PowerPoint/Word 决定。
 *   - PDF 走浏览器打印（iframe.contentWindow.print → 用户选"另存为 PDF"），
 *     不用 jsPDF：它默认没有中文字体，html2canvas 截图版又不可选中文字。
 *   - pptxgenjs / docx 体积不小，用动态 import 按需加载，不进主包。
 *   - 幻灯片主题保存在 localStorage（chat_canvas_slide_theme），预览与导出共用。
 *   - 块切换器对所有 kind 通用，标签用 t('chat.canvas.kind.*') + 种类内序号。
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
  CopyOutlined,
  DownloadOutlined,
  PrinterOutlined,
  FilePptOutlined,
  FileWordOutlined,
  FilePdfOutlined,
  Html5Outlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { message as antMessage } from 'antd'
// 统一使用共享的 CommonMark 围栏解析器，替代原有易误闭合的正则
import { collectArtifactsFromMessages, ARTIFACT_KINDS } from '../../../utils/htmlBlockParser'
import { CANVAS_OPEN_EVENT, takePendingOpenRequest } from '../../../utils/canvasEvents'
import { SLIDE_THEMES, DEFAULT_SLIDE_THEME } from '../../../utils/canvas/slideThemes'
import { buildSafeBaseName, downloadBlob } from '../../../utils/canvas/download'
import SlidesPreview from './SlidesPreview'
import SlideThemePicker from './SlideThemePicker'
import DocPreview from './DocPreview'
import DocTemplateApplyModal from '../../docTemplate/DocTemplateApplyModal'
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

/**
 * 提取 <title> 标签内容的正则
 * 只取第一个 title 标签，非贪婪匹配标签内文本
 */
const TITLE_TAG_RE = /<title[^>]*>([^<]*)<\/title>/i

/** localStorage 中幻灯片主题的键名 */
const SLIDE_THEME_KEY = 'chat_canvas_slide_theme'

/** 各产物种类在工具栏上的标签颜色与图标 */
const KIND_META = {
  [ARTIFACT_KINDS.HTML]: { color: 'blue', Icon: Html5Outlined },
  [ARTIFACT_KINDS.PDF]: { color: 'red', Icon: FilePdfOutlined },
  [ARTIFACT_KINDS.PPTX]: { color: 'orange', Icon: FilePptOutlined },
  [ARTIFACT_KINDS.DOCX]: { color: 'geekblue', Icon: FileWordOutlined }
}

/** 内容是完整 HTML 文档、走 iframe 渲染的种类 */
const isHtmlKind = (kind) => kind === ARTIFACT_KINDS.HTML || kind === ARTIFACT_KINDS.PDF

const readSavedTheme = () => {
  try {
    const saved = localStorage.getItem(SLIDE_THEME_KEY)
    return saved && SLIDE_THEMES[saved] ? saved : DEFAULT_SLIDE_THEME
  } catch {
    return DEFAULT_SLIDE_THEME
  }
}

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

/**
 * 生成 HTML 下载文件名
 *
 * 优先从HTML内容的 <title> 标签提取文件名（提取到的标题为业务数据，
 * 是用户/AI生成内容的一部分，不参与国际化翻译）；提取失败或标签为空时，
 * 回退为带时间戳的默认名。多个块时追加块序号，避免连续下载时
 * 文件名重复导致相互覆盖。
 *
 * @param {string} html - 当前HTML代码内容
 * @param {number} blockIndex - 当前块在全部块中的索引（从0开始）
 * @param {number} totalBlocks - 块总数
 * @returns {string} 安全的下载文件名（含 .html 后缀）
 */
const buildDownloadFileName = (html, blockIndex, totalBlocks) => {
  const titleMatch = TITLE_TAG_RE.exec(html || '')
  const rawTitle = titleMatch ? titleMatch[1].trim() : ''
  const suffix = totalBlocks > 1 ? `_${blockIndex + 1}` : ''
  return `${buildSafeBaseName(rawTitle, 'html-preview', suffix)}.html`
}

/**
 * 复制文本到剪贴板
 * 兼容非 HTTPS / 老浏览器缺失 navigator.clipboard 的降级方案
 */
const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  // 降级方案：临时 textarea + execCommand
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('execCommand copy failed')
}

/**
 * v2.1: PDF 产物的屏幕预览样式
 *
 * iframe 里是普通网页视图（screen 媒体），模型写的 @page { margin } 只在打印时生效，
 * 所以预览会贴边。这里往文档 <head> 末尾注入一段只对 screen 生效的样式：灰底 + A4 宽
 * 白纸 + 20mm 内边距，让预览接近打印结果；@media screen 不影响 contentWindow.print()。
 * 只用于 iframe 渲染，复制/下载仍是原始 HTML。
 */
const PDF_PREVIEW_STYLE = `<style id="__canvas_pdf_preview">@media screen {
  html { background: #e9ecf1 !important; min-height: 100%; }
  body { box-sizing: border-box !important; width: 210mm !important; max-width: calc(100% - 32px) !important;
    min-height: 297mm; margin: 16px auto !important; padding: 20mm !important; background: #fff !important;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); }
}</style>`

const injectPdfPreviewStyle = (html) => {
  if (!html) return html
  const headClose = html.search(/<\/head\s*>/i)
  if (headClose >= 0) return html.slice(0, headClose) + PDF_PREVIEW_STYLE + html.slice(headClose)
  const bodyOpen = html.search(/<body[^>]*>/i)
  if (bodyOpen >= 0) return html.slice(0, bodyOpen) + PDF_PREVIEW_STYLE + html.slice(bodyOpen)
  return PDF_PREVIEW_STYLE + html
}

// ================================================================
// 主组件
// ================================================================
/** 值变化按 delay 节流（delay=0 直通）；用于流式内容驱动的重型渲染 */
const useThrottledValue = (value, delay) => {
  const [throttled, setThrottled] = useState(value)
  const lastRef = useRef(0)
  const timerRef = useRef(null)
  useEffect(() => {
    if (!delay) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      setThrottled(value)
      lastRef.current = Date.now()
      return undefined
    }
    const elapsed = Date.now() - lastRef.current
    if (elapsed >= delay) {
      setThrottled(value)
      lastRef.current = Date.now()
      return undefined
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setThrottled(value)
      lastRef.current = Date.now()
      timerRef.current = null
    }, delay - elapsed)
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  }, [value, delay])
  return delay ? throttled : value
}

const HtmlCanvasPanel = ({ messages, isStreaming, visible, onClose }) => {
  const { t } = useTranslation()

  // 全屏状态（由fullscreenchange事件驱动更新，不直接由按钮控制）
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 当前查看的产物索引（默认最新）
  const [currentIndex, setCurrentIndex] = useState(-1)
  // 设备预览模式（仅 html / pdf）
  const [deviceMode, setDeviceMode] = useState('desktop')
  // iframe刷新key
  const [refreshKey, setRefreshKey] = useState(0)
  // v2.0: 幻灯片主题（预览与 .pptx 导出共用）
  const [slideTheme, setSlideTheme] = useState(readSavedTheme)
  // v3.0: 套用公文模板（把 docx 产物按老师上传的 Word 样板生成，见 components/docTemplate）
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // v2.0: 正在生成文件（pptx / docx 转换是异步的，期间按钮显示 loading）
  const [exporting, setExporting] = useState(false)

  // 画布根容器ref（用于requestFullscreen的目标元素）
  const panelRef = useRef(null)
  const iframeRef = useRef(null)

  // ================================================================
  // 从消息中提取所有画布产物（html / pdf / pptx / docx）
  // ================================================================
  const artifacts = useMemo(() => {
    return collectArtifactsFromMessages(messages, { includeStreaming: true })
  }, [messages])

  // 当有新产物时自动切换到最新的
  useEffect(() => {
    if (artifacts.length > 0) {
      setCurrentIndex(artifacts.length - 1)
    }
  }, [artifacts.length])

  // v2.1: 气泡里的产物卡片点了"在画布中查看"→ 切到那一块；
  // 面板刚因此被打开（之前没挂载）时事件已经错过，挂载后再消费一次暂存的请求
  const artifactsRef = useRef(artifacts)
  artifactsRef.current = artifacts
  useEffect(() => {
    const focus = (detail) => {
      if (!detail) return
      const idx = artifactsRef.current.findIndex(a => String(a.messageId) === String(detail.messageId) && a.blockIndex === detail.ordinal)
      if (idx >= 0) setCurrentIndex(idx)
    }
    const handler = (event) => focus(event.detail)
    window.addEventListener(CANVAS_OPEN_EVENT, handler)
    focus(takePendingOpenRequest())
    return () => window.removeEventListener(CANVAS_OPEN_EVENT, handler)
  }, [])

  // 当前显示的产物
  // v2.0.1: 渲染用的索引必须先钳位——首次渲染时 state 还是 -1（"切到最新"的 effect 在渲染之后才跑），
  // 产物减少（删消息/清空）时 state 也可能越界；打开历史里已有 ≥2 个产物的会话曾因此
  // 读 null.kindOrdinal 把整个对话页崩掉。越界一律回落到最新一块。
  const safeIndex = artifacts.length === 0
    ? -1
    : (currentIndex >= 0 && currentIndex < artifacts.length ? currentIndex : artifacts.length - 1)
  const currentBlock = safeIndex >= 0 ? artifacts[safeIndex] : null
  const currentKind = currentBlock?.kind || ARTIFACT_KINDS.HTML
  const currentStreaming = !!currentBlock?.streaming
  // 流式中每个 chunk 都会改 messages；预览重解析 + 缩略图重渲染按 400ms 节流，生成完立即用最终内容
  const currentCode = useThrottledValue(currentBlock?.code || '', currentStreaming ? 400 : 0)
  const currentHtml = isHtmlKind(currentKind) ? currentCode : ''
  // PDF 类产物预览时模拟纸张（见 injectPdfPreviewStyle）；复制/下载仍用 currentHtml
  const previewHtml = currentKind === ARTIFACT_KINDS.PDF ? injectPdfPreviewStyle(currentHtml) : currentHtml

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
   * 切换块或刷新后自动聚焦
   */
  useEffect(() => {
    if (visible && currentHtml) {
      focusIframe()
    }
  }, [safeIndex, refreshKey, visible, focusIframe, currentHtml])

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

  /** 切换到上一个/下一个产物 */
  const handlePrev = () => {
    if (safeIndex > 0) setCurrentIndex(safeIndex - 1)
  }
  const handleNext = () => {
    if (safeIndex < artifacts.length - 1) setCurrentIndex(safeIndex + 1)
  }

  /** 刷新iframe */
  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  /** 切换幻灯片主题并记住 */
  const handleThemeChange = (key) => {
    setSlideTheme(key)
    try { localStorage.setItem(SLIDE_THEME_KEY, key) } catch {}
  }

  /**
   * 复制源码（html/pdf 为 HTML，pptx/docx 为 Markdown）
   * currentCode 由严格解析器提供，不会被内部反引号截断
   */
  const handleCopyCode = async () => {
    if (!currentCode) return
    try {
      await copyText(currentCode)
      antMessage.success(t('chat.canvas.copySuccess'))
    } catch (error) {
      console.error('Failed to copy code:', error)
      antMessage.error(t('chat.canvas.copyFailed'))
    }
  }

  /**
   * 导出HTML为本地文件下载（v1.1新增）
   *
   * 下载内容为 currentHtml（严格解析器提取的完整内容），与当前iframe
   * 预览、复制代码功能三者内容完全一致。
   */
  const handleExportHtml = () => {
    if (!currentHtml) return

    try {
      const fileName = buildDownloadFileName(currentHtml, safeIndex, artifacts.length)
      downloadBlob(new Blob([currentHtml], { type: 'text/html;charset=utf-8' }), fileName)
      antMessage.success(t('chat.canvas.exportSuccess'))
    } catch (error) {
      console.error('Failed to export HTML file:', error)
      antMessage.error(t('chat.canvas.exportFailed'))
    }
  }

  /**
   * v2.0: 打印 / 另存为 PDF
   * 调用 iframe 自己的 print()，浏览器打印对话框里选"另存为 PDF"即得 PDF 文件。
   * sandbox 已含 allow-modals（打印属于 modal 能力），同源 srcDoc 可以从父窗口调用。
   */
  const handlePrintPdf = () => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    try {
      win.focus()
      win.print()
      antMessage.info(t('chat.canvas.exportPdfHint'))
    } catch (error) {
      console.error('Failed to open print dialog:', error)
      antMessage.error(t('chat.canvas.exportPdfFailed'))
    }
  }

  /** v2.0: 生成并下载 .pptx */
  const handleExportPptx = async () => {
    if (!currentCode || exporting) return
    setExporting(true)
    try {
      const { buildPptxBlob } = await import('../../../utils/canvas/exportPptx')
      const { blob, deck } = await buildPptxBlob(currentCode, { themeKey: slideTheme })
      const suffix = artifacts.length > 1 ? `_${safeIndex + 1}` : ''
      downloadBlob(blob, `${buildSafeBaseName(deck.title, 'slides', suffix)}.pptx`)
      antMessage.success(t('chat.canvas.exportSuccess'))
    } catch (error) {
      console.error('Failed to export pptx:', error)
      antMessage.error(t('chat.canvas.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  /** v2.0: 生成并下载 .docx */
  const handleExportDocx = async () => {
    if (!currentCode || exporting) return
    setExporting(true)
    try {
      const { buildDocxBlob } = await import('../../../utils/canvas/exportDocx')
      const { blob, title } = await buildDocxBlob(currentCode)
      const suffix = artifacts.length > 1 ? `_${safeIndex + 1}` : ''
      downloadBlob(blob, `${buildSafeBaseName(title, 'document', suffix)}.docx`)
      antMessage.success(t('chat.canvas.exportSuccess'))
    } catch (error) {
      console.error('Failed to export docx:', error)
      antMessage.error(t('chat.canvas.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  // ================================================================
  // 如果不可见或没有产物，不渲染
  // ================================================================
  if (!visible || artifacts.length === 0) {
    return null
  }

  const kindMeta = KIND_META[currentKind] || KIND_META[ARTIFACT_KINDS.HTML]
  const KindIcon = kindMeta.Icon
  const showStreamingHint = currentStreaming || (isStreaming && safeIndex === artifacts.length - 1)

  // ================================================================
  // 渲染
  // ================================================================
  return (
    <div
      ref={panelRef}
      className={`html-canvas-panel kind-${currentKind} ${isFullscreen ? 'fullscreen' : ''}`}
    >
      {/* 工具栏 */}
      <div className="canvas-toolbar">
        {/* 左侧：全屏按钮（醒目） + 产物种类 + 块切换器 */}
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

          {/* 产物种类标签：种类名 + 种类内序号（序号为纯数字） */}
          <Tag color={kindMeta.color} icon={<KindIcon />} className="kind-tag">
            {t(`chat.canvas.kind.${currentKind}`)}
            {artifacts.length > 1 && currentBlock ? ` #${currentBlock.kindOrdinal}` : ''}
          </Tag>

          {/* 多个产物时显示切换器 */}
          {artifacts.length > 1 && (
            <div className="block-switcher">
              <Button
                type="text"
                size="small"
                icon={<LeftOutlined />}
                onClick={handlePrev}
                disabled={safeIndex <= 0}
              />
              {/* 纯数字与斜杠，无需国际化 */}
              <Tag color="blue" style={{ margin: '0 4px', userSelect: 'none' }}>
                {safeIndex + 1} / {artifacts.length}
              </Tag>
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                onClick={handleNext}
                disabled={safeIndex >= artifacts.length - 1}
              />
            </div>
          )}
        </div>

        {/* 右侧：按种类不同的操作按钮 */}
        <div className="toolbar-right">
          {isHtmlKind(currentKind) && (
            <>
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

              <Tooltip title={t('chat.canvas.refresh')}>
                <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
              </Tooltip>
              <Tooltip title={t('chat.canvas.copyCode')}>
                <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyCode} />
              </Tooltip>
              <Tooltip title={t('chat.canvas.export')}>
                <Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleExportHtml} />
              </Tooltip>
              <Tooltip title={t('chat.canvas.exportPdf')}>
                <Button
                  type={currentKind === ARTIFACT_KINDS.PDF ? 'primary' : 'text'}
                  ghost={currentKind === ARTIFACT_KINDS.PDF}
                  size="small"
                  icon={<PrinterOutlined />}
                  onClick={handlePrintPdf}
                />
              </Tooltip>
            </>
          )}

          {currentKind === ARTIFACT_KINDS.PPTX && (
            <>
              <SlideThemePicker value={slideTheme} onChange={handleThemeChange} />

              <div className="toolbar-divider" />

              <Tooltip title={t('chat.canvas.copyMarkdown')}>
                <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyCode} />
              </Tooltip>
              <Tooltip title={t('chat.canvas.exportPptx')}>
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={exporting}
                  disabled={currentStreaming}
                  onClick={handleExportPptx}
                >
                  .pptx
                </Button>
              </Tooltip>
            </>
          )}

          {currentKind === ARTIFACT_KINDS.DOCX && (
            <>
              <Tooltip title={t('chat.canvas.copyMarkdown')}>
                <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyCode} />
              </Tooltip>
              <Tooltip title={t('chat.canvas.exportDocx')}>
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={exporting}
                  disabled={currentStreaming}
                  onClick={handleExportDocx}
                >
                  .docx
                </Button>
              </Tooltip>
              <Tooltip title={t('chat.docTemplate.canvasButtonTip')}>
                <Button size="small" icon={<FileWordOutlined />} disabled={currentStreaming} onClick={() => setTemplateModalOpen(true)}>
                  {t('chat.docTemplate.canvasButton')}
                </Button>
              </Tooltip>
            </>
          )}

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

      {/* 渲染区域 */}
      <div className="canvas-content">
        {/* 流式输出中且当前查看的是最新块时显示提示 */}
        {showStreamingHint && (
          <div className="streaming-hint">
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('chat.canvas.streaming')}
            </Text>
          </div>
        )}

        {isHtmlKind(currentKind) && (
          <div
            className={`iframe-wrapper device-${deviceMode}`}
            style={{
              maxWidth: deviceMode !== 'desktop' ? DEVICE_SIZES[deviceMode].width : '100%',
              margin: deviceMode !== 'desktop' ? '0 auto' : undefined
            }}
          >
            {/* title 为技术标识，供屏幕阅读器识别 iframe 用途，非界面可见文案 */}
            <iframe
              key={`${safeIndex}-${refreshKey}`}
              ref={iframeRef}
              srcDoc={previewHtml}
              title="网页预览"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
              allow="fullscreen"
              className="preview-iframe"
              onLoad={handleIframeLoad}
            />
          </div>
        )}

        {currentKind === ARTIFACT_KINDS.PPTX && (
          <SlidesPreview key={safeIndex} markdown={currentCode} themeKey={slideTheme} streaming={currentStreaming} />
        )}

        {currentKind === ARTIFACT_KINDS.DOCX && (
          <DocPreview key={safeIndex} markdown={currentCode} streaming={currentStreaming} />
        )}
      </div>

      {currentKind === ARTIFACT_KINDS.DOCX && (
        <DocTemplateApplyModal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} markdown={currentCode} />
      )}

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

/**
 * v2.0.1: 画布错误边界
 * 画布只是对话页的附属面板，它自己的渲染异常绝不能把整个对话页拖垮
 * （2026-09-14 线上事故：面板读 null.kindOrdinal 让有多个产物的会话整页白屏）。
 * 出错时显示一条简短提示和关闭按钮，对话区照常可用；切换到别的产物/会话时重置。
 */
class CanvasErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Canvas panel crashed:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // 消息列表变了（新产物/换会话）就给面板一次重试机会
    if (this.state.hasError && prevProps.messages !== this.props.messages) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return <CanvasCrashFallback onClose={this.props.onClose} />
    }
    return <HtmlCanvasPanel {...this.props} />
  }
}

const CanvasCrashFallback = ({ onClose }) => {
  const { t } = useTranslation()
  return (
    <div className="html-canvas-panel canvas-crashed">
      <div className="canvas-toolbar">
        <div className="toolbar-left">
          <Text type="danger">{t('chat.canvas.renderError')}</Text>
        </div>
        <div className="toolbar-right">
          <Tooltip title={t('chat.canvas.close')}>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} className="close-btn" />
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default CanvasErrorBoundary
