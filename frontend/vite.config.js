import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
  plugins: [
    react(),
    // Monaco Editor 插件 - 自动处理workers
    monacoEditorPlugin.default({
      languageWorkers: ['editorWorkerService'],
      customWorkers: [
        {
          label: 'editorWorkerService',
          entry: 'monaco-editor/esm/vs/editor/editor.worker'
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
          'monaco-vendor': ['monaco-editor', '@monaco-editor/react'],
          'prism-vendor': ['prismjs'],
          'markdown-vendor': ['react-markdown']
        }
      }
    },
    chunkSizeWarningLimit: 1500
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
