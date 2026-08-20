/**
 * 聊天输入区域组件 - 支持多图上传和Ctrl+V粘贴（移动端优化版）
 *
 * 主要能力：
 *   - 多图上传（最多 MAX_IMAGE_COUNT 张，每张 ≤ MAX_IMAGE_SIZE）
 *   - Ctrl+V / Command+V 粘贴图片
 *   - 文档上传（与图片互斥，二者只能选其一）
 *   - 输入框字体跟随系统设置（systemConfigStore 的 font_family / font_size）
 *   - 上下文 Token 数量指示（含系统提示词 + 万智魔方 + 历史消息 + 附件估算）
 *   - HTML 画布开关、思考过程开关（均仅 PC 端显示）
 *
 * ============================================================
 * 国际化关键决策
 * ============================================================
 *
 * 【1】剥离全部 10 处 || 中文兜底
 *   原代码形如 t('chat.image.upload.tooLarge') || '图片大小不能超过 5MB'。
 *   经核查这些键在中英两侧均真实存在，兜底从未生效，属纯防御性遗留。
 *   兜底的危害是让"键缺失"在中文环境完全隐形，只在英文环境静默显示中文。
 *
 * 【2】上限数值改为插值，与常量绑定  ★消除文案与代码脱钩
 *   原文案硬编码 "最多上传 5 张图片" / "不能超过 5MB"，
 *   与 MAX_IMAGE_COUNT / MAX_IMAGE_SIZE 两个常量各自独立。
 *   一旦调整常量，文案必然遗漏（改代码的人不会想到还要改语言包两侧）。
 *   现语言包改为 {{max}} / {{size}} 占位符，由组件从常量派生传入，
 *   MAX_IMAGE_SIZE_MB 由 MAX_IMAGE_SIZE 计算得出，单一数据源。
 *
 * 【3】三处 JSX 拼接改整句插值
 *   a) 上传按钮 Tooltip 的计数：原 `${t('chat.upload.image')} (2/5)`
 *      改为 chat.image.upload.countHint（中"已上传 2/5 张"，英"2 of 5 uploaded"）。
 *      英文无量词"张"，且 Tooltip 中 of 比斜杠自然，语序与中文不同。
 *   b) 上下文 Token：原 `${t('chat.context.totalTokens')} ${n} tokens`
 *      改为 chat.context.totalTokensDetail 整句。
 *      中文"上下文约 N tokens"限定语前置，英文"About N tokens in context"
 *      介词短语后置 —— 语序完全不同，拼接在英文下必然错乱。
 *      注：碎片键 chat.context.totalTokens 仍在语言包中保留（不做未申报删除），
 *      但本组件已不再引用它。
 *   c) 单文件超限提示：原 `图片 ${file.name} 大小超过 5MB`
 *      改为 chat.image.upload.fileTooLarge，含 {{name}} 与 {{size}} 两占位符。
 *
 * 【4】toLocaleString 传入当前语言
 *   contextTokens.toLocaleString() 不传参会使用浏览器默认区域，
 *   与界面语言可能不一致（如浏览器为 de-DE 时千分位用点号）。
 *   改为 toLocaleString(i18n.language)。
 *
 * 【5】粘贴监听 useEffect 保留 t 依赖  ★与"effect 不可含 t"的边界
 *   通行规约是"渲染副作用型 useEffect 绝不可含 t"，但真正的判据是
 *   "重跑代价是否可接受"，而非"是不是 effect"：
 *     - 禁止：请求数据、setState 初始化表单、创建销毁第三方实例、
 *             重置滚动或缩放态 —— 这些重跑会破坏用户状态
 *     - 允许：纯事件监听的绑定/解绑 —— 幂等、无残留、代价仅为一次
 *             removeEventListener + addEventListener
 *   本 effect 属后者：它只挂载 paste 监听。而 handlePaste 内部需要 t()
 *   弹出数量/大小超限提示，若不加 t 依赖，闭包将永久捕获首次渲染的 t，
 *   用户切到英文后粘贴超限仍会弹出中文提示。故此处 t 依赖必须保留。
 *
 * 【6】不翻译的内容
 *   uploadedDocument.original_name（用户上传的文件名，业务数据）、
 *   "KB" / "tokens" / "5/5" 计数（技术单位与纯数字）、
 *   Token 指示器的颜色阈值（技术配置）。
 *
 * 【7】移动端 Tooltip 传空字符串的写法保留
 *   isMobile ? '' : t(...) —— 移动端无 hover 概念，空串使 Tooltip 不显示。
 *   空串不是文案，无需国际化。
 */

