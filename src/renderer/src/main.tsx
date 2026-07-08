// Global base styles (reset, variables, shared atoms, theme) must load before any component's
// own stylesheet, so this import stays first — ahead of App and its component CSS imports.
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installMock } from './mock'

// In the real app Electron's preload provides window.beacon. When running the
// browser-only design preview (npm run dev:web) it's absent → install the mock.
if (!(window as unknown as { beacon?: unknown }).beacon) {
  installMock()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
