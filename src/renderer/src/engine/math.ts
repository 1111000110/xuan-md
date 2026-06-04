// ────────────────────────────────────────────────────────────────────────────
// 数学公式（KaTeX）。
// 含公式的块采用「聚焦显源码 / 失焦渲染」的切换：聚焦时显示 $...$ 源码
// （textContent===raw，可正常编辑），失焦时渲染为 KaTeX。
// 支持行内 $...$ 与单行块级 $$...$$。（多行 $$ 块暂未支持。）
// ────────────────────────────────────────────────────────────────────────────

import katex from 'katex'
import { renderInline, escHtml } from './inline'

const RE_BLOCK = /^\s*\$\$(.+?)\$\$\s*$/
// 行内：$ 紧跟非空白、$ 前也是非空白，避免把 "$5 和 $10" 误判为公式
const RE_INLINE_SRC = '\\$(\\S(?:[^$\\n]*?\\S)?)\\$'

/** 该行是否含可渲染的数学公式 */
export function hasMath(raw: string): boolean {
  return RE_BLOCK.test(raw) || new RegExp(RE_INLINE_SRC).test(raw)
}

function katexRender(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false })
  } catch {
    const d = display ? '$$' : '$'
    return escHtml(`${d}${tex}${d}`)
  }
}

/** 失焦预览：数学部分渲染为 KaTeX，其余文本走常规行内渲染 */
export function renderMathPreview(raw: string): string {
  const bm = raw.match(RE_BLOCK)
  if (bm) return `<span class="math-display">${katexRender(bm[1], true)}</span>`

  let out = ''
  let last = 0
  const re = new RegExp(RE_INLINE_SRC, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out += renderInline(raw.slice(last, m.index))
    out += `<span class="math-inline">${katexRender(m[1], false)}</span>`
    last = m.index + m[0].length
  }
  out += renderInline(raw.slice(last))
  return out || '<br>'
}
