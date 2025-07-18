/**
 * Vitest配置文件
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.js'
      ]
    },
    include: ['src/**/*.{test,spec}.{js,jsx}']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