import React, { useRef, forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import {
  Input,
  Button,
  Upload,
  Tooltip,
  Badge,
  Space,
  Typography,
  message as antMessage
} from 'antd'
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  FileTextOutlined,
  CloseOutlined,
  DownloadOutlined,
  ClearOutlined,
  DatabaseOutlined,
  CodeOutlined,
  BulbOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ModelSelector from './ModelSelector'
import useSystemConfigStore from '../../../stores/systemConfigStore'
import { formatTokenCount } from '../../../utils/tokenCalculator'

const { TextArea } = Input
const { Text } = Typography

// ==================== 上传限制 ====================
/** 单张图片最大字节数 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
/**
 * 单张图片最大 MB 数，由 MAX_IMAGE_SIZE 派生。
 * 作为 {{size}} 插值参数传入文案，确保提示语与实际校验值永远一致。
 */
const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE / 1024 / 1024
/** 最大图片数量，同时作为 {{max}} 插值参数 */
const MAX_IMAGE_COUNT = 5

/** 文档上传接受的扩展名（技术标识，不国际化） */
const DOCUMENT_ACCEPT =
  '.pdf,.doc,.docx,.txt,.csv,.html,.htm,.md,.markdown,.xls,.xlsx,.ppt,.pptx,.rtf'

// ==================== 响应式与布局 ====================
/** 移动端断点，须与 Chat.less 的媒体查询保持一致 */
const MOBILE_BREAKPOINT = 768

/** 输入框行数：移动端与 PC 端分别配置 */
const TEXTAREA_ROWS = {
  mobile: { min: 2, max: 8 },
  desktop: { min: 3, max: 16 }
}

/** 移动端强制 16px 字号，低于此值 iOS Safari 会自动缩放页面 */
const MOBILE_INPUT_FONT_SIZE = 16
/** PC 端未配置字号时的默认值 */
const DEFAULT_INPUT_FONT_SIZE = 14
/** 输入框行高 */
const INPUT_LINE_HEIGHT = '1.6'
/** 系统默认字体的标识值，等于此值时不覆盖 fontFamily，交由浏览器决定 */
const SYSTEM_FONT_KEYWORD = 'system-ui'
/** 自定义字体后追加的兜底字体栈 */
const FONT_FALLBACK_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

/** 图片缩略图尺寸 */
const THUMBNAIL_SIZE = 60
/** 文档图标尺寸 */
const DOCUMENT_ICON_SIZE = 32
/** 字节换算 KB 的基数 */
const BYTES_PER_KB = 1024

// ==================== 上下文 Token 指示器配色 ====================
/**
 * 按 Token 量级分档着色，帮助用户直观感知上下文规模。
 * 纯技术配置，与语言无关。
 */
const TOKEN_COLOR_THRESHOLDS = [
  { max: 2000, color: '#8c8c8c' },    // 深灰 - 较少
  { max: 10000, color: '#1890ff' },   // 蓝色 - 正常
  { max: 50000, color: '#faad14' }    // 橙色 - 较多
]
/** 无上下文时的颜色 */
const TOKEN_COLOR_EMPTY = '#bfbfbf'
/** 超过所有阈值时的颜色（红色 - 很多） */
const TOKEN_COLOR_MAX = '#ff4d4f'

const ChatInputArea = forwardRef(({
  inputValue,
  uploadedImages = [],
  uploadedDocument,
  uploading,
  typing,
  isStreaming,
  imageUploadEnabled,
  documentUploadEnabled,
  hasMessages,
  currentModel,
  availableModels,
  contextTokens,
  canvasEnabled,
  hasHtmlContent,
  onToggleCanvas,
  showThinking,
  onToggleThinking,
  onInputChange,
  onSend,
  onStop,
  onImageUpload,
  onDocumentUpload,
  onRemoveImage,
  onRemoveDocument,
  onKeyPress,
  onExportChat,
  onClearChat,
  onModelChange
}, ref) => {
  // i18n 实例用于 toLocaleString 取当前语言，t 用于文案
  const { t, i18n } = useTranslation()
  const inputRef = useRef(null)
  const inputWrapperRef = useRef(null)

  // 从系统配置中获取字体设置
  const { getChatFontConfig } = useSystemConfigStore()
  const fontConfig = getChatFontConfig()

  // 检测是否为移动设备
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 暴露 focus/blur 方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur()
  }))

  // 是否有已上传的文件
  const hasUploadedFile = uploadedImages.length > 0 || uploadedDocument
  // 是否已达到图片上限
  const isImageLimitReached = uploadedImages.length >= MAX_IMAGE_COUNT

  // ---- Ctrl+V 粘贴图片处理 ----
  // 依赖数组含 t 是刻意保留的（详见文件头说明5）：
  // 本 effect 只做 paste 监听的绑定/解绑，幂等且无副作用残留，
  // 重跑代价极低；而 handlePaste 内需以当前语言弹出超限提示，
  // 若不含 t 依赖，闭包会永久捕获首次渲染的 t，切语言后提示语言错误
  useEffect(() => {
    const wrapper = inputWrapperRef.current
    if (!wrapper) return

    const handlePaste = (e) => {
      // 不支持图片上传或正在输入/流式中，不处理粘贴
      if (!imageUploadEnabled || uploading || typing || isStreaming) return
      // 已上传文档时不允许再贴图（图片与文档互斥）
      if (uploadedDocument) return

      const items = e.clipboardData?.items
      if (!items) return

      // 从剪贴板提取图片文件
      const imageFiles = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }

      if (imageFiles.length === 0) return

      // 阻止默认粘贴行为（避免图片base64插入文本框）
      e.preventDefault()

      // 检查数量限制
      const remaining = MAX_IMAGE_COUNT - uploadedImages.length
      if (remaining <= 0) {
        antMessage.warning(
          t('chat.image.upload.maxReached', { max: MAX_IMAGE_COUNT })
        )
        return
      }

      // 取允许数量的图片
      const filesToUpload = imageFiles.slice(0, remaining)

      // 检查单张大小
      for (const file of filesToUpload) {
        if (file.size > MAX_IMAGE_SIZE) {
          antMessage.error(
            t('chat.image.upload.tooLarge', { size: MAX_IMAGE_SIZE_MB })
          )
          return
        }
      }

      // 调用父组件的上传方法
      if (onImageUpload) {
        onImageUpload(filesToUpload)
      }
    }

    wrapper.addEventListener('paste', handlePaste)
    return () => wrapper.removeEventListener('paste', handlePaste)
  }, [
    imageUploadEnabled,
    uploading,
    typing,
    isStreaming,
    uploadedDocument,
    uploadedImages.length,
    onImageUpload,
    t
  ])

  // ---- Upload beforeUpload 钩子：拦截文件选择，交给父组件处理 ----
  const handleBeforeUpload = (file, fileList) => {
    // 检查数量限制
    const remaining = MAX_IMAGE_COUNT - uploadedImages.length
    if (remaining <= 0) {
      antMessage.warning(
        t('chat.image.upload.maxReached', { max: MAX_IMAGE_COUNT })
      )
      return false
    }

    // 检查单张大小。此处带文件名，便于用户在多选时定位是哪张超限；
    // 文件名为业务数据不翻译，作为 {{name}} 插值内容
    if (file.size > MAX_IMAGE_SIZE) {
      antMessage.error(
        t('chat.image.upload.fileTooLarge', {
          name: file.name,
          size: MAX_IMAGE_SIZE_MB
        })
      )
      return false
    }

    // 取允许数量的文件（fileList 是本次选择的所有文件）
    const filesToUpload = fileList.slice(0, remaining)

    // 只在处理第一个文件时触发上传（Upload 会对每个文件分别调用本钩子，
    // 不做此判断会导致重复发起多次上传请求）
    if (file === fileList[0] && onImageUpload) {
      const validFiles = filesToUpload.filter(f => f.size <= MAX_IMAGE_SIZE)
      if (validFiles.length > 0) {
        onImageUpload(validFiles)
      }
    }

    // 返回false阻止antd Upload自动上传
    return false
  }

  // ---- 根据状态获取placeholder ----
  const getPlaceholder = () => {
    if (uploadedImages.length > 0) {
      return isMobile
        ? t('chat.input.placeholderWithImage.mobile')
        : t('chat.input.placeholderWithImage')
    }
    if (uploadedDocument) {
      return isMobile
        ? t('chat.input.placeholderWithDocument.mobile')
        : t('chat.input.placeholderWithDocument')
    }
    return isMobile
      ? t('chat.input.placeholder.mobile')
      : t('chat.input.placeholder')
  }

  // ---- 构建输入框样式：跟随系统字体设置 ----
  const getInputStyle = () => {
    const style = {}

    // 移动端强制 16px 防止 iOS 缩放，PC 端使用系统配置的字号
    if (isMobile) {
      style.fontSize = `${MOBILE_INPUT_FONT_SIZE}px`
    } else {
      const configFontSize = fontConfig?.fontSize || DEFAULT_INPUT_FONT_SIZE
      style.fontSize = `${configFontSize}px`
    }

    // 字体跟随系统设置。system-ui 或未配置时不设置 fontFamily，
    // 交由浏览器使用默认字体
    const configFontFamily = fontConfig?.fontFamily
    if (configFontFamily && configFontFamily !== SYSTEM_FONT_KEYWORD) {
      style.fontFamily = `${configFontFamily}, ${FONT_FALLBACK_STACK}`
    }

    style.lineHeight = INPUT_LINE_HEIGHT

    return style
  }

  // ---- 上下文 Token 指示器：按量级取色 ----
  const getTokenColor = (tokens) => {
    if (!tokens || tokens === 0) return TOKEN_COLOR_EMPTY
    const matched = TOKEN_COLOR_THRESHOLDS.find(item => tokens < item.max)
    return matched ? matched.color : TOKEN_COLOR_MAX
  }

  /**
   * 上下文 Token 的 Tooltip 详情。
   * 使用整句插值而非拼接：中文"上下文约 N tokens"限定语前置，
   * 英文"About N tokens in context"介词短语后置，语序不同。
   * 千分位格式化传入 i18n.language，避免使用浏览器默认区域设置。
   */
  const getTokenTooltip = () => {
    if (!contextTokens || contextTokens === 0) {
      return t('chat.context.noContext')
    }
    return t('chat.context.totalTokensDetail', {
      tokens: contextTokens.toLocaleString(i18n.language)
    })
  }

  /**
   * 图片上传按钮的 Tooltip。
   * 已上传若干张时显示计数（整句插值，英文用 "2 of 5 uploaded"），
   * 未上传时显示基础文案；移动端无 hover 概念故传空串隐藏。
   */
  const getImageUploadTooltip = () => {
    if (isMobile) return ''
    if (uploadedImages.length > 0) {
      return t('chat.image.upload.countHint', {
        current: uploadedImages.length,
        max: MAX_IMAGE_COUNT
      })
    }
    return t('chat.upload.image')
  }

  const textareaRows = isMobile ? TEXTAREA_ROWS.mobile : TEXTAREA_ROWS.desktop

  return (
    <div className="input-container" ref={inputWrapperRef}>
      {/* 多图预览区域 */}
      {uploadedImages.length > 0 && (
        <div className="uploaded-images-preview" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0'
        }}>
          {uploadedImages.map((img, index) => (
            <Badge
              key={img.id || index}
              count={
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => onRemoveImage && onRemoveImage(index)}
                  className="remove-image-btn"
                  style={{
                    background: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    padding: 0,
                    minWidth: 'unset'
                  }}
                />
              }
            >
              {/* alt 取用户上传的原始文件名，属业务数据不翻译 */}
              <img
                src={img.url}
                alt={img.original_name}
                style={{
                  width: `${THUMBNAIL_SIZE}px`,
                  height: `${THUMBNAIL_SIZE}px`,
                  objectFit: 'cover',
                  borderRadius: '6px',
                  border: '1px solid #e8e8e8'
                }}
              />
            </Badge>
          ))}
          {/* 已上传/上限 计数，纯数字与斜杠无需国际化 */}
          <Text type="secondary" style={{ fontSize: '12px', alignSelf: 'flex-end', marginBottom: '4px' }}>
            {uploadedImages.length}/{MAX_IMAGE_COUNT}
          </Text>
        </div>
      )}

      {/* 已上传的文档预览 */}
      {uploadedDocument && (
        <div className="uploaded-document-preview">
          <Badge
            count={
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={onRemoveDocument}
                className="remove-document-btn"
              />
            }
          >
            <div className="document-preview">
              <FileTextOutlined style={{ fontSize: DOCUMENT_ICON_SIZE, color: '#1890ff' }} />
              {/* 文件名为业务数据不翻译；KB 为技术单位不翻译 */}
              <Text type="secondary" className="document-name">
                {uploadedDocument.original_name}
              </Text>
              <Text type="secondary" className="document-size">
                {Math.round(uploadedDocument.size / BYTES_PER_KB)} KB
              </Text>
            </div>
          </Badge>
        </div>
      )}

      {/* 模型选择器和工具栏 */}
      <div className="input-header">
        <div className="left-tools">
          <ModelSelector
            currentModel={currentModel}
            availableModels={availableModels}
            onModelChange={onModelChange}
            disabled={typing || isStreaming}
            isMobile={isMobile}
          />

          {/* 图片上传按钮 - 支持多选，未达上限且无文档时显示 */}
          {imageUploadEnabled && !uploadedDocument && !isImageLimitReached && (
            <Upload
              beforeUpload={handleBeforeUpload}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={getImageUploadTooltip()}>
                <Button
                  type="text"
                  icon={<PictureOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                  className="mobile-action-btn"
                />
              </Tooltip>
            </Upload>
          )}

          {/* 文档上传按钮 - 无图片上传时才显示 */}
          {documentUploadEnabled && uploadedImages.length === 0 && !uploadedDocument && (
            <Upload
              beforeUpload={onDocumentUpload}
              showUploadList={false}
              accept={DOCUMENT_ACCEPT}
              disabled={uploading || typing || isStreaming}
            >
              <Tooltip title={isMobile ? '' : t('chat.upload.document')}>
                <Button
                  type="text"
                  icon={<FileTextOutlined />}
                  loading={uploading}
                  disabled={typing || isStreaming}
                  className="mobile-action-btn"
                />
              </Tooltip>
            </Upload>
          )}

          {/* 上下文Token数量显示 */}
          {contextTokens > 0 && (
            <Tooltip title={getTokenTooltip()}>
              <span className="context-token-indicator" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: isMobile ? '2px 6px' : '2px 8px',
                borderRadius: '10px',
                fontSize: isMobile ? '11px' : '12px',
                color: getTokenColor(contextTokens),
                background: 'rgba(0,0,0,0.04)',
                cursor: 'default',
                whiteSpace: 'nowrap',
                lineHeight: '20px',
                userSelect: 'none'
              }}>
                <DatabaseOutlined style={{ fontSize: isMobile ? '11px' : '12px' }} />
                <span>{formatTokenCount(contextTokens)}</span>
              </span>
            </Tooltip>
          )}
        </div>

        <div className="right-tools">
          <Space size={4}>
            {/* 思考过程开关按钮 - 仅PC端显示 */}
            {!isMobile && onToggleThinking && (
              <Tooltip title={
                showThinking
                  ? t('chat.thinking.hide')
                  : t('chat.thinking.show')
              }>
                <Button
                  type="text"
                  icon={<BulbOutlined />}
                  onClick={onToggleThinking}
                  className={`mobile-action-btn thinking-toggle-btn ${showThinking ? 'thinking-active' : ''}`}
                  style={{
                    color: showThinking ? '#fa8c16' : undefined,
                    background: showThinking ? 'rgba(250, 140, 22, 0.08)' : undefined,
                    borderRadius: '6px'
                  }}
                />
              </Tooltip>
            )}

            {/* HTML画布开关按钮 - 仅PC端显示 */}
            {!isMobile && onToggleCanvas && (
              <Tooltip title={
                canvasEnabled
                  ? t('chat.canvas.disable')
                  : t('chat.canvas.enable')
              }>
                <Button
                  type="text"
                  icon={<CodeOutlined />}
                  onClick={onToggleCanvas}
                  className={`mobile-action-btn canvas-toggle-btn ${canvasEnabled ? 'canvas-active' : ''}`}
                  style={{
                    color: canvasEnabled ? '#1890ff' : undefined,
                    background: canvasEnabled ? 'rgba(24, 144, 255, 0.08)' : undefined,
                    borderRadius: '6px'
                  }}
                />
              </Tooltip>
            )}
            <Tooltip title={isMobile ? '' : t('chat.export')}>
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={onExportChat}
                disabled={!hasMessages || typing || isStreaming}
                className="mobile-action-btn"
              />
            </Tooltip>
            <Tooltip title={isMobile ? '' : t('chat.clear')}>
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={onClearChat}
                disabled={!hasMessages || typing || isStreaming}
                className="mobile-action-btn"
              />
            </Tooltip>
          </Space>
        </div>
      </div>

      {/* 输入框 */}
      <div className="input-wrapper">
        <TextArea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={getPlaceholder()}
          autoSize={{ minRows: textareaRows.min, maxRows: textareaRows.max }}
          disabled={typing || isStreaming}
          className="message-input"
          style={getInputStyle()}
        />

        <div className="input-actions-right">
          {isStreaming ? (
            <Tooltip title={isMobile ? '' : t('chat.stop')}>
              <Button type="primary" danger icon={<StopOutlined />} onClick={onStop} className="mobile-send-btn" />
            </Tooltip>
          ) : (
            <Tooltip title={isMobile ? '' : t('chat.send')}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={onSend}
                disabled={(!inputValue.trim() && !hasUploadedFile) || typing}
                loading={typing}
                className="mobile-send-btn"
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
})

ChatInputArea.displayName = 'ChatInputArea'

export default ChatInputArea
