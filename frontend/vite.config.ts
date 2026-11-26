import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // 端口被占用时直接报错，而不是自动跳到 5174，保证端口固定
    proxy: {
      // 所有 /api 开头的请求转发到 FastAPI 后端
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // SSE 流式请求同样兼容：Vite 基于 http-proxy，默认不缓冲响应体，
        // 无需额外配置即可转发 text/event-stream。
      },
    },
  },
})
