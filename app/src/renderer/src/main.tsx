import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyAppearance, readCachedAppearance } from './utils/appearance'
import './styles/tokens.css'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root is missing')

applyAppearance(readCachedAppearance())

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
