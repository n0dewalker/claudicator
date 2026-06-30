/// <reference types="vite/client" />

import type { ElectronAPI } from '@app/preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
