import { ipcMain, BrowserWindow, app, dialog, shell } from 'electron'
import { writeFile, mkdir, access } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { randomBytes } from 'crypto'
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

  ipcMain.handle('file:exists', async (_e, filePath: string) => {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  })

  // Markdown 链接由渲染进程显式转交，避免编辑器在当前窗口内导航走掉。
  ipcMain.handle('link:openExternal', async (_e, rawUrl: unknown): Promise<boolean> => {
    if (typeof rawUrl !== 'string') return false
    try {
      const url = new URL(rawUrl)
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return false
      await shell.openExternal(url.toString())
      return true
    } catch {
      return false
    }
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

  // 图片落盘：已保存文档存到同目录的 assets/（嵌入相对路径，便于随文档迁移）；
  // 未保存文档存到 userData/images/（嵌入绝对路径）。返回可写进 markdown 的路径。
  ipcMain.handle(
    'image:save',
    async (_e, payload: { bytes: Uint8Array; ext: string; docPath: string | null }) => {
      try {
        const ext = /^[a-z0-9]+$/i.test(payload.ext) ? payload.ext : 'png'
        const name = `image-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`
        let dir: string
        let embed: string
        if (payload.docPath) {
          dir = join(dirname(payload.docPath), 'assets')
          embed = `assets/${name}`
        } else {
          dir = join(app.getPath('userData'), 'images')
          embed = join(dir, name) // 未保存文档：绝对路径
        }
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, name), Buffer.from(payload.bytes))
        return embed
      } catch (err) {
        console.error('image:save failed:', err)
        return null
      }
    }
  )

  // 导出 PDF：用当前窗口走 print 媒介渲染（复用已加载的 CSS/字体），保存到用户选定路径。
  ipcMain.handle('export:pdf', async (e, payload: { defaultName: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false, error: 'no window' }
    try {
      const base = (payload.defaultName || 'Untitled').replace(/\.(md|markdown)$/i, '')
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '导出为 PDF',
        defaultPath: `${basename(base)}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false }
      const data = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 }
      })
      await writeFile(filePath, data)
      return { ok: true, path: filePath }
    } catch (err) {
      console.error('export:pdf failed:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
