import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aigwLogs } from './vite-plugin-aigw-logs'

// The gateway sends no CORS headers, so the dev server proxies to it instead of
// the browser calling it directly. Override the targets with AIGW_URL /
// AIGW_ADMIN_URL if aigw is not on localhost.
const gateway = process.env.AIGW_URL ?? 'http://localhost:1975'
const admin = process.env.AIGW_ADMIN_URL ?? 'http://localhost:1064'
// The Compose project lives one directory up; that is where `docker compose`
// has to run to tail the gateway's access log.
const composeDir = process.env.AIGW_COMPOSE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  plugins: [react(), aigwLogs({ composeDir })],
  // Surfaced on the Settings page — the browser cannot otherwise know what the
  // dev server proxies to.
  define: {
    __AIGW_URL__: JSON.stringify(gateway),
    __AIGW_ADMIN_URL__: JSON.stringify(admin),
  },
  server: {
    port: 5173,
    proxy: {
      // OpenAI-compatible endpoints and the MCP endpoint.
      '/api/gateway': {
        target: gateway,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/gateway/, ''),
        // Keep SSE flowing instead of buffering whole responses.
        selfHandleResponse: false,
      },
      // Admin server: /health and /metrics.
      '/api/admin': {
        target: admin,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/admin/, ''),
      },
    },
  },
})
