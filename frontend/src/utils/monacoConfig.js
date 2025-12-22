/**
 * Monaco Editor 配置 - 简化版
 * 
 * 重要：不要手动配置loader，让@monaco-editor/react和vite-plugin-monaco-editor
 * 协同工作，自动处理Monaco的加载
 * 
 * 本文件只提供编辑器选项配置，不干预加载过程
 */

// ============================================
// 编辑器默认配置
// ============================================
export const defaultEditorOptions = {
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: 'SF Mono, Monaco, Consolas, "Courier New", monospace',
  formatOnPaste: true,
  formatOnType: true,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  folding: true,
  bracketPairColorization: { enabled: true },
  guides: {
    indentation: true,
    bracketPairs: true
  },
  padding: { top: 16, bottom: 16 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  }
};

// ============================================
// HTML语言特定配置
// ============================================
export const htmlEditorOptions = {
  ...defaultEditorOptions,
  language: 'html',
  // HTML特定设置
  suggest: {
    insertMode: 'replace',
    snippetsPreventQuickSuggestions: false
  }
};

// ============================================
// 主题配置
// ============================================
export const themes = {
  dark: 'vs-dark',
  light: 'vs-light'
};

// ============================================
// 空操作函数（保持API兼容性）
// ============================================
export const loadMonacoEditor = async () => {
  // 不再手动加载，让@monaco-editor/react处理
  console.log('[Monaco] 使用默认加载机制');
  return Promise.resolve(null);
};

export const resetMonacoLoader = () => {
  // 空操作
  console.log('[Monaco] 重置加载器（空操作）');
};

export const getLoadStatus = () => ({
  attempts: 0,
  currentCdnIndex: 0,
  cdnSources: [],
  isLoading: false,
  isLoaded: true  // 假设已加载
});

export const getMonacoInstance = () => null;

// 导出空的loader对象（保持兼容性）
export const loader = {
  config: () => {},
  init: () => Promise.resolve(null)
};

// 空的预加载函数
export const preloadMonaco = () => {
  console.log('[Monaco] 预加载已禁用，使用@monaco-editor/react默认机制');
};
