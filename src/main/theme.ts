import { nativeTheme } from 'electron'
import { readSettings, writeSettings } from './settings'

export type ThemeChoice = 'light' | 'dark' | 'system'

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
