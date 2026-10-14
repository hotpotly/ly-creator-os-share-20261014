import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: false,
      rollupOptions: { input: { index: resolve('src/main/index.ts'), 'docx-parser': resolve('src/main/docx-parser.ts'), 'pdf-parser': resolve('src/main/pdf-parser.ts'), 'task-worker': resolve('src/main/task-worker.ts') } }
    }
  },
  preload: {
    build: {
      sourcemap: false,
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: { sourcemap: false }
  }
})
