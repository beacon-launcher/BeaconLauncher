import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Beacon — Electron main/preload are bundled to CJS with node deps kept external
// (@xmcl/* use Node APIs); the renderer is a normal Vite + React app.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two entries: the main process, and the installer utilityProcess worker
        // (heavy downloading runs there, off the main thread).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'installer-worker': resolve(__dirname, 'src/main/installer-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    // Bind the dev server to IPv4 explicitly. By default Vite listens on `localhost`,
    // which now resolves to IPv6 (::1) only, while Electron loads `127.0.0.1` → the
    // renderer would fail with ERR_CONNECTION_REFUSED and show a blank window.
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
