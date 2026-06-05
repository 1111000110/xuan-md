// ────────────────────────────────────────────────────────────────────────────
// WYSIWYG 引擎主体（M2）。
//
// 文档 = 一组「块」，每块是一个独立的 contenteditable <div>，对应一行 markdown。
// · 块内实时渲染：每次输入只重渲染当前块，按字符偏移恢复光标（输入丝滑、光标稳定）。
// · 标记符随块聚焦显隐（CSS :focus 控制），失焦后呈现干净的富文本。
// · 回车拆块 / 行首退格并块 / 上下方向键跨块 / 续列表 等结构操作由本类接管。
//
// 对外接口与 M1 占位编辑器保持一致：getContent/setContent/onChange/focus/getStats/wrap
// ────────────────────────────────────────────────────────────────────────────

import { renderBlock, listInfo, prefixLen } from './block'
import { renderInline } from './inline'
import {
  getCaretOffset,
  setCaretOffset,
  selectionOffsets,
  caretClientRect,
  placeCaretAtPoint,
  rangeForOffsets
} from './caret'
import {
  type CodeInfo,
  matchFenceOpen,
  isFenceClose,
  sameCode,
  highlightCodeLine,
  renderFenceLine
} from './code'
import { hasMath, renderMathPreview } from './math'
import { hasImage, renderImagePreview, extFromMime } from './image'
import {
  isTableRow,
  isSeparatorRow,
  parseTable,
  buildTable,
  renderEditableTable,
  tableTemplate
} from './table'

export interface EditorStats {
  words: number
  chars: number
  lines: number
}

/** 一处查找命中：所在块下标 + 块内字符区间 */
interface FindMatch {
  blockIdx: number
  start: number
  end: number
}

/** 查找替换浮层的 DOM 引用集合 */
interface FindBar {
  root: HTMLElement
  input: HTMLInputElement
  count: HTMLElement
  replaceRow: HTMLElement
  replaceInput: HTMLInputElement
  caseBtn: HTMLElement
}

interface Block {
  id: number
  raw: string
  el: HTMLElement
  /** 代码块上下文（围栏起始/内容/结束），非代码为 null */
  code: CodeInfo | null
  /** 'line'=单行块；'table'=多行表格块 */
  kind: 'line' | 'table'
}

export class Editor {
  private root: HTMLElement
  private blocks: Block[] = []
  private nextId = 1
  private changeCb: (() => void) | null = null
  private composing = false
  private desiredX: number | null = null
  /** 当前被「邻近显隐」点亮的 .md 包裹层，便于下次清除 */
  private revealed: HTMLElement[] = []
  /** 跨块选择（飞书式）：选中的块区间，null 表示无 */
  private blockSelection: { from: number; to: number } | null = null
  /** 连按 Cmd+A 的层级：0 无 / 1 当前行 / 2 当前模块 / 3 全文 */
  private selectCycle = 0
  /** Cmd+A 序列开始时的锚点块索引 */
  private selectAnchor = 0
  /** 本轮 Cmd+A 是否从表格单元格起步（决定层级：本格→整表→模块→全文） */
  private selectStartedInCell = false
  /** 本轮 Cmd+A 是否从代码块内起步（决定层级：本行→整块代码→模块→全文） */
  private selectStartedInCode = false
  /** 表格右键菜单的浮层 */
  private tableMenu: HTMLElement | null = null
  /** 当前文档路径（用于图片相对路径解析 + 选择图片保存目录） */
  private docPath: string | null = null
  /** 查找替换：浮层 + 状态 */
  private findBar: FindBar | null = null
  private findHl: HTMLDivElement | null = null
  private findMatches: FindMatch[] = []
  private findCurrent = 0
  private findCaseSensitive = false
  private onDocScroll: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'xuan-editor'
    parent.appendChild(this.root)

    this.root.addEventListener('input', this.onInput)
    this.root.addEventListener('keydown', this.onKeydown)
    this.root.addEventListener('paste', this.onPaste)
    this.root.addEventListener('dragover', this.onDragOver)
    this.root.addEventListener('drop', this.onDrop)
    this.root.addEventListener('click', this.onClick)
    this.root.addEventListener('contextmenu', this.onContextMenu)
    // 公式块聚焦/失焦时在「源码 / KaTeX 渲染」之间切换
    this.root.addEventListener('focusin', this.onFocusToggle)
    this.root.addEventListener('focusout', this.onFocusToggle)
    this.root.addEventListener('compositionstart', () => {
      this.composing = true
    })
    this.root.addEventListener('compositionend', (e) => {
      this.composing = false
      const cell = this.cellFromNode(e.target as Node)
      if (cell) {
        this.reRenderCell(cell.cell)
        this.updateTableRaw(cell.block)
        this.emitChange()
        return
      }
      const block = this.blockFromNode(e.target as Node)
      if (block) this.reRender(block)
      this.emitChange()
    })
    // 光标移动时更新「邻近标记符」的显隐
    document.addEventListener('selectionchange', this.onSelectionChange)

