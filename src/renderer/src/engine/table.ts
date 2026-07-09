// ────────────────────────────────────────────────────────────────────────────
// 表格。表格是「多行块」（kind='table'，raw 内含 \n），但始终渲染为可编辑的
// <table>：单元格各自 contenteditable，编辑即时回写 raw；右侧 / 底部有「+」按钮
// 增删列 / 行（飞书式）。不再有「点击切到整段源码」的行为。
// ────────────────────────────────────────────────────────────────────────────

import { renderInline } from './inline'

export type Align = 'left' | 'center' | 'right' | 'none'

export interface TableModel {
  headers: string[]
  aligns: Align[]
  rows: string[][]
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  // 按「未转义的 |」切分，并把 \| 还原成字面竖线（单元格内可含 |）
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
    } else if (t[i] === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += t[i]
    }
  }
  cells.push(cur)
  return cells
}

export function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 0
}

export function isSeparatorRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('-')) return false
  const cells = splitRow(t)
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c))
}

export function isValidTable(raw: string): boolean {
  const lines = raw.split('\n')
  return lines.length >= 2 && isTableRow(lines[0]) && isSeparatorRow(lines[1])
}

function parseAligns(sep: string): Align[] {
  return splitRow(sep).map((c) => {
    const s = c.trim()
    const l = s.startsWith(':')
    const r = s.endsWith(':')
    if (l && r) return 'center'
    if (r) return 'right'
    if (l) return 'left'
    return 'none'
  })
}

export function parseTable(raw: string): TableModel {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const headers = lines[0] ? splitRow(lines[0]).map((c) => c.trim()) : ['']
  const aligns = lines[1] ? parseAligns(lines[1]) : headers.map(() => 'none' as Align)
  while (aligns.length < headers.length) aligns.push('none')
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l).map((c) => c.trim())
    return headers.map((_, i) => cells[i] ?? '')
  })
  return { headers, aligns, rows }
}

function sepCell(a: Align): string {
  return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'
}

/** 由模型重建 markdown 源码 */
export function buildTable(model: TableModel): string {
  const n = model.headers.length
  // 单元格内的字面 | 转义为 \|，以免与列分隔符混淆
  const esc = (c: string): string => c.trim().replace(/\|/g, '\\|')
  const row = (cells: string[]): string => '| ' + cells.map(esc).join(' | ') + ' |'
  const aligns = model.aligns.slice(0, n)
  while (aligns.length < n) aligns.push('none')
  const out = [row(model.headers), '| ' + aligns.map(sepCell).join(' | ') + ' |']
  for (const r of model.rows) out.push(row(r))
  return out.join('\n')
}

function alignStyle(a: Align): string {
  return a === 'none' ? '' : ` style="text-align:${a}"`
}

/** 渲染为可编辑的 <table>（单元格 contenteditable，附增行 / 增列按钮） */
export function renderEditableTable(raw: string): string {
  const m = parseTable(raw)
  let html = '<div class="tbl-wrap"><div class="tbl-scroll"><table class="md-table"><thead><tr>'
  m.headers.forEach((h, c) => {
    html += `<th contenteditable="true" data-r="-1" data-c="${c}"${alignStyle(m.aligns[c])}>${renderInline(h)}</th>`
  })
  html += '</tr></thead><tbody>'
  m.rows.forEach((rowCells, r) => {
    html += '<tr>'
    rowCells.forEach((cell, c) => {
      html += `<td contenteditable="true" data-r="${r}" data-c="${c}"${alignStyle(m.aligns[c])}>${renderInline(cell)}</td>`
    })
    html += '</tr>'
  })
  html += '</tbody></table></div>'
  html += '<button class="tbl-add-col" contenteditable="false" title="添加列">+</button>'
  html += '<button class="tbl-add-row" contenteditable="false" title="添加行">+</button>'
  html += '</div>'
  return html
}

/** 默认 2×2 表格模板 */
export function tableTemplate(): string {
  return ['| 列 1 | 列 2 |', '| --- | --- |', '| 单元格 | 单元格 |', '| 单元格 | 单元格 |'].join('\n')
}
