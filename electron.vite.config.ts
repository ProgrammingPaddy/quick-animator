import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    // The Help pane bundles docs/animation-rules.md, which sits outside the renderer root.
    server: { fs: { allow: [process.cwd()] } },
  },
})
