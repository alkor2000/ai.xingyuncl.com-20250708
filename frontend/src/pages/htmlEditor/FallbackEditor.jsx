/**
 * HTML编辑器降级组件 - 当Monaco加载失败时使用原生textarea
 * 
 * v1.0 (2026-03-01): 初始版本
 *   - Monaco加载超时15秒自动降级
 *   - 支持暗色/亮色主题
 *   - 提供重试加载按钮
 *   - 基本代码编辑功能（Tab缩进、等宽字体）
 */

import React, { useCallback } from 'react';
import { Button } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

/**
 * @param {Object} props
 * @param {string} props.value - 编辑器内容
 * @param {function} props.onChange - 内容变化回调
 * @param {string} props.theme - 主题 'vs-dark' | 'vs-light'
 * @param {function} props.onRetry - 重试加载Monaco回调
 */
const FallbackEditor = ({ value, onChange, theme = 'vs-dark', onRetry }) => {
  const isDark = theme === 'vs-dark';

  /**
   * 处理Tab键缩进 - 原生textarea不支持Tab，需要手动拦截
   */
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      
      // 在光标位置插入两个空格
      const newVal = val.substring(0, start) + '  ' + val.substring(end);
      
      // 更新值并恢复光标位置
      onChange(newVal);
      
      // 需要在下一个tick设置光标位置
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }, [onChange]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 降级提示栏 */}
      <div style={{
        padding: '8px 16px',
        background: '#FFF3CD',
        color: '#856404',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0
      }}>
        <WarningOutlined />
        <span>编辑器加载失败，已切换为基础编辑模式。所有功能正常可用。</span>
        {onRetry && (
          <Button size="small" type="link" onClick={onRetry} style={{ padding: '0 4px', fontSize: 12 }}>
            重试加载高级编辑器
          </Button>
        )}
      </div>
      
      {/* 原生textarea编辑器 */}
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: '16px',
          fontFamily: 'SF Mono, Monaco, Consolas, "Courier New", monospace',
          fontSize: 14,
          lineHeight: 1.6,
          background: isDark ? '#1e1e1e' : '#ffffff',
          color: isDark ? '#d4d4d4' : '#333333',
          tabSize: 2,
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          overflowX: 'auto'
        }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
};

export default FallbackEditor;
