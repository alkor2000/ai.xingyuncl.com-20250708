/**
 * 智能应用对话窗口组件
 * 功能：固定居中、可调整大小、可最小化的浮动对话窗口
 *
 * ============================================================
 * 国际化关键决策（含一项本文件新发现的陷阱形态）
 * ============================================================
 *
 * 【1】tRef 模式解决「依赖链传导」陷阱  ★本文件核心难点
 *   loadConversation 是 useCallback，内部需要 t() 弹出加载失败提示；
 *   而初始化 useEffect 的依赖数组里包含 loadConversation。
 *   若按常规给 useCallback 补 t 依赖，则切换语言时：
 *     t 变新引用 -> loadConversation 重建 -> useEffect 重跑
 *     -> 重新请求会话 + setLoading(true) -> 对话界面闪烁重载、滚动位置丢失
 *   问题不在 effect 自身依赖，而在它所依赖的 callback 的依赖，属依赖链传导。
 *   解法：用 tRef 持有最新 t（React 官方「最新值 ref」模式）。
 *     tRef.current = t 在渲染期同步，不触发任何重建；
 *     callback 内部用 tRef.current('key')，依赖数组保持原样不含 t。
 *   toast 是即时消费（弹出即消失），取当次渲染的 t 即为当前语言，语义正确。
 *
 * 【2】错误消息存 {key, detail} 而非已翻译文本（根因5）
 *   原代码把 `⚠️ ${error.message || '请求失败'}` 直接写进 messages 的 content，
 *   该文本一旦落入 state 就固化，用户停留在错误消息上切语言不会更新。
 *   现改为在消息对象上挂 errorKey / errorDetail 两个字段，
 *   渲染期才由 MessageItem 调 t() 组装，Emoji 保留在 JSX 不进语言包。
 *
 * 【3】三个 useEffect 依赖数组一律不含 t（根因7 正向）
 *   它们分别负责「初始化加载」「滚动到底部」「聚焦输入框」，
 *   都是渲染副作用型；加入 t 会导致重复请求、强制滚动、抢焦点。
 *
 * 【4】子组件各自 useTranslation
 *   CodeBlock 与 MessageItem 是本文件内定义的独立组件，
 *   不共享主组件作用域的 t，必须自行取用。
 *
 * 【5】不翻译的内容
 *   app.name（后台录入的应用名，业务数据）、app.icon（URL）、
 *   language 代码块语言标识（技术标识）、
 *   'U' 用户名首字母兜底（占位字符非文案）、
 *   ▋ 流式光标与 ⚠️ 警示（Emoji/视觉符号，留在 JSX）、
 *   console 日志（开发者信息，统一英文，与界面文案职责分离）
 *
 * 【6】复用既有 chat.* 键 9 处
 *   代码复制、消息复制、清空对话、发送失败等语义与主对话模块完全一致，
 *   复用可避免同义键分裂；窗口交互类（最小化/恢复/缩放/ESC关闭）
 *   为本组件独有，新建于 smartApps.chat.* 下。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Input,
  Button,
  Spin,
  Avatar,
  Typography,
  Tooltip,
  Popconfirm,
  message,
  Empty
} from 'antd';
import {
  SendOutlined,
  CopyOutlined,
  DeleteOutlined,
  CloseOutlined,
  LoadingOutlined,
  CheckOutlined,
  MinusOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import useAuthStore from '../../stores/authStore';
import apiClient from '../../utils/api';
import './SmartAppChatModal.less';

const { TextArea } = Input;

// ==================== 窗口尺寸常量 ====================
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 550;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 350;
const STORAGE_KEY_PREFIX = 'smart_app_window_size_';

/** 窗口与视口边缘的保留间距（防止拖到贴边不可操作） */
const VIEWPORT_MARGIN = 40;
/** 缩放灵敏度倍数：鼠标位移 × 该值 = 尺寸变化量 */
const RESIZE_SENSITIVITY = 2;

// ==================== 交互时序常量 ====================
/** 复制成功状态的显示时长 */
const COPIED_STATE_DURATION_MS = 2000;
/** 消息追加后延迟滚动，等待 DOM 完成布局 */
const SCROLL_DELAY_MS = 50;
/** 窗口打开后延迟聚焦，等待过渡动画结束 */
const FOCUS_DELAY_MS = 100;

