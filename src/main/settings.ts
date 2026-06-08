import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 一条速记文档：真实路径 + 可选显示别名 */
export interface QuickEntry {
  path: string
  name?: string
}

/** 速记面板配置：一组速记文档（有序）+ 唤起面板的系统级快捷键 */
export interface QuickConfig {
  docs: QuickEntry[]
  shortcut: string
}

/** 默认全局快捷键（可在 settings.json 里改 quick.shortcut） */
export const DEFAULT_QUICK_SHORTCUT = 'Shift+Alt+Space'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

export function writeSettings(data: Record<string, unknown>): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(data, null, 2))
  } catch {
    /* 持久化失败可忽略 */
  }
}

/** 兼容老格式（字符串数组）与新格式（{path,name} 数组） */
function normalizeDocs(raw: unknown): QuickEntry[] {
  if (!Array.isArray(raw)) return []
  const out: QuickEntry[] = []
  for (const d of raw) {
    if (typeof d === 'string' && d) out.push({ path: d })
    else if (d && typeof d === 'object') {
      const o = d as { path?: unknown; name?: unknown }
      if (typeof o.path === 'string' && o.path) {
        const e: QuickEntry = { path: o.path }
        if (typeof o.name === 'string' && o.name.trim()) e.name = o.name.trim()
        out.push(e)
      }
    }
  }
  return out
}

export function getQuickConfig(): QuickConfig {
  const q = readSettings().quick as { docs?: unknown; shortcut?: unknown } | undefined
  const docs = normalizeDocs(q?.docs)
  const shortcut = typeof q?.shortcut === 'string' && q.shortcut ? q.shortcut : DEFAULT_QUICK_SHORTCUT
  return { docs, shortcut }
}

function saveQuickConfig(cfg: QuickConfig): QuickConfig {
  writeSettings({ ...readSettings(), quick: cfg })
  return cfg
}

/** 加入速记面板（按路径去重） */
export function addQuickDoc(path: string): QuickConfig {
  const cfg = getQuickConfig()
  if (!cfg.docs.some((d) => d.path === path)) cfg.docs.push({ path })
  return saveQuickConfig(cfg)
}

/** 从速记面板移除某文档 */
export function removeQuickDoc(path: string): QuickConfig {
  const cfg = getQuickConfig()
  cfg.docs = cfg.docs.filter((d) => d.path !== path)
  return saveQuickConfig(cfg)
}

/** 上移(-1)/下移(1) 某文档 */
export function reorderQuickDoc(path: string, dir: -1 | 1): QuickConfig {
  const cfg = getQuickConfig()
  const i = cfg.docs.findIndex((d) => d.path === path)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cfg.docs.length) return cfg
  const tmp = cfg.docs[i]
  cfg.docs[i] = cfg.docs[j]
  cfg.docs[j] = tmp
  return saveQuickConfig(cfg)
}

/** 设置显示别名（空串则清除别名，回退到文件名） */
export function renameQuickDoc(path: string, name: string): QuickConfig {
  const cfg = getQuickConfig()
  const d = cfg.docs.find((x) => x.path === path)
  if (d) {
    if (name.trim()) d.name = name.trim()
    else delete d.name
  }
  return saveQuickConfig(cfg)
}

/** 清空速记面板的文档 */
export function clearQuickDocs(): void {
  const data = readSettings()
  delete data.quick
  writeSettings(data)
}
