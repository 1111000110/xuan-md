// 跨进程共享的 IPC 类型契约（main / preload / renderer 共用）

/** 打开文件对话框的返回 */
export type OpenResult = { path: string; content: string } | null

/** 写文件的返回 */
export type WriteResult = { ok: true; path: string } | { ok: false; error: string }

/** 另存为对话框的返回 */
export type SaveAsResult = { path: string } | null

/** 导出（PDF 等）的返回 */
export type ExportResult = { ok: true; path: string } | { ok: false; error?: string }

/** 渲染进程上报给主进程的窗口状态（用于标题栏、未保存标记、关窗确认） */
export interface AppState {
  dirty: boolean
  fileName: string
  filePath?: string
}

/** 主进程 -> 渲染进程的动作指令（来自菜单 / 快捷键） */
export type ActionName =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'saveForClose'
  | 'closeTab'
  | 'find'
  | 'exportPdf'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'insertTable'
  | 'toggleOutline'
  | 'toggleSource'
  | 'format:bold'
  | 'format:italic'
  | 'format:strike'
  | 'format:code'
  | 'format:link'