// ==================== 头像与输入框 ====================
const AVATAR_SIZE = 32;
const APP_ICON_SIZE = 24;
const INPUT_MIN_ROWS = 1;
const INPUT_MAX_ROWS = 4;
/** 用户名缺失时头像显示的占位字符（非文案，不翻译） */
const USER_INITIAL_FALLBACK = 'U';
/** 代码块未标注语言时的兜底标识（技术标识，不翻译） */
const CODE_LANG_FALLBACK = 'code';
/** SyntaxHighlighter 无语言时使用的高亮方案（技术标识） */
const HIGHLIGHT_LANG_FALLBACK = 'text';

/**
 * AI头像图标
 */
const AIIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * 代码块渲染组件
 * 作为独立组件，需自行获取 t（不共享主组件作用域）
 */
const CodeBlock = ({ language, value }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_STATE_DURATION_MS);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        {/* 语言标识为技术专有名词，不翻译 */}
        <span className="code-language">{language || CODE_LANG_FALLBACK}</span>
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={handleCopy}
          className="code-copy-btn"
        >
          {copied ? t('chat.code.copied') : t('chat.code.copy')}
        </Button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || HIGHLIGHT_LANG_FALLBACK}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: '0 0 8px 8px' }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * 单条消息组件
 * 作为独立组件，需自行获取 t（不共享主组件作用域）
 */