    this.setContent('')
  }

  // ── 对外 API ───────────────────────────────────────────────────────────────
  getContent(): string {
    return this.blocks.map((b) => b.raw).join('\n')
  }

  setContent(md: string): void {
    this.root.replaceChildren()
    this.blocks = []
    const lines = md.length ? md.split('\n') : ['']
    for (const line of lines) this.appendBlock(line)
    for (const b of this.computeCodeContext()) this.paint(b)
    this.detectAndMergeTables()
    this.emitChange()
  }

  /** 告知当前文档路径，供图片相对路径解析与保存目录选择 */
  setDocPath(path: string | null): void {
    this.docPath = path
  }

  /** 当前文档所在目录（相对图片路径的解析基准） */
  private docDir(): string | null {
    return this.docPath ? this.docPath.replace(/[/\\][^/\\]*$/, '') : null
  }

  focus(): void {
    const first = this.blocks[0]
    if (!first) return
    first.el.focus()
    this.placeCaret(first, first.raw.length)
  }

  /** 滚动到第 index 个标题块（供大纲点击跳转） */
  scrollToHeading(index: number): void {
    const hs = this.root.querySelectorAll(
      '.block.h1, .block.h2, .block.h3, .block.h4, .block.h5, .block.h6'
    )
    const el = hs[index] as HTMLElement | undefined
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  onChange(cb: () => void): void {
    this.changeCb = cb
  }

  getStats(): EditorStats {
    const text = this.getContent()
    const words = (text.match(/[一-龥]|[A-Za-z0-9]+/g) || []).length
    return { words, chars: text.length, lines: this.blocks.length }
  }

  /** 用 prefix/suffix 包裹当前激活块的选区（加粗、斜体等格式命令） */
  wrap(prefix: string, suffix: string = prefix): void {
    const block = this.activeBlock()
    if (!block) return
    const { start, end } = selectionOffsets(block.el)
    const raw = block.el.textContent ?? ''
    const selected = raw.slice(start, end)
    block.raw = raw.slice(0, start) + prefix + selected + suffix + raw.slice(end)
    this.paint(block)
    if (selected) {
      this.placeCaret(block, start + prefix.length, end + prefix.length)
    } else {
      this.placeCaret(block, start + prefix.length)
    }
    this.emitChange()
  }

  /** 飞书式渐进全选：连按 Cmd+A 依次「当前行 → 当前模块 → 全文」 */
  selectAll(): void {
    const ae = document.activeElement as HTMLElement | null
    const cell = ae && (ae.tagName === 'TD' || ae.tagName === 'TH') ? ae : null
    const n = this.blocks.length

    // ── 起步（第一次 Cmd+A）──
    if (this.selectCycle === 0) {
      this.selectStartedInCell = !!cell
      this.selectStartedInCode = false
      if (cell) {
        // 表格内：先选中本单元格内容
        const tb = this.blockFromNode(cell)
        this.selectAnchor = tb ? this.indexOf(tb) : 0
        const range = document.createRange()
        range.selectNodeContents(cell)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      } else {
        const active = this.activeBlock()
        this.selectAnchor = active ? this.indexOf(active) : 0
        // 仅「已闭合」的代码块才作为整体单位；未闭合时按普通文本走模块/全文层级，
        // 避免未闭合代码块把后文都算作代码而第二次就圈到文末。
        this.selectStartedInCode =
          this.blocks[this.selectAnchor]?.code != null && this.codeBlockClosed(this.selectAnchor)
        this.clearBlockSelection()
        this.selectBlockText(this.selectAnchor)
      }
      this.selectCycle = 1
      return
    }

    // ── 表格路径第二次：整块选中该表格 ──
    if (this.selectStartedInCell && this.selectCycle === 1) {
      this.applyBlockSelection(this.selectAnchor, this.selectAnchor)
      this.selectCycle = 2
      return
    }

    // ── 代码块路径第二次：整块选中该代码块（围栏到围栏，作为一个单位）──
    if (this.selectStartedInCode && this.selectCycle === 1) {
      const [from, to] = this.codeBlockRange(this.selectAnchor)
      if (to > from) {
        this.applyBlockSelection(from, to)
        this.selectCycle = 2
        return
      }
      // 单行代码块：落到模块/全文
    }

    // ── 模块（相邻非空块）：普通在第二次；表格/代码块在第三次 ──
    const moduleStep = this.selectStartedInCell || this.selectStartedInCode ? 2 : 1
    if (this.selectCycle === moduleStep) {
      const [from, to] = this.moduleRange(this.selectAnchor)
      if (to > from) {
        this.applyBlockSelection(from, to)
        this.selectCycle = moduleStep + 1
        return
      }
      // 模块只有一块 —— 落到全文
    }

    // ── 全文 ──
    if (n > 1) this.applyBlockSelection(0, n - 1)
    else this.selectBlockText(0)
    this.selectCycle = moduleStep + 1
  }

  /** 锚点所在代码块的整块区间（本块的 open 围栏 → close 围栏，止于本块边界） */
  private codeBlockRange(idx: number): [number, number] {
    let from = idx
    while (from > 0 && this.blocks[from].code?.role !== 'open' && this.blocks[from - 1].code) from--
    let to = idx
    while (
      to < this.blocks.length - 1 &&
      this.blocks[to].code?.role !== 'close' &&
      this.blocks[to + 1].code
    )
      to++
    return [from, to]
  }

  /** 锚点所在代码块是否已闭合（向前找到 open，再向后能遇到 close 围栏） */
  private codeBlockClosed(idx: number): boolean {
    let from = idx
    while (from > 0 && this.blocks[from].code?.role !== 'open' && this.blocks[from - 1].code) from--
    for (let i = from; i < this.blocks.length; i++) {
      const c = this.blocks[i].code
      if (!c) break
      if (c.role === 'close' && i > from) return true
    }
    return false
  }

  /** 锚点所在「模块」：以空行为界，向两侧扩展的连续非空块区间 */
  private moduleRange(idx: number): [number, number] {
    const nonEmpty = (i: number): boolean => this.blocks[i].raw.trim() !== ''
    if (!nonEmpty(idx)) return [idx, idx]
    let from = idx
    let to = idx
    while (from > 0 && nonEmpty(from - 1)) from--
    while (to < this.blocks.length - 1 && nonEmpty(to + 1)) to++
    return [from, to]
  }

  /** 块内原生全选（选中该行全部文本） */
  private selectBlockText(idx: number): void {
    const el = this.blocks[idx].el
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  /** 应用跨块选择：高亮 from..to，隐藏光标，保留锚点聚焦以接收键盘 */
  private applyBlockSelection(from: number, to: number): void {
    this.clearBlockSelection()
    this.blockSelection = { from, to }
    for (let i = from; i <= to; i++) this.blocks[i].el.classList.add('block-selected')
    this.root.classList.add('block-sel-mode')
    const anchorIdx = Math.min(Math.max(this.selectAnchor, from), to)
    const anchorEl = this.blocks[anchorIdx].el
    // 表格块本身 contenteditable=false，需临时可聚焦才能接收 Delete 等按键
    if (anchorEl.contentEditable !== 'true' && anchorEl.tabIndex < 0) anchorEl.tabIndex = -1
    anchorEl.focus()
    window.getSelection()?.removeAllRanges()
  }

  private clearBlockSelection(): void {
    if (this.blockSelection) {
      const { from, to } = this.blockSelection
      for (let i = from; i <= to; i++) this.blocks[i]?.el.classList.remove('block-selected')
    }
    this.blockSelection = null
    this.root.classList.remove('block-sel-mode')
  }

  private selectedMarkdown(): string {
    if (!this.blockSelection) return ''
    const { from, to } = this.blockSelection
    return this.blocks
      .slice(from, to + 1)
      .map((b) => b.raw)
      .join('\n')
  }

  /** 用一个新块替换当前跨块选择（删除 = 替换为空块） */
  private replaceBlockSelection(text: string): void {
    if (!this.blockSelection) return
    const { from, to } = this.blockSelection
    const next = this.blocks[to].el.nextElementSibling
    for (let i = from; i <= to; i++) this.blocks[i].el.remove()
    const nb = this.makeBlock(text)
    this.blocks.splice(from, to - from + 1, nb)
    this.root.insertBefore(nb.el, next)
    this.clearBlockSelection()
    nb.el.focus()
    this.placeCaret(nb, text.length)
    this.selectCycle = 0
    this.renumberLists()
    this.emitChange()
  }

  // ── 块的创建与渲染 ───────────────────────────────────────────────────────────
  private makeBlock(raw: string): Block {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    el.spellcheck = false
    const block: Block = { id: this.nextId++, raw, el, code: null, kind: 'line' }
    this.paint(block)
    return block
  }

  private appendBlock(raw: string): Block {
    const block = this.makeBlock(raw)
    this.root.appendChild(block.el)
    this.blocks.push(block)
    return block
  }

  /** 由 raw 重绘块的内容与类型样式（不动光标） */
  private paint(block: Block): void {
    if (block.kind === 'table') {
      this.paintTable(block)
      return
    }
    if (block.code) {
      this.paintCode(block)
      return
    }
    const r = renderBlock(block.raw)
    // 含公式且当前未聚焦的段落：渲染 KaTeX 预览（聚焦时回到源码以便编辑）
    if (r.type === 'p' && hasMath(block.raw) && document.activeElement !== block.el) {
      block.el.className = 'block math-line'
      block.el.style.paddingLeft = ''
      delete block.el.dataset.bullet
      block.el.innerHTML = renderMathPreview(block.raw)
      return
    }
    // 含图片且当前未聚焦的段落：渲染 <img> 预览（聚焦时回到源码以便编辑）
    if (r.type === 'p' && hasImage(block.raw) && document.activeElement !== block.el) {
      block.el.className = 'block img-line'
      block.el.style.paddingLeft = ''
      delete block.el.dataset.bullet
      block.el.innerHTML = renderImagePreview(block.raw, this.docDir())
      return
    }
    block.el.className = 'block ' + r.type + (r.checked ? ' checked' : '')
    block.el.style.paddingLeft = r.indent > 0 ? `${r.indent * 1.6}em` : ''
    // 无序列表项目符号按层级深浅在「圆点 / 方块」之间交替
    if (r.type === 'ul') block.el.dataset.bullet = r.indent % 2 === 0 ? 'disc' : 'square'
    else delete block.el.dataset.bullet
    block.el.innerHTML = r.html || '<br>'
  }

  private paintTable(block: Block): void {
    block.el.style.paddingLeft = ''
    delete block.el.dataset.bullet
    block.el.contentEditable = 'false' // 块本身不可编辑，编辑发生在各单元格
    block.el.className = 'block table-block'
    block.el.innerHTML = renderEditableTable(block.raw)
  }

  private paintCode(block: Block): void {
    const { role, lang } = block.code!
    block.el.style.paddingLeft = ''
    delete block.el.dataset.bullet
    if (lang === '__fm__') {
      block.el.className = `block fm-line fm-${role}`
      block.el.innerHTML = highlightCodeLine(block.raw, '')
      return
    }
    if (role === 'content') {
      block.el.className = 'block code-line'
      block.el.innerHTML = highlightCodeLine(block.raw, lang)
    } else {
      block.el.className = `block code-fence code-fence-${role}`
      block.el.innerHTML = renderFenceLine(block.raw)
    }
  }

  /** 文档级扫描：根据 ``` 围栏给每个块标注代码角色，返回角色发生变化的块 */
  private computeCodeContext(): Block[] {
    const changed: Block[] = []

    // Front matter：文档首行是 --- 且后面有闭合 ---，中间视为 YAML 元信息
    let fmEnd = -1
    if (this.blocks.length > 1 && this.blocks[0].raw.trim() === '---') {
      for (let k = 1; k < this.blocks.length; k++) {
        if (this.blocks[k].raw.trim() === '---') {
          fmEnd = k
          break
        }
      }
    }

    let inFence = false
    let lang = ''
    for (let idx = 0; idx < this.blocks.length; idx++) {
      const block = this.blocks[idx]
      let code: CodeInfo | null = null
      if (fmEnd >= 0 && idx <= fmEnd) {
        const role = idx === 0 ? 'open' : idx === fmEnd ? 'close' : 'content'
        code = { role, lang: '__fm__' }
      } else if (!inFence) {
        const m = matchFenceOpen(block.raw)
        if (m) {
          lang = m[1]
          code = { role: 'open', lang }
          inFence = true
        }
      } else if (isFenceClose(block.raw)) {
        code = { role: 'close', lang }
        inFence = false
      } else {
        code = { role: 'content', lang }
      }
      if (!sameCode(block.code, code)) {
        block.code = code
        changed.push(block)
      }
    }
    return changed
  }

  /** 重新计算代码上下文并重绘受影响的块（聚焦块保留光标） */
  private refreshCode(): void {
    const changed = this.computeCodeContext()
    if (changed.length === 0) return
    const active = document.activeElement
    for (const b of changed) {
      if (b.el === active) {
        const offset = getCaretOffset(b.el)
        this.paint(b)
        this.placeCaret(b, offset)
      } else {
        this.paint(b)
      }
    }
  }

  /** 把连续的表格行（表头 + 分隔行 + 若干体行）合并成一个表格多行块 */
  private detectAndMergeTables(): void {
    const active = document.activeElement
    for (let i = 0; i < this.blocks.length - 1; i++) {
      const head = this.blocks[i]
      const sep = this.blocks[i + 1]
      if (head.kind !== 'line' || head.code || sep.kind !== 'line' || sep.code) continue
      if (!isTableRow(head.raw) || !isSeparatorRow(sep.raw)) continue
      let j = i + 1
      while (j + 1 < this.blocks.length) {
        const nb = this.blocks[j + 1]
        if (nb.kind === 'line' && !nb.code && isTableRow(nb.raw)) j++
        else break
      }
      // 若光标正在该区间内（仍在编辑），先不合并
      let focusedInRun = false
      for (let k = i; k <= j; k++) if (this.blocks[k].el === active) focusedInRun = true
      if (focusedInRun) continue
      this.mergeTable(i, j)
    }
  }

  private mergeTable(from: number, to: number): void {
    const raw = this.blocks
      .slice(from, to + 1)
      .map((b) => b.raw)
      .join('\n')
    const next = this.blocks[to].el.nextElementSibling
    for (let k = from; k <= to; k++) this.blocks[k].el.remove()
    const tb = this.makeBlock(raw)
    tb.kind = 'table'
    this.paint(tb)
    this.blocks.splice(from, to - from + 1, tb)
    this.root.insertBefore(tb.el, next)
  }

  // ── 表格单元格编辑 ──────────────────────────────────────────────────────────
  private cellFromNode(
    node: Node | null
  ): { block: Block; cell: HTMLElement; r: number; c: number } | null {
    let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
    while (el && el !== this.root) {
      if (el.tagName === 'TD' || el.tagName === 'TH') {
        const block = this.blockFromNode(el)
        if (block && block.kind === 'table') {
          return { block, cell: el, r: Number(el.dataset.r), c: Number(el.dataset.c) }
        }
        return null
      }
      el = el.parentElement
    }
    return null
  }

  /** 读取 DOM 表格各单元格回写 block.raw（保留对齐） */
  private updateTableRaw(block: Block): void {
    const table = block.el.querySelector('table')
    if (!table) return
    const aligns = parseTable(block.raw).aligns
    const headers = Array.from(table.querySelectorAll('thead th')).map((c) => c.textContent ?? '')
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')
    )
    block.raw = buildTable({ headers, aligns, rows })
  }

  private tableRowCount(block: Block): number {
    return block.el.querySelectorAll('tbody tr').length
  }
  private tableColCount(block: Block): number {
    return block.el.querySelectorAll('thead th').length
  }

  /** 聚焦第 r 行（-1=表头）第 c 列单元格 */
  private focusCell(block: Block, r: number, c: number, atEnd = true): void {
    const sel =
      r < 0 ? `thead th[data-c="${c}"]` : `tbody tr:nth-child(${r + 1}) td[data-c="${c}"]`
    const cell = block.el.querySelector(sel) as HTMLElement | null
    if (!cell) return
    cell.focus()
    const range = document.createRange()
    range.selectNodeContents(cell)
    range.collapse(!atEnd)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(range)
  }

  private insertRowAt(block: Block, idx: number): void {
    const m = parseTable(block.raw)
    const at = Math.max(0, Math.min(idx, m.rows.length))
    m.rows.splice(at, 0, m.headers.map(() => ''))
    block.raw = buildTable(m)
    this.paint(block)
    this.focusCell(block, at, 0)
    this.emitChange()
  }

  private deleteRow(block: Block, r: number): void {
    if (r < 0) return // 表头不删
    const m = parseTable(block.raw)
    if (r >= m.rows.length) return
    m.rows.splice(r, 1)
    block.raw = buildTable(m)
    this.paint(block)
    this.focusCell(block, m.rows.length ? Math.min(r, m.rows.length - 1) : -1, 0)
    this.emitChange()
  }

  private insertColAt(block: Block, idx: number): void {
    const m = parseTable(block.raw)
    const at = Math.max(0, Math.min(idx, m.headers.length))
    m.headers.splice(at, 0, '')
    m.aligns.splice(at, 0, 'none')
    m.rows.forEach((row) => row.splice(at, 0, ''))
    block.raw = buildTable(m)
    this.paint(block)
    this.focusCell(block, -1, at)
    this.emitChange()
  }

  private deleteCol(block: Block, c: number): void {
    const m = parseTable(block.raw)
    if (m.headers.length <= 1) return // 至少保留一列
    m.headers.splice(c, 1)
    m.aligns.splice(c, 1)
    m.rows.forEach((row) => row.splice(c, 1))
    block.raw = buildTable(m)
    this.paint(block)
    this.focusCell(block, -1, Math.min(c, m.headers.length - 1))
    this.emitChange()
  }

  private addRow(block: Block, afterR: number): void {
    this.insertRowAt(block, afterR + 1)
  }
  private addColumn(block: Block, afterC: number): void {
    this.insertColAt(block, afterC + 1)
  }

  private onContextMenu = (e: MouseEvent): void => {
    const cell = this.cellFromNode(e.target as Node)
    if (!cell) return
    e.preventDefault()
    this.showTableMenu(e.clientX, e.clientY, cell.block, cell.r, cell.c)
  }

  private closeTableMenu(): void {
    this.tableMenu?.remove()
    this.tableMenu = null
  }

  /** 表格单元格右键菜单：任意方向插入行/列 + 删除行/列 */
  private showTableMenu(x: number, y: number, block: Block, r: number, c: number): void {
    this.closeTableMenu()
    const menu = document.createElement('div')
    menu.className = 'tbl-menu'

    const item = (label: string, fn: () => void): void => {
      const b = document.createElement('button')
      b.className = 'tbl-menu-item'
      b.textContent = label
      b.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        this.closeTableMenu()
        fn()
      })
      menu.appendChild(b)
    }
    const sep = (): void => {
      const s = document.createElement('div')
      s.className = 'tbl-menu-sep'
      menu.appendChild(s)
    }

    if (r >= 0) item('在上方插入行', () => this.insertRowAt(block, r))
    item('在下方插入行', () => this.insertRowAt(block, r + 1))
    if (r >= 0) item('删除此行', () => this.deleteRow(block, r))
    sep()
    item('在左侧插入列', () => this.insertColAt(block, c))
    item('在右侧插入列', () => this.insertColAt(block, c + 1))
    if (this.tableColCount(block) > 1) item('删除此列', () => this.deleteCol(block, c))

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    document.body.appendChild(menu)
    this.tableMenu = menu

    const dismiss = (ev: Event): void => {
      if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') return
      if (ev.type === 'mousedown' && menu.contains(ev.target as Node)) return
      this.closeTableMenu()
      document.removeEventListener('mousedown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
    }
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, true)
      document.addEventListener('keydown', dismiss, true)
    }, 0)
  }

  private focusPrevBlock(idx: number): void {
    const prev = this.blocks[idx - 1]
    if (!prev) return
    if (prev.kind === 'table') this.focusCell(prev, this.tableRowCount(prev) - 1, 0)
    else {
      prev.el.focus()
      this.placeCaret(prev, (prev.el.textContent ?? '').length)
    }
  }
  private focusNextBlock(idx: number): void {
    const next = this.blocks[idx + 1]
    if (!next) return
    if (next.kind === 'table') this.focusCell(next, -1, 0)
    else {
      next.el.focus()
      this.placeCaret(next, 0)
    }
  }

  /** 单元格内键盘：Tab 切单元格、Enter 下移、↑↓ 进出表格 */
  private handleTableKey(e: KeyboardEvent, cell: { block: Block; r: number; c: number }): void {
    const { block, r, c } = cell
    const cols = this.tableColCount(block)
    const rows = this.tableRowCount(block)
    const idx = this.indexOf(block)

    if (e.key === 'Tab') {
      e.preventDefault()
      this.updateTableRaw(block)
      if (e.shiftKey) {
        if (c > 0) this.focusCell(block, r, c - 1)
        else if (r > -1) this.focusCell(block, r - 1, cols - 1)
      } else if (c < cols - 1) {
        this.focusCell(block, r, c + 1)
      } else if (r < rows - 1) {
        this.focusCell(block, r + 1, 0)
      } else {
        this.addRow(block, r)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      this.updateTableRaw(block)
      if (r < rows - 1) this.focusCell(block, r + 1, c)
      else this.addRow(block, r)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (r > -1) this.focusCell(block, r - 1, c)
      else this.focusPrevBlock(idx)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (r < rows - 1) this.focusCell(block, r + 1, c)
      else this.focusNextBlock(idx)
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) {
        const a = this.closestCell(sel.anchorNode)
        const f = this.closestCell(sel.focusNode)
        if (a && f && a !== f) {
          // 选区跨多个单元格（如全选整张表）→ 清空所有单元格内容
          e.preventDefault()
          this.clearAllCells(block)
        }
        // 单格内选区：不拦截，交给浏览器删除（input 事件里回写 raw）
      }
      return
    }
  }

  private closestCell(node: Node | null): HTMLElement | null {
    let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
    while (el) {
      if (el.tagName === 'TD' || el.tagName === 'TH') return el
      el = el.parentElement
    }
    return null
  }

  /** 清空表格所有单元格内容（保留行列结构） */
  private clearAllCells(block: Block): void {
    const m = parseTable(block.raw)
    m.headers = m.headers.map(() => '')
    m.rows = m.rows.map((row) => row.map(() => ''))
    block.raw = buildTable(m)
    this.paint(block)
    this.focusCell(block, -1, 0)
    this.emitChange()
  }

  /** 在当前块后插入表格模板 + 一空行（菜单：插入表格） */
  insertTable(): void {
    const active = this.activeBlock()
    const tb = this.makeBlock(tableTemplate())
    tb.kind = 'table'
    const after = this.makeBlock('') // 表格后留一空行，便于继续写
    if (active) {
      const idx = this.indexOf(active)
      active.el.after(tb.el)
      tb.el.after(after.el)
      this.blocks.splice(idx + 1, 0, tb, after)
    } else {
      this.root.appendChild(tb.el)
      this.root.appendChild(after.el)
      this.blocks.push(tb, after)
    }
    this.paint(tb)
    this.focusCell(tb, -1, 0)
    this.emitChange()
  }

  /** 临时点亮块内所有 .md 标记符，使其可承载光标（避开 display:none 造成的落点漂移） */
  private revealBlockMarkers(block: Block): void {
    for (const el of this.revealed) el.classList.remove('reveal')
    this.revealed = []
    block.el.querySelectorAll('.md').forEach((el) => {
      el.classList.add('reveal')
      this.revealed.push(el as HTMLElement)
    })
  }

  /** 在块内安放光标：先让标记符可见（保证落点准确），再收敛到邻近显隐 */
  private placeCaret(block: Block, start: number, end: number = start): void {
    this.revealBlockMarkers(block)
    setCaretOffset(block.el, start, end)
    this.syncMarkers()
  }

  /** 输入后：以块内 DOM 文本为准更新 raw，重绘并恢复光标 */
  private reRender(block: Block): void {
    const offset = getCaretOffset(block.el)
    block.raw = block.el.textContent ?? ''
    const changed = this.computeCodeContext()
    this.paint(block)
    this.placeCaret(block, offset)
    for (const b of changed) if (b !== block) this.paint(b)
  }

  /** 重渲染单元格内的行内 markdown，保留光标（标记符先点亮再落光标，避免漂移） */
  private reRenderCell(cellEl: HTMLElement): void {
    const offset = getCaretOffset(cellEl)
    cellEl.innerHTML = renderInline(cellEl.textContent ?? '') || '<br>'
    for (const el of this.revealed) el.classList.remove('reveal')
    this.revealed = []
    cellEl.querySelectorAll('.md').forEach((el) => {
      el.classList.add('reveal')
      this.revealed.push(el as HTMLElement)
    })
    setCaretOffset(cellEl, offset)
    this.syncMarkers()
  }

  // ── 查找辅助 ────────────────────────────────────────────────────────────────
  private indexOf(block: Block): number {
    return this.blocks.indexOf(block)
  }

  private blockFromNode(node: Node | null): Block | null {
    let el: HTMLElement | null =
      node instanceof HTMLElement ? node : (node?.parentElement ?? null)
    while (el && el !== this.root) {
      if (el.classList.contains('block')) {
        return this.blocks.find((b) => b.el === el) ?? null
      }
      el = el.parentElement
    }
    return null
  }

  private activeBlock(): Block | null {
    return this.blockFromNode(document.activeElement)
  }

  private emitChange(): void {
    this.changeCb?.()
  }

  private onSelectionChange = (): void => {
    this.syncMarkers()
  }

  /** 根据当前光标位置，点亮其所在的 .md 包裹层（含各级祖先），熄灭其余 */
  private syncMarkers(): void {
    // 关键：先在「不改动任何 class」的前提下读出光标所在的 .md 祖先链。
    // 若先移除 reveal 再读 anchorNode，光标所在标记符会瞬时 display:none，
    // 读取选区触发的 layout 会把光标挪到可见处（如把 **123** 末尾的光标挪到 123 后），
    // 之后回车就会在错误的位置拆块。
    const next = new Set<HTMLElement>()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const node = sel.anchorNode
      if (node && this.root.contains(node)) {
        let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
        while (el && el !== this.root) {
          if (el.classList.contains('md')) next.add(el)
          el = el.parentElement
        }
      }
    }
    // 增量更新：只熄灭不再需要的、点亮新增的。光标所在的 .md 全程保持 reveal，不闪动。
    for (const el of this.revealed) {
      if (!next.has(el)) el.classList.remove('reveal')
    }
    for (const el of next) el.classList.add('reveal')
    this.revealed = [...next]
  }

  // ── 事件处理 ────────────────────────────────────────────────────────────────
  private onInput = (e: Event): void => {
    if (this.composing || this.blockSelection) return
    this.selectCycle = 0
    const cell = this.cellFromNode(e.target as Node)
    if (cell) {
      this.reRenderCell(cell.cell)
      this.updateTableRaw(cell.block)
      this.emitChange()
      return
    }
    const block = this.blockFromNode(e.target as Node)
    if (!block) return
    this.reRender(block)
    this.emitChange()
  }

  private onKeydown = (e: KeyboardEvent): void => {
    // 输入法合成期间不接管任何按键（回车确认候选、退格删拼音都交给 IME）
    if (this.composing || e.isComposing) return
    if (this.blockSelection) {
      this.handleBlockSelectionKey(e)
      return
    }

    const cell = this.cellFromNode(e.target as Node)
    if (cell) {
      this.handleTableKey(e, cell)
      return
    }

    const block = this.blockFromNode(e.target as Node)
    if (!block) return

    // 连按 Cmd+A 期间不重置层级：忽略 Cmd+A 本身与纯修饰键
    const isSelectAllKey = (e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')
    const isModifierOnly =
      e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt'
    if (!isSelectAllKey && !isModifierOnly) this.selectCycle = 0

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') this.desiredX = null

    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        this.handleEnter(block)
        break
      case 'Backspace':
        if (this.handleBackspace(block)) e.preventDefault()
        break
      case 'Delete':
        if (this.handleDelete(block)) e.preventDefault()
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) this.outdent(block)
        else this.indentOrTab(block)
        break
      case 'ArrowUp':
        if (this.handleArrowV(block, -1)) e.preventDefault()
        break
      case 'ArrowDown':
        if (this.handleArrowV(block, 1)) e.preventDefault()
        break
      case 'ArrowLeft':
        if (this.handleArrowH(block, -1)) e.preventDefault()
        break
      case 'ArrowRight':
        if (this.handleArrowH(block, 1)) e.preventDefault()
        break
    }
  }

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    // 表格增行 / 增列按钮
    if (target.classList.contains('tbl-add-row') || target.classList.contains('tbl-add-col')) {
      const block = this.blockFromNode(target)
      if (block) {
        if (target.classList.contains('tbl-add-row')) this.addRow(block, this.tableRowCount(block) - 1)
        else this.addColumn(block, this.tableColCount(block) - 1)
      }
      return
    }
    if (this.blockSelection) this.clearBlockSelection()
    this.selectCycle = 0
    // 编辑态下点击链接不跳转，只用于定位光标
    if (target.closest('a')) e.preventDefault()
    // 点击编辑区空白处：在首块上方点 → 聚焦首块开头；否则 → 聚焦末块结尾
    if (target === this.root) {
      const first = this.blocks[0]
      const last = this.blocks[this.blocks.length - 1]
      if (!first || !last) return
      const aboveFirst = e.clientY < first.el.getBoundingClientRect().top
      const block = aboveFirst ? first : last
      if (block.kind === 'table') {
        this.focusCell(block, aboveFirst ? -1 : this.tableRowCount(block) - 1, 0)
      } else {
        block.el.focus()
        this.placeCaret(block, aboveFirst ? 0 : block.raw.length)
      }
    }
  }

  private onFocusToggle = (e: FocusEvent): void => {
    const block = this.blockFromNode(e.target as Node)
    if (!block) return
    if (block.kind === 'table') return // 表格始终渲染态，编辑发生在单元格内
    if (!block.code && (hasMath(block.raw) || hasImage(block.raw))) {
      this.paint(block)
      // 刚聚焦（显源码）时把光标放到行尾，因为渲染态（KaTeX / 图片）无法映射点击位置
      if (document.activeElement === block.el) this.placeCaret(block, block.raw.length)
      return
    }
    // 普通行失焦：等焦点落定后，尝试把刚输完的连续表格行合并成表格块
    if (e.type === 'focusout') queueMicrotask(() => this.detectAndMergeTables())
  }

  private onPaste = (e: ClipboardEvent): void => {
    // 跨块选择下：粘贴内容替换整个选区
    if (this.blockSelection) {
      e.preventDefault()
      const parts = (e.clipboardData?.getData('text/plain') ?? '').split('\n')
      const { from, to } = this.blockSelection
      const next = this.blocks[to].el.nextElementSibling
      for (let i = from; i <= to; i++) this.blocks[i].el.remove()
      const made = parts.map((p) => this.makeBlock(p))
      this.blocks.splice(from, to - from + 1, ...made)
      for (const b of made) this.root.insertBefore(b.el, next)
      this.clearBlockSelection()
      const last = made[made.length - 1]
      last.el.focus()
      this.placeCaret(last, last.raw.length)
      this.selectCycle = 0
      this.renumberLists()
      this.emitChange()
      return
    }

    // 图片粘贴（截图等）：剪贴板里有图片项时优先处理
    const imgFiles = this.imageFilesFrom(e.clipboardData)
    if (imgFiles.length) {
      e.preventDefault()
      void this.insertImageFiles(imgFiles)
      return
    }

    const block = this.blockFromNode(e.target as Node)
    if (!block) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text) return
    const parts = text.split('\n')
    const offset = getCaretOffset(block.el)
    const raw = block.el.textContent ?? ''
    const head = raw.slice(0, offset)
    const tail = raw.slice(offset)

    if (parts.length === 1) {
      block.raw = head + parts[0] + tail
      this.paint(block)
      this.placeCaret(block, offset + parts[0].length)
    } else {
      block.raw = head + parts[0]
      this.paint(block)
      let idx = this.indexOf(block)
      let anchor = block
      for (let k = 1; k < parts.length; k++) {
        const isLast = k === parts.length - 1
        const nb = this.makeBlock(isLast ? parts[k] + tail : parts[k])
        anchor.el.after(nb.el)
        this.blocks.splice(idx + 1, 0, nb)
        idx++
        anchor = nb
        if (isLast) {
          nb.el.focus()
          this.placeCaret(nb, parts[k].length)
        }
      }
    }
    this.renumberLists()
    this.emitChange()
  }

  // ── 图片：粘贴 / 拖拽 → 存盘 → 插入 ─────────────────────────────────────────
  /** 从剪贴板/拖拽数据里取出图片文件 */
  private imageFilesFrom(data: DataTransfer | null): File[] {
    if (!data) return []
    const out: File[] = []
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
    return out
  }

  private onDragOver = (e: DragEvent): void => {
    // 含文件时允许放下（否则浏览器默认会用文件导航替换页面）
    if (e.dataTransfer && Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
      e.preventDefault()
    }
  }

  private onDrop = (e: DragEvent): void => {
    const files = this.imageFilesFrom(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    // 把光标落到放下处所在的块，图片就插在那里
    const block = this.blockFromNode(e.target as Node)
    if (block && block.kind === 'line') {
      block.el.focus()
    }
    void this.insertImageFiles(files)
  }

  /** 存盘每张图片，得到可嵌入的路径后插入为图片块 */
  private async insertImageFiles(files: File[]): Promise<void> {
    const target = this.activeBlockOrLast()
    const embeds: string[] = []
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const ext = extFromMime(f.type)
        const embed = await window.api.saveImage(bytes, ext, this.docPath)
        if (embed) embeds.push(embed)
      } catch (err) {
        console.error('save image failed:', err)
      }
    }
    if (embeds.length) this.insertImageBlocks(target, embeds)
  }

  private activeBlockOrLast(): Block {
    const active = document.activeElement
    const b = active ? this.blockFromNode(active) : null
    return b ?? this.blocks[this.blocks.length - 1]
  }

  /** 在 anchor 块后插入若干图片块，并在末尾补空块落焦（使图片块失焦渲染） */
  private insertImageBlocks(anchorBlock: Block, embeds: string[]): void {
    const made: Block[] = []
    let anchor = anchorBlock
    let idx = this.indexOf(anchorBlock)
    const list = embeds.slice()
    // 当前块为空行时，第一张图直接占用它，避免多出空行
    if (anchorBlock.kind === 'line' && anchorBlock.raw.trim() === '') {
      anchorBlock.raw = `![](${list.shift()})`
      made.push(anchorBlock)
    }
    for (const p of list) {
      const nb = this.makeBlock(`![](${p})`)
      anchor.el.after(nb.el)
      this.blocks.splice(idx + 1, 0, nb)
      idx++
      anchor = nb
      made.push(nb)
    }
    // 末尾补一个空块并落焦：图片块此刻失焦 → 重绘为预览
    const tail = this.makeBlock('')
    anchor.el.after(tail.el)
    this.blocks.splice(idx + 1, 0, tail)
    tail.el.focus()
    this.placeCaret(tail, 0)
    for (const b of made) this.paint(b)
    this.emitChange()
  }

  // ── 查找替换（Cmd+F） ───────────────────────────────────────────────────────
  /** 打开查找浮层（已开则聚焦并选中输入框内容） */
  openFind(): void {
    if (!this.findBar) this.findBar = this.buildFindBar()
    const bar = this.findBar
    bar.root.style.display = 'block'
    // 若编辑器里有选中文本，拿来作为初始查找词（飞书/Typora 行为）
    const sel = window.getSelection()
    const selText = sel && !sel.isCollapsed ? sel.toString() : ''
    if (selText && !selText.includes('\n')) bar.input.value = selText
    this.runSearch(bar.input.value)
    if (this.findMatches.length) this.goToMatch(0)
    this.updateFindUI()
    bar.input.focus()
    bar.input.select()
    // 浮层打开期间，编辑器滚动时重定位高亮框
    if (!this.onDocScroll) {
      // 滚动容器是祖先 #app，故监听 window 捕获阶段才能接住任意元素的滚动
      this.onDocScroll = () => this.positionHighlight()
      window.addEventListener('scroll', this.onDocScroll, true)
    }
  }

  closeFind(): void {
    if (this.findBar) this.findBar.root.style.display = 'none'
    this.clearHighlight()
    this.findMatches = []
    if (this.onDocScroll) {
      window.removeEventListener('scroll', this.onDocScroll, true)
      this.onDocScroll = null
    }
    this.focus()
  }

  /** 用当前查找词重新计算命中列表（不移动视图） */
  private runSearch(query: string): void {
    const matches: FindMatch[] = []
    if (query) {
      const q = this.findCaseSensitive ? query : query.toLowerCase()
      this.blocks.forEach((b, bi) => {
        const hay = this.findCaseSensitive ? b.raw : b.raw.toLowerCase()
        let from = 0
        for (;;) {
          const idx = hay.indexOf(q, from)
          if (idx < 0) break
          matches.push({ blockIdx: bi, start: idx, end: idx + query.length })
          from = idx + query.length
        }
      })
    }
    this.findMatches = matches
    if (this.findCurrent >= matches.length) this.findCurrent = matches.length ? matches.length - 1 : 0
  }

  /** 滚动到第 idx 个命中并高亮（不抢输入框焦点，保证连续回车跳转） */
  private goToMatch(idx: number): void {
    const m = this.findMatches[idx]
    if (!m) return this.clearHighlight()
    this.findCurrent = idx
    const block = this.blocks[m.blockIdx]
    block.el.scrollIntoView({ block: 'center', inline: 'nearest' })
    this.positionHighlight()
  }

  private findStep(dir: 1 | -1): void {
    if (!this.findMatches.length) return
    const n = this.findMatches.length
    this.goToMatch((this.findCurrent + dir + n) % n)
    this.updateFindUI()
  }

  /** 把高亮框定位到当前命中处（line 块才有可映射的文本区间） */
  private positionHighlight(): void {
    const m = this.findMatches[this.findCurrent]
    const block = m ? this.blocks[m.blockIdx] : null
    if (!m || !block || block.kind !== 'line') return this.clearHighlight()
    let rect: DOMRect
    try {
      rect = rangeForOffsets(block.el, m.start, m.end).getBoundingClientRect()
    } catch {
      return this.clearHighlight()
    }
    if (!rect.width && !rect.height) return this.clearHighlight()
    // 命中滚出编辑可视区时隐藏高亮框，避免漂在空白处或盖住标签栏
    const scroller = document.getElementById('app')
    if (scroller) {
      const band = scroller.getBoundingClientRect()
      if (rect.bottom <= band.top || rect.top >= band.bottom) return this.clearHighlight()
    }
    if (!this.findHl) {
      this.findHl = document.createElement('div')
      this.findHl.className = 'find-hl'
      document.body.appendChild(this.findHl)
    }
    const hl = this.findHl
    hl.style.display = 'block'
    hl.style.left = `${rect.left}px`
    hl.style.top = `${rect.top}px`
    hl.style.width = `${rect.width}px`
    hl.style.height = `${rect.height}px`
  }

  private clearHighlight(): void {
    if (this.findHl) this.findHl.style.display = 'none'
  }

  private updateFindUI(msg?: string): void {
    if (!this.findBar) return
    const n = this.findMatches.length
    this.findBar.count.textContent = msg ?? (n ? `${this.findCurrent + 1}/${n}` : '无结果')
  }

  /** 替换当前命中，并跳到下一处 */
  private replaceCurrent(repl: string): void {
    const m = this.findMatches[this.findCurrent]
    if (!m) return
    const block = this.blocks[m.blockIdx]
    if (block.kind !== 'line') return this.findStep(1) // 表格块暂不就地替换，跳过
    block.raw = block.raw.slice(0, m.start) + repl + block.raw.slice(m.end)
    this.refreshAfterEdit(block)
    const query = this.findBar?.input.value ?? ''
    this.runSearch(query)
    if (this.findMatches.length) {
      if (this.findCurrent >= this.findMatches.length) this.findCurrent = 0
      this.goToMatch(this.findCurrent)
    } else {
      this.clearHighlight()
    }
    this.updateFindUI()
  }

  /** 全部替换 */
  private replaceAll(repl: string): void {
    const query = this.findBar?.input.value ?? ''
    if (!query) return
    let count = 0
    const cs = this.findCaseSensitive
    const edited: Block[] = []
    for (const block of this.blocks) {
      const hay = cs ? block.raw : block.raw.toLowerCase()
      const needle = cs ? query : query.toLowerCase()
      if (hay.indexOf(needle) < 0) continue
      // 大小写敏感时直接 split-join；不敏感时按命中位置逐段重建
      let out = ''
      let from = 0
      for (;;) {
        const idx = hay.indexOf(needle, from)
        if (idx < 0) {
          out += block.raw.slice(from)
          break
        }
        out += block.raw.slice(from, idx) + repl
        from = idx + query.length
        count++
      }
      block.raw = out
      edited.push(block)
    }
    if (count) {
      // computeCodeContext 只返回「代码角色变化」的块；被替换文本的块还得自己重绘，
      // 两者合并去重后逐块重绘（否则模型已更新但 DOM 不刷新 → 看着像没替换）。
      const codeChanged = this.computeCodeContext()
      for (const b of new Set([...edited, ...codeChanged])) this.paint(b)
      this.detectAndMergeTables()
      this.emitChange()
    }
    this.runSearch(query)
    this.clearHighlight()
    this.updateFindUI(`${count} 处已替换`)
  }

  /** 就地编辑某块后刷新它（含代码上下文连带重绘） */
  private refreshAfterEdit(block: Block): void {
    const changed = this.computeCodeContext()
    this.paint(block)
    for (const b of changed) if (b !== block) this.paint(b)
    this.emitChange()
  }

  private buildFindBar(): FindBar {
    const el = (tag: string, cls: string): HTMLElement => {
      const e = document.createElement(tag)
      e.className = cls
      return e
    }
    const root = el('div', 'find-bar')
    root.style.display = 'none'

    const findRow = el('div', 'find-row')
    const toggle = el('button', 'find-toggle') as HTMLButtonElement
    toggle.textContent = '⌄'
    toggle.title = '展开替换'
    const input = document.createElement('input')
    input.className = 'find-input'
    input.placeholder = '查找'
    const count = el('span', 'find-count')
    count.textContent = '0/0'
    const prev = el('button', 'find-btn') as HTMLButtonElement
    prev.textContent = '↑'
    prev.title = '上一个'
    const next = el('button', 'find-btn') as HTMLButtonElement
    next.textContent = '↓'
    next.title = '下一个'
    const caseBtn = el('button', 'find-btn find-case') as HTMLButtonElement
    caseBtn.textContent = 'Aa'
    caseBtn.title = '区分大小写'
    const close = el('button', 'find-btn') as HTMLButtonElement
    close.textContent = '✕'
    close.title = '关闭 (Esc)'
    findRow.append(toggle, input, count, prev, next, caseBtn, close)

    const replaceRow = el('div', 'replace-row')
    replaceRow.hidden = true
    const replaceInput = document.createElement('input')
    replaceInput.className = 'find-input'
    replaceInput.placeholder = '替换为'
    const replaceOne = el('button', 'find-text-btn') as HTMLButtonElement
    replaceOne.textContent = '替换'
    const replaceAll = el('button', 'find-text-btn') as HTMLButtonElement
    replaceAll.textContent = '全部'
    replaceRow.append(replaceInput, replaceOne, replaceAll)

    root.append(findRow, replaceRow)
    document.body.appendChild(root)

    const bar: FindBar = { root, input, count, replaceRow, replaceInput, caseBtn }

    // —— 事件 ——
    input.addEventListener('input', () => {
      this.findCurrent = 0
      this.runSearch(input.value)
      if (this.findMatches.length) this.goToMatch(0)
      else this.clearHighlight()
      this.updateFindUI()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.findStep(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.closeFind()
      }
    })
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.replaceCurrent(replaceInput.value)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.closeFind()
      }
    })
    prev.addEventListener('click', () => this.findStep(-1))
    next.addEventListener('click', () => this.findStep(1))
    close.addEventListener('click', () => this.closeFind())
    caseBtn.addEventListener('click', () => {
      this.findCaseSensitive = !this.findCaseSensitive
      caseBtn.classList.toggle('active', this.findCaseSensitive)
      this.findCurrent = 0
      this.runSearch(input.value)
      if (this.findMatches.length) this.goToMatch(0)
      else this.clearHighlight()
      this.updateFindUI()
    })
    toggle.addEventListener('click', () => {
      replaceRow.hidden = !replaceRow.hidden
      toggle.textContent = replaceRow.hidden ? '⌄' : '⌃'
      if (!replaceRow.hidden) replaceInput.focus()
    })
    replaceOne.addEventListener('click', () => this.replaceCurrent(replaceInput.value))
    replaceAll.addEventListener('click', () => this.replaceAll(replaceInput.value))

    return bar
  }

  /** 复制：跨块选择时写入选区 markdown；否则复制块内原生选区 */
  copy(): void {
    if (this.blockSelection) {
      window.api.writeClipboard(this.selectedMarkdown())
    } else {
      document.execCommand('copy')
    }
  }

  /** 剪切：跨块选择时写入并删除；否则剪切块内原生选区 */
  cut(): void {
    if (this.blockSelection) {
      window.api.writeClipboard(this.selectedMarkdown())
      this.replaceBlockSelection('')
    } else {
      document.execCommand('cut')
    }
  }

  /** 跨块选择激活时的键盘处理 */
  private handleBlockSelectionKey(e: KeyboardEvent): void {
    // Cmd+C/X 交给 copy/cut 事件，Cmd+A 由菜单 action 处理
    if ((e.metaKey || e.ctrlKey) && /^[cxaA]$/.test(e.key)) return
    if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt') return

    const sel = this.blockSelection!

    if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const b = this.blocks[sel.from]
      this.clearBlockSelection()
      b.el.focus()
      this.placeCaret(b, 0)
      this.selectCycle = 0
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      const b = this.blocks[sel.to]
      this.clearBlockSelection()
      b.el.focus()
      this.placeCaret(b, b.raw.length)
      this.selectCycle = 0
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      this.replaceBlockSelection('')
      return
    }
    // 可打印字符：替换选区为该字符
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      this.replaceBlockSelection(e.key)
      return
    }
    // 其余按键：吞掉，保持选区
    e.preventDefault()
  }

  // ── 结构操作 ────────────────────────────────────────────────────────────────
  private insertText(block: Block, str: string): void {
    const offset = getCaretOffset(block.el)
    const raw = block.el.textContent ?? ''
    block.raw = raw.slice(0, offset) + str + raw.slice(offset)
    this.paint(block)
    this.placeCaret(block, offset + str.length)
    this.emitChange()
  }

  /** Tab：列表项整体缩进一级；普通块则在光标处插入两个空格 */
  private indentOrTab(block: Block): void {
    if (block.code) {
      this.insertText(block, '  ')
      return
    }
    const raw = block.el.textContent ?? ''
    if (listInfo(raw)) {
      const offset = getCaretOffset(block.el)
      block.raw = '  ' + raw
      this.paint(block)
      this.placeCaret(block, offset + 2)
      this.renumberLists()
      this.emitChange()
    } else {
      this.insertText(block, '  ')
    }
  }

  /** Shift+Tab：列表项回退一级缩进 */
  private outdent(block: Block): void {
    const raw = block.el.textContent ?? ''
    const li = listInfo(raw)
    if (!li || li.indent.length === 0) return
    const remove = Math.min(2, li.indent.length)
    const offset = getCaretOffset(block.el)
    block.raw = raw.slice(remove)
    this.paint(block)
    this.placeCaret(block, Math.max(0, offset - remove))
    this.renumberLists()
    this.emitChange()
  }

  /**
   * 重排有序列表序号：每个缩进层级独立从 1 计数，遇更浅层级时清掉更深层级的计数；
   * 非列表块（含空行）重置全部计数（视作列表结束）。无序/任务项会重置本层 ol 计数。
   */
  private renumberLists(): void {
    const counters: number[] = []
    for (const block of this.blocks) {
      const li = listInfo(block.raw)
      if (!li) {
        counters.length = 0
        continue
      }
      const level = Math.round(li.indent.replace(/\t/g, '  ').length / 2)
      counters.length = level + 1 // 清掉更深层级的计数
      if (li.kind === 'ol') {
        counters[level] = (counters[level] || 0) + 1
        const body = li.marker.slice(li.indent.length) // "2. " / "2) "
        const sep = body.includes(')') ? ')' : '.'
        const desired = `${li.indent}${counters[level]}${sep} `
        if (block.raw.slice(0, li.marker.length) !== desired) {
          const delta = desired.length - li.marker.length
          block.raw = desired + block.raw.slice(li.marker.length)
          this.repaintRenumbered(block, delta)
        }
      } else {
        counters[level] = 0 // 无序/任务项打断本层有序计数
      }
    }
    this.refreshCode()
  }

  /** 重排导致某块序号变化后的重绘；若是聚焦块，按标记符长度变化修正光标 */
  private repaintRenumbered(block: Block, caretDelta: number): void {
    if (document.activeElement === block.el) {
      const offset = getCaretOffset(block.el)
      this.paint(block)
      this.placeCaret(block, Math.max(0, offset + caretDelta))
    } else {
      this.paint(block)
    }
  }

  private handleEnter(block: Block): void {
    const offset = getCaretOffset(block.el)
    const raw = block.el.textContent ?? ''
    const before = raw.slice(0, offset)
    const after = raw.slice(offset)

    if (block.kind === 'table') {
      // 表格源码内回车 = 插入新行（多行块）
      this.insertText(block, '\n')
      return
    }
    if (block.code) {
      this.handleEnterInCode(block, before, after)
      return
    }

    const li = listInfo(before)
    // 在「空列表项」上回车：嵌套则回退一级缩进，顶层则退出列表
    if (li && before.length === li.marker.length && !after) {
      if (li.indent.length > 0) {
        block.raw =
          li.indent.slice(0, Math.max(0, li.indent.length - 2)) + li.marker.slice(li.indent.length)
        this.paint(block)
        this.placeCaret(block, block.raw.length)
      } else {
        block.raw = ''
        this.paint(block)
        this.placeCaret(block, 0)
      }
      this.renumberLists()
      this.emitChange()
      return
    }

    block.raw = before
    this.paint(block)

    // 续列表：新块带上递增后的标记
    let newRaw = after
    let caret = 0
    if (li) {
      const marker = nextListMarker(li)
      newRaw = marker + after
      caret = marker.length
    }

    const idx = this.indexOf(block)
    const nb = this.makeBlock(newRaw)
    block.el.after(nb.el)
    this.blocks.splice(idx + 1, 0, nb)
    nb.el.focus()
    this.placeCaret(nb, caret)
    this.renumberLists()
    this.emitChange()
  }

  /** 代码块内回车：起始行末尾自动补闭合围栏，其余为普通换行 */
  private handleEnterInCode(block: Block, before: string, after: string): void {
    const idx = this.indexOf(block)

    if (block.code!.role === 'open' && after === '' && !this.codeBlockClosed(idx)) {
      // 刚敲完 ```lang（尚无闭合围栏）后回车：补「空内容行 + 闭合 ```」，光标落在中间。
      // 已有闭合围栏时不再补，否则会多出一个 ``` 把代码块劈开。
      block.raw = before
      const content = this.makeBlock('')
      const close = this.makeBlock('```')
      block.el.after(content.el)
      content.el.after(close.el)
      this.blocks.splice(idx + 1, 0, content, close)
      for (const b of this.computeCodeContext()) this.paint(b)
      content.el.focus()
      this.placeCaret(content, 0)
      this.emitChange()
      return
    }

    // 代码块内普通换行
    block.raw = before
    const nb = this.makeBlock(after)
    block.el.after(nb.el)
    this.blocks.splice(idx + 1, 0, nb)
    const changed = this.computeCodeContext()
    this.paint(block)
    for (const b of changed) if (b !== block) this.paint(b)
    nb.el.focus()
    this.placeCaret(nb, 0)
    this.emitChange()
  }

  private handleBackspace(block: Block): boolean {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return false
    const offset = getCaretOffset(block.el)
    if (offset > 0) return false // 普通删字，交给浏览器，input 里重渲染

    const idx = this.indexOf(block)
    // 文档首块：若有块前缀，先降级为段落（标题/列表 -> 普通段落）
    if (idx === 0) {
      const len = prefixLen(block.raw)
      if (len > 0) {
        block.raw = block.raw.slice(len)
        this.paint(block)
        this.placeCaret(block, 0)
        this.renumberLists()
        this.emitChange()
      }
      return true
    }

    // 与上一块合并
    const prev = this.blocks[idx - 1]
    const caretPos = (prev.el.textContent ?? '').length
    prev.raw = (prev.el.textContent ?? '') + (block.el.textContent ?? '')
    this.paint(prev)
    block.el.remove()
    this.blocks.splice(idx, 1)
    prev.el.focus()
    this.placeCaret(prev, caretPos)
    this.renumberLists()
    this.emitChange()
    return true
  }

  private handleDelete(block: Block): boolean {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return false
    const offset = getCaretOffset(block.el)
    const raw = block.el.textContent ?? ''
    if (offset < raw.length) return false // 普通删字

    const idx = this.indexOf(block)
    if (idx >= this.blocks.length - 1) return true // 末块，无事可做
    const next = this.blocks[idx + 1]
    const caretPos = raw.length
    block.raw = raw + (next.el.textContent ?? '')
    this.paint(block)
    next.el.remove()
    this.blocks.splice(idx + 1, 1)
    block.el.focus()
    this.placeCaret(block, caretPos)
    this.renumberLists()
    this.emitChange()
    return true
  }

  private handleArrowH(block: Block, dir: -1 | 1): boolean {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return false
    const offset = getCaretOffset(block.el)
    const len = (block.el.textContent ?? '').length
    const idx = this.indexOf(block)

    if (dir < 0 && offset === 0) {
      const prev = this.blocks[idx - 1]
      if (!prev) return false
      if (prev.kind === 'table') {
        this.focusCell(prev, this.tableRowCount(prev) - 1, this.tableColCount(prev) - 1)
        return true
      }
      prev.el.focus()
      this.placeCaret(prev, (prev.el.textContent ?? '').length)
      return true
    }
    if (dir > 0 && offset === len) {
      const next = this.blocks[idx + 1]
      if (!next) return false
      if (next.kind === 'table') {
        this.focusCell(next, -1, 0)
        return true
      }
      next.el.focus()
      this.placeCaret(next, 0)
      return true
    }
    return false
  }

  private handleArrowV(block: Block, dir: -1 | 1): boolean {
    const box = block.el.getBoundingClientRect()
    const caret = caretClientRect()
    // 空行（仅 <br>）取不到光标矩形：用块自身几何兜底，视为既在首行也在末行
    const caretTop = caret ? caret.top : box.top
    const caretBottom = caret ? caret.bottom : box.bottom
    const caretLeft = caret ? caret.left : box.left
    const lineH = this.lineHeightOf(block.el)
    const onFirst = caretTop - box.top < lineH * 0.75
    const onLast = box.bottom - caretBottom < lineH * 0.75

    if (dir < 0 && !onFirst) return false
    if (dir > 0 && !onLast) return false

    const idx = this.indexOf(block)
    const target = this.blocks[idx + dir]
    if (!target) return false

    if (target.kind === 'table') {
      if (dir < 0) this.focusCell(target, this.tableRowCount(target) - 1, 0)
      else this.focusCell(target, -1, 0)
      return true
    }

    if (this.desiredX == null) this.desiredX = caretLeft
    target.el.focus()
    // 用目标块自身的行高定位 —— 上一行若是标题/粗体等，几何与当前行不同
    const tBox = target.el.getBoundingClientRect()
    const tLineH = this.lineHeightOf(target.el)
    const y = dir < 0 ? tBox.bottom - tLineH / 2 : tBox.top + tLineH / 2
    placeCaretAtPoint(this.desiredX, y, target.el, dir < 0)
    this.syncMarkers()
    return true
  }

  /** 元素有效行高（line-height 为 normal 时按 font-size 估算，标题常见） */
  private lineHeightOf(el: HTMLElement): number {
    const s = getComputedStyle(el)
    const lh = parseFloat(s.lineHeight)
    if (!isNaN(lh)) return lh
    const fs = parseFloat(s.fontSize)
    return isNaN(fs) ? 18 : fs * 1.4
  }
}

/** 续列表时计算下一项标记（ol 序号 +1，task 重置为未勾选） */
function nextListMarker(li: ReturnType<typeof listInfo>): string {
  if (!li) return ''
  if (li.kind === 'ol') {
    const body = li.marker.slice(li.indent.length) // "1. "
    const sep = body.includes(')') ? ')' : '.'
    return li.indent + `${(li.num ?? 1) + 1}${sep} `
  }
  if (li.kind === 'task') {
    const bullet = li.marker[li.indent.length] // 缩进之后的项目符号
    return li.indent + `${bullet} [ ] `
  }
  return li.marker // ul：完整 marker（含缩进）
}
