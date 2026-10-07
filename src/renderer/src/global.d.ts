/// <reference types="vite/client" />
import type { Api } from '../../shared/api'

declare global {
  interface Window {
    /** Present inside Electron. Absent when the renderer is opened in a plain browser. */
    api?: Api
  }
}

export {}