const MessageItem = React.memo(({ msg, user }) => {
  const { t } = useTranslation();
  const isUser = msg.role === 'user';
  const [copySuccess, setCopySuccess] = useState(false);

  const getUserInitial = () => {
    if (user && user.username) {
      return user.username.charAt(0).toUpperCase();
    }
    return USER_INITIAL_FALLBACK;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopySuccess(true);
    message.success(t('chat.message.copy.success'));
    setTimeout(() => setCopySuccess(false), COPIED_STATE_DURATION_MS);
  };

  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const value = String(children).replace(/\n$/, '');

      if (!inline && value.includes('\n')) {
        return <CodeBlock language={language} value={value} />;
      }

      return <code className="inline-code" {...props}>{children}</code>;
    }
  };

  /**
   * 错误消息在渲染期才翻译。
   * 消息对象只携带 errorKey 与 errorDetail（后端原文，属技术诊断信息不翻译），
   * 这样用户停留在错误消息上切换语言时提示会即时更新。
   * ⚠️ 为视觉符号，保留在 JSX 不进语言包。
   */
  const renderErrorContent = () => {
    const detail = msg.errorDetail;
    const fallback = t(msg.errorKey || 'smartApps.chat.requestFailed');
    return `⚠️ ${detail || fallback}`;
  };

  return (
    <div className={`message-item ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <Avatar size={AVATAR_SIZE} className="message-avatar ai-avatar"><AIIcon /></Avatar>
      )}

      <div className="message-content-wrapper">
        <div className={`message-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`}>
          {isUser ? (
            <div className="message-text">{msg.content}</div>
          ) : (
            <div className="message-markdown">
              {msg.error ? (
                <div className="message-text">{renderErrorContent()}</div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {msg.content || ''}
                </ReactMarkdown>
              )}
              {/* ▋ 为流式输出光标，视觉符号不进语言包 */}
              {msg.streaming && <span className="streaming-cursor">▋</span>}
            </div>
          )}
        </div>

        {!isUser && msg.content && !msg.streaming && !msg.error && (
          <div className="message-actions">
            <Tooltip title={copySuccess ? t('chat.code.copied') : t('chat.message.copyTooltip')}>
              <Button
                type="text"
                size="small"
                icon={copySuccess ? <CheckOutlined /> : <CopyOutlined />}
                onClick={handleCopy}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>

      {isUser && (
        <Avatar size={AVATAR_SIZE} className="message-avatar user-avatar">{getUserInitial()}</Avatar>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

/**
 * 智能应用对话窗口主组件
 */
const SmartAppChatModal = ({ visible, onClose, app }) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  /**
   * 持有最新 t 的 ref。
   * 供 useCallback / 事件处理器内部使用，使这些函数无需把 t 加入依赖数组，
   * 从而不会因语言切换而重建，避免连带触发依赖它们的 useEffect（详见文件头说明1）。
   * 渲染期直接赋值，不放进 useEffect —— 赋值不产生副作用也不触发重渲染。
   */
  const tRef = useRef(t);
  tRef.current = t;

  // 窗口状态
  const [isMinimized, setIsMinimized] = useState(false);
  const [windowSize, setWindowSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT
  });

  // 对话状态
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState(null);

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const resizeRef = useRef(null);
  const isResizingRef = useRef(false);

  /**
   * 应用显示名。app.name 为后台录入的业务数据不翻译，
   * 仅在缺失时使用 defaultAppName 兜底文案。
   */
  const appDisplayName = app?.name || t('smartApps.chat.defaultAppName');

  /**
   * 获取窗口尺寸的 localStorage 键
   */
  const getStorageKey = useCallback(() => {
    return `${STORAGE_KEY_PREFIX}${app?.id || 'default'}`;
  }, [app?.id]);

  /**
   * 加载窗口大小（受限于当前视口，防止恢复出超出屏幕的尺寸）
   */
  const loadWindowSize = useCallback(() => {
    try {
      const saved = localStorage.getItem(getStorageKey());
      if (saved) {
        const savedSize = JSON.parse(saved);
        if (savedSize.width && savedSize.height) {
          setWindowSize({
            width: Math.max(
              MIN_WIDTH,
              Math.min(savedSize.width, window.innerWidth - VIEWPORT_MARGIN)
            ),
            height: Math.max(
              MIN_HEIGHT,
              Math.min(savedSize.height, window.innerHeight - VIEWPORT_MARGIN)
            )
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load window size:', e);
    }
  }, [getStorageKey]);

  /**
   * 保存窗口大小
   */
  const saveWindowSize = useCallback((size) => {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(size));
    } catch (e) {
      console.warn('Failed to save window size:', e);
    }
  }, [getStorageKey]);

  /**
   * 滚动到消息列表底部
   */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, SCROLL_DELAY_MS);
  }, []);

  /**
   * 加载会话与历史消息。
   * 依赖数组只含 app?.id：内部提示走 tRef.current，
   * 若改为依赖 t，切换语言会使本函数重建并触发下方初始化 effect 重新请求。
   */
  const loadConversation = useCallback(async () => {
    if (!app?.id) return;

    setLoading(true);
    try {
      const response = await apiClient.get(`/smart-apps/${app.id}/conversation`);
      if (response.data.success) {
        const { conversation: conv, messages: msgs } = response.data.data;
        setConversation(conv);
        // 后端返回顺序不保证，按创建时间升序排列确保对话顺序正确
        const sortedMessages = (msgs || []).sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at)
        );
        setMessages(sortedMessages);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
      message.error(tRef.current('smartApps.chat.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [app?.id]);

  // 初始化：依赖数组不含 t（渲染副作用型 effect，加 t 会重复请求会话）
  useEffect(() => {
    if (visible && app?.id) {
      loadWindowSize();
      loadConversation();
      setIsMinimized(false);
    }
  }, [visible, app?.id, loadWindowSize, loadConversation]);

  // 消息变化时滚动到底部：同上，不含 t（加 t 会在切语言时强制滚动）
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // 聚焦输入框：同上，不含 t（加 t 会在切语言时抢夺焦点）
  useEffect(() => {
    if (visible && !loading && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }, [visible, loading, isMinimized]);

  /**
   * 缩放：从右下角手柄拖动调整窗口尺寸。
   * 监听挂在 document 上，防止鼠标移出窗口后丢失 mouseup。
   */
  const handleResizeStart = (e) => {
    e.preventDefault();
    isResizingRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = windowSize.width;
    const startHeight = windowSize.height;
    // 用局部变量记录最新尺寸：setState 是异步的，
    // mouseup 时读 windowSize 拿到的是本次拖动开始前的旧值
    let latestSize = { width: startWidth, height: startHeight };

    const handleMouseMove = (moveEvent) => {
      if (!isResizingRef.current) return;

      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const newWidth = Math.max(
        MIN_WIDTH,
        Math.min(
          startWidth + deltaX * RESIZE_SENSITIVITY,
          window.innerWidth - VIEWPORT_MARGIN
        )
      );
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(
          startHeight + deltaY * RESIZE_SENSITIVITY,
          window.innerHeight - VIEWPORT_MARGIN
        )
      );

      latestSize = { width: newWidth, height: newHeight };
      setWindowSize(latestSize);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      saveWindowSize(latestSize);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  /**
   * 切换最小化
   */
  const toggleMinimize = useCallback(() => {
    setIsMinimized(prev => !prev);
  }, []);

  /**
   * 发送消息（流式）
   * 内部提示统一走 tRef.current，与 loadConversation 保持一致的策略
   */
  const handleSend = async () => {
    if (!inputValue.trim() || !conversation || sending) return;

    const content = inputValue.trim();
    setInputValue('');
    setSending(true);

    const tempUserMsgId = `temp-user-${Date.now()}`;
    const tempAiMsgId = `temp-ai-${Date.now()}`;

    const userMessage = {
      id: tempUserMsgId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
      temp: true
    };

    const aiPlaceholder = {
      id: tempAiMsgId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      streaming: true
    };

    setMessages(prev => [...prev, userMessage, aiPlaceholder]);
    setStreaming(true);
    setStreamingMessageId(tempAiMsgId);

    try {
      let realAiMessageId = tempAiMsgId;
      let realUserMessage = null;

      await apiClient.postStream(
        `/chat/conversations/${conversation.id}/messages`,
        { content, stream: true },
        {
          onInit: (data) => {
            realAiMessageId = data.ai_message_id;
            realUserMessage = data.user_message;
            setMessages(prev => prev.map(msg =>
              msg.id === tempUserMsgId ? { ...realUserMessage, temp: false } :
                msg.id === tempAiMsgId ? { ...msg, id: realAiMessageId } :
                  msg
            ));
            setStreamingMessageId(realAiMessageId);
          },
          onMessage: (data) => {
            const fullContent = data.fullContent || '';
            setMessages(prev => prev.map(msg =>
              msg.id === realAiMessageId
                ? { ...msg, content: fullContent, streaming: true }
                : msg
            ));
          },
          onComplete: (data) => {
            const finalContent = data.content || '';
            setMessages(prev => prev.map(msg =>
              msg.id === realAiMessageId
                ? {
                  ...msg,
                  id: data.messageId || realAiMessageId,
                  content: finalContent,
                  streaming: false,
                  tokens: data.tokens
                }
                : msg
            ));
            setStreaming(false);
            setStreamingMessageId(null);
            setSending(false);
          },
          onError: (error) => {
            console.error('Stream transmission error:', error);
            // 后端 message 恒为中文，不作为主文案：
            // 有原因走「带原因」句式（冒号在译文内），无原因走基础提示
            const reason = error?.message || '';
            message.error(
              reason
                ? tRef.current('smartApps.chat.sendFailedWithReason', { reason })
                : tRef.current('chat.send.failed')
            );
            // 错误内容不落已翻译文本，只存 {errorKey, errorDetail}，渲染期才 t()
            setMessages(prev => prev.map(msg =>
              msg.id === realAiMessageId
                ? {
                  ...msg,
                  content: '',
                  error: true,
                  errorKey: 'smartApps.chat.requestFailed',
                  errorDetail: reason,
                  streaming: false
                }
                : msg
            ));
            setStreaming(false);
            setStreamingMessageId(null);
            setSending(false);
          }
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      message.error(tRef.current('smartApps.chat.sendFailedRetry'));
      setMessages(prev => prev.filter(msg => !msg.temp && !msg.streaming));
      setStreaming(false);
      setStreamingMessageId(null);
      setSending(false);
    }
  };

  /**
   * 清空对话
   */
  const handleClear = async () => {
    if (!app?.id) return;

    try {
      await apiClient.post(`/smart-apps/${app.id}/conversation/clear`);
      setMessages([]);
      message.success(tRef.current('chat.clear.success'));
    } catch (error) {
      console.error('Failed to clear conversation:', error);
      message.error(tRef.current('chat.clear.failed'));
    }
  };

  /**
   * 键盘事件：Enter 发送，Shift+Enter 换行，ESC 关闭
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  /**
   * 关闭窗口：若正在流式输出则先取消请求
   */
  const handleClose = () => {
    if (streaming) {
      apiClient.cancelStream();
      setStreaming(false);
      setStreamingMessageId(null);
    }
    onClose();
  };

  // 不可见时不渲染
  if (!visible) return null;

  // 最小化状态渲染悬浮球
  if (isMinimized) {
    return (
      <div
        className="smart-app-minimized-ball"
        onClick={toggleMinimize}
        title={t('smartApps.chat.restoreTooltip', { name: appDisplayName })}
      >
        {app?.icon ? (
          <img src={app.icon} alt={appDisplayName} className="mini-icon" />
        ) : (
          <AIIcon />
        )}
      </div>
    );
  }

  return (
    // 外层 wrapper 的点击穿透由 SmartAppChatModal.less 中的
    // pointer-events: none / auto 组合实现，无需 JS 介入
    <div className="smart-app-chat-window-wrapper">
      <div
        className="smart-app-chat-window"
        style={{ width: windowSize.width, height: windowSize.height }}
      >
        {/* 标题栏 */}
        <div className="window-header">
          <div className="header-left">
            {app?.icon ? (
              <img src={app.icon} alt={appDisplayName} className="app-icon" />
            ) : (
              <Avatar size={APP_ICON_SIZE} className="app-icon-default"><AIIcon /></Avatar>
            )}
            {/* 应用名为后台录入的业务数据，不翻译 */}
            <span className="app-name">{appDisplayName}</span>
          </div>
          <div className="header-right">
            <Popconfirm
              title={t('chat.clear')}
              description={t('chat.clear.confirm')}
              onConfirm={handleClear}
              okText={t('smartApps.chat.confirmOk')}
              cancelText={t('smartApps.chat.confirmCancel')}
              disabled={messages.length === 0 || streaming}
            >
              <Tooltip title={t('chat.clear')}>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  disabled={messages.length === 0 || streaming}
                  className="header-btn"
                />
              </Tooltip>
            </Popconfirm>
            <Tooltip title={t('smartApps.chat.minimize')}>
              <Button
                type="text"
                icon={<MinusOutlined />}
                onClick={toggleMinimize}
                className="header-btn"
              />
            </Tooltip>
            {/* ESC 为键盘按键名，包含在译文内不做 JSX 拼接 */}
            <Tooltip title={t('smartApps.chat.close')}>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={handleClose}
                className="header-btn close-btn"
              />
            </Tooltip>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="messages-container">
          {loading ? (
            <div className="loading-container"><Spin size="large" /></div>
          ) : messages.length === 0 ? (
            <div className="empty-container">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="empty-text">{t('smartApps.chat.emptyHint')}</span>
                }
              />
            </div>
          ) : (
            <div className="messages-list">
              {messages.map(msg => (
                <MessageItem key={msg.id} msg={msg} user={user} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {sending && !streaming && (
            <div className="thinking-indicator">
              <Spin size="small" indicator={<LoadingOutlined spin />} />
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="input-container">
          <TextArea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('smartApps.chat.inputPlaceholder')}
            autoSize={{ minRows: INPUT_MIN_ROWS, maxRows: INPUT_MAX_ROWS }}
            disabled={sending || loading}
            className="message-input"
          />
          <Button
            type="primary"
            icon={sending ? <LoadingOutlined /> : <SendOutlined />}
            onClick={handleSend}
            disabled={!inputValue.trim() || sending || loading}
            className="send-btn"
          />
        </div>

        {/* 缩放手柄 */}
        <div
          ref={resizeRef}
          className="resize-handle"
          onMouseDown={handleResizeStart}
          title={t('smartApps.chat.resizeTooltip')}
        />
      </div>
    </div>
  );
};

export default SmartAppChatModal;
