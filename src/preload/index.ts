import { contextBridge, ipcRenderer, clipboard } from 'electron'
import type { OpenResult, WriteResult, SaveAsResult, AppState, ActionName } from '@shared/ipc'

const api = {
  openFile: (): Promise<OpenResult> => ipcRenderer.invoke('dialog:open'),

  writeFile: (filePath: string, content: string): Promise<WriteResult> =>
    ipcRenderer.invoke('file:write', { filePath, content }),

  saveAs: (content: string, defaultPath?: string): Promise<SaveAsResult> =>
    ipcRenderer.invoke('dialog:saveAs', { content, defaultPath }),

  updateState: (state: AppState): void => ipcRenderer.send('state:update', state),

  savedForClose: (): void => ipcRenderer.send('app:savedForClose'),

  writeClipboard: (text: string): void => clipboard.writeText(text),

  onAction: (cb: (action: ActionName) => void): void => {
    ipcRenderer.on('action', (_e, action: ActionName) => cb(action))
  },

  onOpenFile: (cb: (data: { path: string; content: string }) => void): void => {
    ipcRenderer.on('file:opened', (_e, data: { path: string; content: string }) => cb(data))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type XuanApi = typeof api
