/**
 * Monaco Editor 本地配置
 * 避免从CDN加载，使用本地资源
 */

import * as monaco from 'monaco-editor';
import loader from '@monaco-editor/loader';

// 配置loader使用本地monaco-editor
loader.config({ 
  monaco,
  // 禁用CDN
  paths: {
    vs: null
  }
});

// 导出配置好的loader
export { loader, monaco };

// 默认编辑器选项
export const defaultEditorOptions = {
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: 'Consolas, Monaco, monospace',
  formatOnPaste: true,
  formatOnType: true,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  // 添加更多有用的选项
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  folding: true,
  bracketPairColorization: {
    enabled: true
  },
  guides: {
    indentation: true,
    bracketPairs: true
  }
};

// HTML语言配置
export const htmlLanguageConfig = {
  tabSize: 2,
  insertSpaces: true,
  formatOnSave: true,
  formatOnPaste: true
};
