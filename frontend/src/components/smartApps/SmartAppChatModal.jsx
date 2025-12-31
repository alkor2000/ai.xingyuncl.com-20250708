/**
 * 智能应用对话窗口组件 v2.2
 * 功能：固定居中、可调整大小、可最小化的浮动对话窗口
 * 
 * v2.2 简化版：
 * - 固定居中显示，不可拖拽
 * - 只能调整大小
 * - 保留最小化功能
 * - 移除全屏功能
 * - 修复消息顺序问题
 * 
 * 版本：v2.2.0
 * 更新：2025-12-30
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
  MinusOutlined,
  ExpandOutlined
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

// 窗口默认配置
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 550;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 350;
const MINIMIZED_SIZE = 60;
const STORAGE_KEY_PREFIX = 'smart_app_window_size_';

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
 */
const CodeBlock = ({ language, value }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-language">{language || 'code'}</span>
        <Button 
          type="text" 
          size="small" 
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={handleCopy}
          className="code-copy-btn"
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
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
 */
const MessageItem = React.memo(({ msg, user }) => {
  const isUser = msg.role === 'user';
  const [copySuccess, setCopySuccess] = useState(false);
  
  const getUserInitial = () => {
    if (user && user.username) {
      return user.username.charAt(0).toUpperCase();
    }
    return 'U';
  };
  
  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopySuccess(true);
    message.success('已复制到剪贴板');
    setTimeout(() => setCopySuccess(false), 2000);
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
  
  return (
    <div className={`message-item ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <Avatar size={32} className="message-avatar ai-avatar"><AIIcon /></Avatar>
      )}
      
      <div className="message-content-wrapper">
        <div className={`message-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`}>
          {isUser ? (
            <div className="message-text">{msg.content}</div>
          ) : (
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {msg.content || ''}
              </ReactMarkdown>
              {msg.streaming && <span className="streaming-cursor">▋</span>}
            </div>
          )}
        </div>
        
        {!isUser && msg.content && !msg.streaming && (
          <div className="message-actions">
            <Tooltip title={copySuccess ? '已复制' : '复制'}>
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
        <Avatar size={32} className="message-avatar user-avatar">{getUserInitial()}</Avatar>
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
  
  // 窗口状态
  const [isMinimized, setIsMinimized] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  
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
   * 获取存储键
   */
  const getStorageKey = useCallback(() => {
    return `${STORAGE_KEY_PREFIX}${app?.id || 'default'}`;
  }, [app?.id]);
  
  /**
   * 加载窗口大小
   */
  const loadWindowSize = useCallback(() => {
    try {
      const saved = localStorage.getItem(getStorageKey());
      if (saved) {
        const savedSize = JSON.parse(saved);
        if (savedSize.width && savedSize.height) {
          setWindowSize({
            width: Math.max(MIN_WIDTH, Math.min(savedSize.width, window.innerWidth - 40)),
            height: Math.max(MIN_HEIGHT, Math.min(savedSize.height, window.innerHeight - 40))
          });
        }
      }
    } catch (e) {
      console.warn('加载窗口大小失败:', e);
    }
  }, [getStorageKey]);
  
  /**
   * 保存窗口大小
   */
  const saveWindowSize = useCallback((size) => {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(size));
    } catch (e) {
      console.warn('保存窗口大小失败:', e);
    }
  }, [getStorageKey]);
  
  /**
   * 滚动到底部
   */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);
  
  /**
   * 加载会话
   */
  const loadConversation = useCallback(async () => {
    if (!app?.id) return;
    
    setLoading(true);
    try {
      const response = await apiClient.get(`/smart-apps/${app.id}/conversation`);
      if (response.data.success) {
        const { conversation: conv, messages: msgs } = response.data.data;
        setConversation(conv);
        // 确保消息按时间顺序排序
        const sortedMessages = (msgs || []).sort((a, b) => 
          new Date(a.created_at) - new Date(b.created_at)
        );
        setMessages(sortedMessages);
      }
    } catch (error) {
      console.error('加载会话失败:', error);
      message.error('加载会话失败');
    } finally {
      setLoading(false);
    }
  }, [app?.id]);
  
  // 初始化
  useEffect(() => {
    if (visible && app?.id) {
      loadWindowSize();
      loadConversation();
      setIsMinimized(false);
    }
  }, [visible, app?.id, loadWindowSize, loadConversation]);
  
  // 消息变化时滚动
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);
  
  // 聚焦输入框
  useEffect(() => {
    if (visible && !loading && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible, loading, isMinimized]);
  
  /**
   * 处理缩放开始
   */
  const handleResizeStart = (e) => {
    e.preventDefault();
    isResizingRef.current = true;
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = windowSize.width;
    const startHeight = windowSize.height;
    
    const handleMouseMove = (moveEvent) => {
      if (!isResizingRef.current) return;
      
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const newWidth = Math.max(MIN_WIDTH, Math.min(startWidth + deltaX * 2, window.innerWidth - 40));
      const newHeight = Math.max(MIN_HEIGHT, Math.min(startHeight + deltaY * 2, window.innerHeight - 40));
      
      setWindowSize({ width: newWidth, height: newHeight });
    };
    
    const handleMouseUp = () => {
      isResizingRef.current = false;
      saveWindowSize(windowSize);
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
   * 发送消息
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
    
    // 添加新消息到末尾
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
              msg.id === realAiMessageId ? { ...msg, content: fullContent, streaming: true } : msg
            ));
          },
          onComplete: (data) => {
            const finalContent = data.content || '';
            setMessages(prev => prev.map(msg => 
              msg.id === realAiMessageId
                ? { ...msg, id: data.messageId || realAiMessageId, content: finalContent, streaming: false, tokens: data.tokens }
                : msg
            ));
            setStreaming(false);
            setStreamingMessageId(null);
            setSending(false);
          },
          onError: (error) => {
            console.error('流式传输错误:', error);
            message.error(error.message || '发送失败');
            setMessages(prev => prev.map(msg => 
              msg.id === realAiMessageId
                ? { ...msg, content: `⚠️ ${error.message || '请求失败'}`, streaming: false, error: true }
                : msg
            ));
            setStreaming(false);
            setStreamingMessageId(null);
            setSending(false);
          }
        }
      );
    } catch (error) {
      console.error('发送消息失败:', error);
      message.error('发送失败，请重试');
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
      message.success('对话已清空');
    } catch (error) {
      console.error('清空对话失败:', error);
      message.error('清空失败');
    }
  };
  
  /**
   * 键盘事件
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
   * 关闭窗口
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
        title={`恢复 ${app?.name || '智能应用'}`}
      >
        {app?.icon ? (
          <img src={app.icon} alt={app?.name} className="mini-icon" />
        ) : (
          <AIIcon />
        )}
      </div>
    );
  }
  
  return (
    <div 
      className="smart-app-chat-window-wrapper"
      onClick={(e) => e.target === e.currentTarget && null} // 允许点击外部
    >
      <div 
        className="smart-app-chat-window"
        style={{ width: windowSize.width, height: windowSize.height }}
      >
        {/* 标题栏 */}
        <div className="window-header">
          <div className="header-left">
            {app?.icon ? (
              <img src={app.icon} alt={app?.name} className="app-icon" />
            ) : (
              <Avatar size={24} className="app-icon-default"><AIIcon /></Avatar>
            )}
            <span className="app-name">{app?.name || '智能应用'}</span>
          </div>
          <div className="header-right">
            <Popconfirm
              title="清空对话"
              description="确定要清空所有对话记录吗？"
              onConfirm={handleClear}
              okText="确定"
              cancelText="取消"
              disabled={messages.length === 0 || streaming}
            >
              <Tooltip title="清空对话">
                <Button type="text" icon={<DeleteOutlined />} disabled={messages.length === 0 || streaming} className="header-btn" />
              </Tooltip>
            </Popconfirm>
            <Tooltip title="最小化">
              <Button type="text" icon={<MinusOutlined />} onClick={toggleMinimize} className="header-btn" />
            </Tooltip>
            <Tooltip title="关闭 (ESC)">
              <Button type="text" icon={<CloseOutlined />} onClick={handleClose} className="header-btn close-btn" />
            </Tooltip>
          </div>
        </div>
        
        {/* 消息区域 */}
        <div className="messages-container">
          {loading ? (
            <div className="loading-container"><Spin size="large" /></div>
          ) : messages.length === 0 ? (
            <div className="empty-container">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="empty-text">发送消息开始对话</span>} />
            </div>
          ) : (
            <div className="messages-list">
              {messages.map(msg => <MessageItem key={msg.id} msg={msg} user={user} />)}
              <div ref={messagesEndRef} />
            </div>
          )}
          
          {sending && !streaming && (
            <div className="thinking-indicator"><Spin size="small" indicator={<LoadingOutlined spin />} /></div>
          )}
        </div>
        
        {/* 输入区域 */}
        <div className="input-container">
          <TextArea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter发送，Shift+Enter换行，ESC关闭"
            autoSize={{ minRows: 1, maxRows: 4 }}
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
          title="拖动调整大小"
        />
      </div>
    </div>
  );
};

export default SmartAppChatModal;
