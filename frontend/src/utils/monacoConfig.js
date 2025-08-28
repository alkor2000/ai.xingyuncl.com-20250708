/**
 * Monaco Editor CDN配置 - 使用国内镜像
 */
import { loader } from '@monaco-editor/react';

// 配置使用国内CDN镜像
// npmmirror.com 是淘宝维护的npm镜像，在中国访问速度快
loader.config({
  paths: {
    // 使用 npmmirror CDN
    vs: 'https://registry.npmmirror.com/monaco-editor/0.52.2/files/min/vs'
    
    // 备选方案：
    // 1. bootcdn: 'https://cdn.bootcdn.net/ajax/libs/monaco-editor/0.52.2/min/vs'
    // 2. staticfile: 'https://cdn.staticfile.org/monaco-editor/0.52.2/min/vs'
    // 3. 七牛云: 'https://cdn.staticfile.net/monaco-editor/0.52.2/min/vs'
  }
});

// 导出配置好的loader
export { loader };

// 编辑器默认配置
export const defaultEditorOptions = {
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: 'Consolas, Monaco, monospace',
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on'
};
