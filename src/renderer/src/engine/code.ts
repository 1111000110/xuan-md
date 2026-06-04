// ────────────────────────────────────────────────────────────────────────────
// 围栏代码块支持。沿用「单行即一个块」的模型：代码块由连续的若干行块组成，
// 每行块的「代码角色」（围栏起始 / 内容 / 围栏结束）由文档级的上下文扫描决定。
// 高亮用 highlight.js 常用语言子集，按行高亮——保持 textContent === raw。
// ────────────────────────────────────────────────────────────────────────────

import hljs from 'highlight.js/lib/common'
import { escHtml } from './inline'

export type CodeRole = 'open' | 'content' | 'close'

export interface CodeInfo {
  role: CodeRole
  lang: string
}

const RE_FENCE_OPEN = /^```(\w*)$/
const RE_FENCE_CLOSE = /^```\s*$/

/** 围栏起始行（``` 或 ```lang），返回匹配以取语言 */
export function matchFenceOpen(raw: string): RegExpMatchArray | null {
  return raw.match(RE_FENCE_OPEN)
}

/** 围栏结束行（裸 ```） */
export function isFenceClose(raw: string): boolean {
  return RE_FENCE_CLOSE.test(raw)
}

export function sameCode(a: CodeInfo | null, b: CodeInfo | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.role === b.role && a.lang === b.lang
}

/** 单行代码高亮，保持 textContent === code */
export function highlightCodeLine(code: string, lang: string): string {
  if (!code) return '<br>'
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* 高亮失败则退回纯文本 */
    }
  }
  return escHtml(code)
}

/** 围栏行渲染：``` 变暗，后面的语言名正常显示 */
export function renderFenceLine(raw: string): string {
  const m = raw.match(/^(```)(.*)$/)
  if (m) return `<span class="fence-mark">${escHtml(m[1])}</span>${escHtml(m[2])}`
  return escHtml(raw) || '<br>'
}
