/**
 * Monaco Editor 配置 - 增强版，支持多CDN源和fallback机制
 */
import { loader } from '@monaco-editor/react';

// CDN源列表，按优先级排序
const CDN_SOURCES = [
  // 主CDN - npmmirror（淘宝镜像）
  'https://registry.npmmirror.com/monaco-editor/0.52.2/files/min/vs',
  // 备用CDN 1 - bootcdn
  'https://cdn.bootcdn.net/ajax/libs/monaco-editor/0.52.2/min/vs',
  // 备用CDN 2 - staticfile
  'https://cdn.staticfile.org/monaco-editor/0.52.2/min/vs',
  // 备用CDN 3 - unpkg（国际CDN，最后备选）
  'https://unpkg.com/monaco-editor@0.52.2/min/vs'
];

// 加载状态管理
let loadAttempts = 0;
let currentCdnIndex = 0;
let loadingPromise = null;

/**
 * 测试CDN源是否可用
 */
const testCDNSource = (url, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error(`CDN timeout: ${url}`));
    }, timeout);
    
    script.onload = () => {
      clearTimeout(timer);
      script.remove();
      resolve(true);
    };
    
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(`CDN failed: ${url}`));
    };
    
    // 测试加载loader.js文件
    script.src = `${url}/loader.js`;
    document.head.appendChild(script);
  });
};

/**
 * 尝试配置Monaco loader使用指定的CDN
 */
const tryConfigureLoader = async (cdnUrl) => {
  try {
    console.log(`[Monaco] 尝试加载CDN: ${cdnUrl}`);
    
    // 先测试CDN是否可用
    await testCDNSource(cdnUrl);
    
    // 配置loader
    loader.config({
      paths: { vs: cdnUrl }
    });
    
    // 尝试初始化Monaco
    const monaco = await loader.init();
    
    if (monaco) {
      console.log(`[Monaco] 成功从CDN加载: ${cdnUrl}`);
      return monaco;
    }
    
    throw new Error('Monaco初始化失败');
  } catch (error) {
    console.error(`[Monaco] CDN加载失败: ${cdnUrl}`, error);
    throw error;
  }
};

/**
 * 智能加载Monaco编辑器，带自动fallback
 */
export const loadMonacoEditor = async (maxRetries = 3) => {
  // 如果正在加载，返回现有的promise
  if (loadingPromise) {
    return loadingPromise;
  }
  
  loadingPromise = (async () => {
    for (let retry = 0; retry < maxRetries; retry++) {
      for (let i = currentCdnIndex; i < CDN_SOURCES.length; i++) {
        try {
          const monaco = await tryConfigureLoader(CDN_SOURCES[i]);
          currentCdnIndex = i; // 记住成功的CDN
          loadAttempts = 0;
          return monaco;
        } catch (error) {
          console.warn(`[Monaco] CDN ${i + 1}/${CDN_SOURCES.length} 失败，尝试下一个...`);
        }
      }
      
      // 所有CDN都失败了，重置索引并等待后重试
      currentCdnIndex = 0;
      loadAttempts++;
      
      if (retry < maxRetries - 1) {
        console.log(`[Monaco] 所有CDN失败，${3}秒后重试... (${retry + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    throw new Error('Monaco编辑器加载失败：所有CDN源都不可用');
  })();
  
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
};

/**
 * 重置加载状态（用于手动重试）
 */
export const resetMonacoLoader = () => {
  loadAttempts = 0;
  currentCdnIndex = 0;
  loadingPromise = null;
};

/**
 * 获取加载状态信息
 */
export const getLoadStatus = () => ({
  attempts: loadAttempts,
  currentCdnIndex,
  cdnSources: CDN_SOURCES,
  isLoading: !!loadingPromise
});

// 导出loader供组件使用
export { loader };

// 编辑器默认配置
export const defaultEditorOptions = {
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: 'SF Mono, Monaco, Consolas, monospace',
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

// 尝试预加载Monaco（可选）
export const preloadMonaco = () => {
  if (typeof window !== 'undefined' && !window.monaco) {
    loadMonacoEditor().catch(error => {
      console.warn('[Monaco] 预加载失败，将在使用时重试:', error);
    });
  }
};
