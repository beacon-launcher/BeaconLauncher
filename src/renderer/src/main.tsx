import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installMock } from './mock'
import './styles.css'

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
