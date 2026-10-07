import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStore } from './state/store'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// In development, let scripts driving the app read its state, for verification.
if (import.meta.env.DEV) (window as unknown as { __quickAnimator?: unknown }).__quickAnimator = { useStore }

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
