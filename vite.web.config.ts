import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only preview of the renderer for design work. It uses the window.beacon
// MOCK (src/renderer/src/mock.ts) so the real UI renders without Electron. NOT used
// by the app itself — `npm run dev` still runs the real Electron launcher.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174 }
})
