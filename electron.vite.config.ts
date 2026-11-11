import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: 'cjs' } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), {
      name: 'production-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace("connect-src 'self' ws://localhost:* ws://127.0.0.1:*", "connect-src 'self'")
    }]
  }
})
