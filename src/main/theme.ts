import { nativeTheme, app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type ThemeChoice = 'light' | 'dark' | 'system'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(data: Record<string, unknown>): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(data, null, 2))
  } catch {
    /* 持久化失败可忽略 */
  }
}

/** 当前主题选择（默认浅色） */
export function currentTheme(): ThemeChoice {
  const t = readSettings().theme
  return t === 'dark' || t === 'system' ? t : 'light'
}

/** 启动时套用已保存的主题 */
export function applyStartupTheme(): void {
  nativeTheme.themeSource = currentTheme()
}

/** 切换主题：改 nativeTheme（驱动渲染层 prefers-color-scheme 与窗口外观）并持久化 */
export function setTheme(t: ThemeChoice): void {
  nativeTheme.themeSource = t
  const data = readSettings()
  data.theme = t
  writeSettings(data)
}
