import { contextBridge, ipcRenderer } from 'electron'
import type { UsageState, Settings, UpdateInfo } from '@shared/main/types'

const api = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:version'),

  getUpdateInfo: (): Promise<UpdateInfo> =>
    ipcRenderer.invoke('update:get'),

  getUsage: (): Promise<UsageState> =>
    ipcRenderer.invoke('usage:get'),

  refresh: (): Promise<UsageState> =>
    ipcRenderer.invoke('usage:refresh'),

  getSettings: (): Promise<Settings> =>
    ipcRenderer.invoke('settings:get'),

  setSettings: (partial: Partial<Settings>): Promise<void> =>
    ipcRenderer.invoke('settings:set', partial),

  resetSettings: (): Promise<void> =>
    ipcRenderer.invoke('settings:reset'),

  openExternal: (url: string): void =>
    ipcRenderer.send('shell:openExternal', url),

  openSettings: (): void =>
    ipcRenderer.send('window:openSettings'),

  resizeWindow: (height: number): void =>
    ipcRenderer.send('window:resize', height),

  onUsageUpdate: (cb: (state: UsageState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: UsageState) => cb(state)
    ipcRenderer.on('usage:update', handler)
    return () => ipcRenderer.off('usage:update', handler)
  },

  onSettingsUpdate: (cb: (settings: Settings) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, settings: Settings) => cb(settings)
    ipcRenderer.on('settings:update', handler)
    return () => ipcRenderer.off('settings:update', handler)
  },

  onWindowShown: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('window:shown', handler)
    return () => ipcRenderer.off('window:shown', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
