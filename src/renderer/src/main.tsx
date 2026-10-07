import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { getEditor } from './code/editor'
import { openProject } from './project/controller'
import { useStore } from './state/store'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// In development, let scripts driving the app read its state, open projects, and reach the
// editor, for verification.
if (import.meta.env.DEV) (window as unknown as { __quickAnimator?: unknown }).__quickAnimator = { useStore, openProject, getEditor }

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
