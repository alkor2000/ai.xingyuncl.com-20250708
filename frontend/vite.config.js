import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
        // 添加hash强制版本更新
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          // 核心依赖
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          'utils-vendor': ['axios', 'zustand'],
          // Antd分离但保持统一
          'antd-vendor': ['antd', '@ant-design/icons'],
          // Monaco Editor 单独分块
          'monaco-vendor': ['monaco-editor', '@monaco-editor/react'],
          // Prism.js 单独分块，支持动态加载
          'prism-vendor': ['prismjs'],
          // Markdown 分块
          'markdown-vendor': ['react-markdown']
        }
      }
    },
    // 调整chunk大小警告阈值
    chunkSizeWarningLimit: 1500
  },
  // 优化依赖预构建
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
      'prismjs/components/*'  // 排除 Prism 组件，让它们动态加载
    ]
  },
  // 处理Monaco Editor的worker
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  // 确保Monaco Editor的CSS和字体正确加载
  assetsInclude: ['**/*.ttf', '**/*.woff', '**/*.woff2']
})
