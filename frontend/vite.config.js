import { defineConfig } from 'vite'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, resolve, extname, sep } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const monacoAssets = resolve(dirname(require.resolve('monaco-editor/package.json')), 'min/vs')

// Keep the editor runtime and its Chinese messages on the same origin/version.
function localMonacoAssets() {
  let outDir
  return {
    name: 'local-monaco-assets',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    configureServer(server) {
      server.middlewares.use('/monaco/vs', (req, res, next) => {
        let file
        try { file = resolve(monacoAssets, '.' + decodeURIComponent(req.url.split('?')[0])) } catch { return next() }
        if (!file.startsWith(monacoAssets + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        const mime = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' }[extname(file)]
        if (mime) res.setHeader('Content-Type', mime)
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() { cpSync(monacoAssets, resolve(outDir, 'monaco/vs'), { recursive: true }) }
  }
}
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
  plugins: [
    react(),
    localMonacoAssets(),
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
      'ai.pkuailab.com',
      'localhost',
      '127.0.0.1'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      },
      // 开发时样本图片与模型 artifact 由后端静态服务，需代理到 4000
      '/uploads': {
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
          // TensorFlow.js 只被 AI训练专区用到，单独分包
          'tfjs-vendor': ['@tensorflow/tfjs'],
          'prism-vendor': ['prismjs'],
          'markdown-vendor': ['react-markdown'],
          // 画布导出 PPT / Word 的转换库：只在点击下载时动态 import，单独分包
          'pptx-vendor': ['pptxgenjs'],
          'docx-vendor': ['docx']
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
