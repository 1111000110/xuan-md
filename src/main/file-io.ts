import { dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type { OpenResult, WriteResult, SaveAsResult } from '@shared/ipc'

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'txt'] },
  { name: '所有文件', extensions: ['*'] }
]

export async function openFileDialog(win: BrowserWindow): Promise<OpenResult> {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: MD_FILTERS
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const path = res.filePaths[0]
  const content = await readFile(path, 'utf-8')
  return { path, content }
}

export async function writeFileTo(filePath: string, content: string): Promise<WriteResult> {
  try {
    await writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function saveAsDialog(
  win: BrowserWindow,
  content: string,
  defaultPath?: string
): Promise<SaveAsResult> {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath ?? 'Untitled.md',
    filters: MD_FILTERS
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, content, 'utf-8')
  return { path: res.filePath }
}
