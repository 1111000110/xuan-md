import { contextBridge, ipcRenderer, clipboard } from 'electron'
import type {
  OpenResult,
  WriteResult,
  SaveAsResult,
  ExportResult,
  AppState,
  ActionName
} from '@shared/ipc'

const api = {
  openFile: (): Promise<OpenResult> => ipcRenderer.invoke('dialog:open'),

  writeFile: (filePath: string, content: string): Promise<WriteResult> =>
    ipcRenderer.invoke('file:write', { filePath, content }),

  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:exists', filePath),

  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('link:openExternal', url),

  saveAs: (content: string, defaultPath?: string): Promise<SaveAsResult> =>
    ipcRenderer.invoke('dialog:saveAs', { content, defaultPath }),

  updateState: (state: AppState): void => ipcRenderer.send('state:update', state),

  savedForClose: (): void => ipcRenderer.send('app:savedForClose'),

  writeClipboard: (text: string): void => clipboard.writeText(text),

  readClipboard: (): string => clipboard.readText(),

  saveImage: (bytes: Uint8Array, ext: string, docPath: string | null): Promise<string | null> =>
    ipcRenderer.invoke('image:save', { bytes, ext, docPath }),

  exportPdf: (defaultName: string): Promise<ExportResult> =>
    ipcRenderer.invoke('export:pdf', { defaultName }),

  // 主窗口：增 / 清速记面板的文档
  addQuickDoc: (
    path: string
  ): Promise<{ ok: boolean; shortcut?: string; count?: number; error?: string }> =>
    ipcRenderer.invoke('quick:add', { path }),

  clearQuickDocs: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('quick:clear'),

  // 速记面板窗口：接收文档列表、请求隐藏
  onQuickDocs: (
    cb: (docs: { path: string; name: string; content: string; ok: boolean }[]) => void
  ): void => {
    ipcRenderer.on('quick:docs', (_e, docs) => cb(docs))
  },

  hideQuickPanel: (): void => ipcRenderer.send('quickpanel:hide'),

  // 速记面板内的管理操作
  quickAddCurrent: (): Promise<{ ok: boolean; reason?: string; count?: number }> =>
    ipcRenderer.invoke('quick:addCurrent'),
  quickRemove: (path: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('quick:remove', { path }),
  quickReorder: (path: string, dir: -1 | 1): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('quick:reorder', { path, dir }),
  quickRename: (path: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('quick:rename', { path, name }),
  quickOpenInMain: (path: string): void => ipcRenderer.send('quick:openInMain', { path }),

  onAction: (cb: (action: ActionName) => void): void => {
    ipcRenderer.on('action', (_e, action: ActionName) => cb(action))
  },

  onOpenFile: (cb: (data: { path: string; content: string }) => void): void => {
    ipcRenderer.on('file:opened', (_e, data: { path: string; content: string }) => cb(data))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type XuanApi = typeof api
