import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
  plugins: [
    react(),
    // Monaco Editor 插件 - 完整配置，支持HTML/CSS/JS
    monacoEditorPlugin.default({
      // 启用HTML相关的语言Worker
      languageWorkers: ['html', 'css', 'json', 'typescript', 'editorWorkerService'],
      // 全局变量配置
      globalAPI: false,
      // 自定义Worker配置
      customWorkers: [
        {
          label: 'editorWorkerService',
          entry: 'monaco-editor/esm/vs/editor/editor.worker'
        },
        {
          label: 'html',
          entry: 'monaco-editor/esm/vs/language/html/html.worker'
        },
        {
          label: 'css',
          entry: 'monaco-editor/esm/vs/language/css/css.worker'
        },
        {
          label: 'json',
          entry: 'monaco-editor/esm/vs/language/json/json.worker'
        },
        {
          label: 'typescript',
          entry: 'monaco-editor/esm/vs/language/typescript/ts.worker'
        }
      ]
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      'ai.xingyuncl.com',
      'localhost',
      '127.0.0.1',
      '47.236.40.252'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          'utils-vendor': ['axios', 'zustand'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          // Monaco单独打包
          'monaco-vendor': ['monaco-editor'],
          'monaco-react': ['@monaco-editor/react'],
          'prism-vendor': ['prismjs'],
          'markdown-vendor': ['react-markdown']
        }
      }
    },
    chunkSizeWarningLimit: 2000
  },
  optimizeDeps: {
    include: [
      'react', 
      'react-dom', 
      'react-router-dom',
      'antd',
      'axios',
      'zustand',
      'react-markdown',
      'monaco-editor',
      '@monaco-editor/react'
    ],
    exclude: [
      'prismjs/components/*'
    ]
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  assetsInclude: ['**/*.ttf', '**/*.woff', '**/*.woff2'],
  publicDir: 'public'
})
