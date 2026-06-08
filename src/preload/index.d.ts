import type {
  OpenResult,
  WriteResult,
  SaveAsResult,
  ExportResult,
  AppState,
  ActionName
} from '@shared/ipc'

export interface XuanApi {
  openFile: () => Promise<OpenResult>
  writeFile: (filePath: string, content: string) => Promise<WriteResult>
  fileExists: (filePath: string) => Promise<boolean>
  saveAs: (content: string, defaultPath?: string) => Promise<SaveAsResult>
  updateState: (state: AppState) => void
  savedForClose: () => void
  writeClipboard: (text: string) => void
  readClipboard: () => string
  saveImage: (bytes: Uint8Array, ext: string, docPath: string | null) => Promise<string | null>
  exportPdf: (defaultName: string) => Promise<ExportResult>
  addQuickDoc: (
    path: string
  ) => Promise<{ ok: boolean; shortcut?: string; count?: number; error?: string }>
  clearQuickDocs: () => Promise<{ ok: boolean }>
  onQuickDocs: (
    cb: (docs: { path: string; name: string; content: string; ok: boolean }[]) => void
  ) => void
  hideQuickPanel: () => void
  quickAddCurrent: () => Promise<{ ok: boolean; reason?: string; count?: number }>
  quickRemove: (path: string) => Promise<{ ok: boolean }>
  quickReorder: (path: string, dir: -1 | 1) => Promise<{ ok: boolean }>
  quickRename: (path: string, name: string) => Promise<{ ok: boolean }>
  quickOpenInMain: (path: string) => void
  onAction: (cb: (action: ActionName) => void) => void
  onOpenFile: (cb: (data: { path: string; content: string }) => void) => void
}

declare global {
  interface Window {
    api: XuanApi
  }
}
