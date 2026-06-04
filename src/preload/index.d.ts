import type { OpenResult, WriteResult, SaveAsResult, AppState, ActionName } from '@shared/ipc'

export interface XuanApi {
  openFile: () => Promise<OpenResult>
  writeFile: (filePath: string, content: string) => Promise<WriteResult>
  saveAs: (content: string, defaultPath?: string) => Promise<SaveAsResult>
  updateState: (state: AppState) => void
  savedForClose: () => void
  writeClipboard: (text: string) => void
  onAction: (cb: (action: ActionName) => void) => void
  onOpenFile: (cb: (data: { path: string; content: string }) => void) => void
}

declare global {
  interface Window {
    api: XuanApi
  }
}
