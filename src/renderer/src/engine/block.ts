// ────────────────────────────────────────────────────────────────────────────
// 块类型识别 + 整块渲染。
// 每个块对应一行 markdown。块前缀（# / > / - / 1. / - [x]）保留为 .mk 标记符，
// 聚焦时显示、失焦时由 CSS 隐藏（列表/任务用 ::before 画项目符号 / 复选框）。
// 列表支持缩进嵌套：前导空白存进 .indent-src（始终 display:none，保证
// textContent === raw），视觉缩进由 padding 提供（见 editor.paint）。
// 不变式： textContent(renderBlock(raw).html) === raw
// ────────────────────────────────────────────────────────────────────────────

import { renderInline, mk, escHtml } from './inline'

export type BlockType =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'hr'
  | 'comment'

export interface BlockRender {
  type: BlockType
  html: string
  checked: boolean
  indent: number // 列表缩进层级（非列表为 0）
}

const RE_HEADING = /^(#{1,6})\s/
const RE_QUOTE = /^>\s?/
const RE_TASK = /^([ \t]*)([-*+])\s\[([ xX])\]\s/
const RE_OL = /^([ \t]*)\d+[.)]\s/
const RE_UL = /^([ \t]*)[-*+]\s/

/** 列表项前缀信息（用于回车续列表、Tab 缩进、退格降级） */
export interface ListInfo {
  kind: 'ul' | 'ol' | 'task'
  marker: string // 完整前缀（含缩进），如 "  - " / "1. " / "- [ ] "
  indent: string // 前导空白
  num?: number // ol 序号
}

export function listInfo(raw: string): ListInfo | null {
  let m: RegExpMatchArray | null
  if ((m = raw.match(RE_TASK))) return { kind: 'task', marker: m[0], indent: m[1] }
  if ((m = raw.match(RE_OL))) {
    return { kind: 'ol', marker: m[0], indent: m[1], num: parseInt(raw.slice(m[1].length), 10) }
  }
  if ((m = raw.match(RE_UL))) return { kind: 'ul', marker: m[0], indent: m[1] }
  return null
}

/** 任意块前缀（标题/引用/列表，含缩进）的长度，用于退格降级为段落 */
export function prefixLen(raw: string): number {
  const m =
    raw.match(RE_HEADING) || raw.match(RE_QUOTE) || raw.match(RE_TASK) || raw.match(RE_OL) || raw.match(RE_UL)
  return m ? m[0].length : 0
}

/** 前导空白 -> 缩进层级（2 空格或 1 制表符算一级） */
function indentLevel(ws: string): number {
  return Math.round(ws.replace(/\t/g, '  ').length / 2)
}

/** 前导空白存进始终隐藏的 span（保 textContent 等于 raw，视觉缩进交给 padding） */
function indentSpan(ws: string): string {
  return ws ? `<span class="indent-src">${escHtml(ws)}</span>` : ''
}

export function renderBlock(raw: string): BlockRender {
  let m: RegExpMatchArray | null

  if ((m = raw.match(RE_TASK))) {
    return listRender('task', raw, m[1], m[0].length, m[3].toLowerCase() === 'x')
  }
  if ((m = raw.match(RE_HEADING))) {
    return wrapSimple(('h' + m[1].length) as BlockType, raw, m[0].length)
  }
  if ((m = raw.match(RE_QUOTE))) {
    return wrapSimple('quote', raw, m[0].length)
  }
  if ((m = raw.match(RE_OL))) {
    return listRender('ol', raw, m[1], m[0].length, false)
  }
  if ((m = raw.match(RE_UL))) {
    return listRender('ul', raw, m[1], m[0].length, false)
  }
  // 水平分割线：整行 3 个及以上 - / * / _
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw)) {
    return { type: 'hr', html: mk(raw), checked: false, indent: 0 }
  }
  // 整行 HTML 注释：原样显示但灰显（不解析内部 markdown），导出时排除
  if (/^\s*<!--.*-->\s*$/.test(raw)) {
    return { type: 'comment', html: escHtml(raw), checked: false, indent: 0 }
  }
  return { type: 'p', html: renderInline(raw) || '<br>', checked: false, indent: 0 }
}

function listRender(
  type: BlockType,
  raw: string,
  indentStr: string,
  markerLen: number,
  checked: boolean
): BlockRender {
  const marker = raw.slice(indentStr.length, markerLen) // "- " / "1. " / "- [x] "
  const rest = renderInline(raw.slice(markerLen))
  const html = indentSpan(indentStr) + mk(marker) + (rest || '<br>')
  return { type, html, checked, indent: indentLevel(indentStr) }
}

function wrapSimple(type: BlockType, raw: string, markerLen: number): BlockRender {
  const marker = raw.slice(0, markerLen)
  const rest = renderInline(raw.slice(markerLen))
  return { type, html: mk(marker) + (rest || '<br>'), checked: false, indent: 0 }
}
