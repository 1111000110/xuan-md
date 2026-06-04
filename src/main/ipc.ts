import { ipcMain, BrowserWindow } from 'electron'
import type { AppState } from '@shared/ipc'
import { openFileDialog, writeFileTo, saveAsDialog } from './file-io'

/** 每个窗口的主进程侧状态 */
interface WinState {
  dirty: boolean
  fileName: string
  filePath?: string
  /** 关窗确认流程里置位，避免再次触发确认 */
  forceClose: boolean
}

const states = new WeakMap<BrowserWindow, WinState>()

export function getState(win: BrowserWindow): WinState {
  let s = states.get(win)
  if (!s) {
    s = { dirty: false, fileName: 'Untitled.md', forceClose: false }
    states.set(win, s)
  }
  return s
}

export function registerIpc(): void {
  ipcMain.handle('dialog:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    return openFileDialog(win)
  })

  ipcMain.handle('file:write', async (_e, payload: { filePath: string; content: string }) => {
    return writeFileTo(payload.filePath, payload.content)
  })

  ipcMain.handle(
    'dialog:saveAs',
    async (e, payload: { content: string; defaultPath?: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return null
      return saveAsDialog(win, payload.content, payload.defaultPath)
    }
  )

  ipcMain.on('state:update', (e, next: AppState) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const s = getState(win)
    s.dirty = next.dirty
    s.fileName = next.fileName
    s.filePath = next.filePath
    win.setTitle(`${next.dirty ? '● ' : ''}${next.fileName} — xuan-md`)
    win.setDocumentEdited(next.dirty)
    if (next.filePath) win.setRepresentedFilename(next.filePath)
  })

  ipcMain.on('app:savedForClose', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    getState(win).forceClose = true
    win.close()
  })
}
