// ────────────────────────────────────────────────────────────────────────────
// 光标工具：以「块内字符偏移」为锚点保存/恢复光标。
// 因为 DOM 文本（含标记符）=== 原始 markdown，偏移量在重渲染前后保持一致。
// ────────────────────────────────────────────────────────────────────────────

/** 当前光标在 el 内的字符偏移（落在 el 之外则返回 0） */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

/** 当前选区在 el 内的起止字符偏移 */
export function selectionOffsets(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 }
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return { start: 0, end: 0 }
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  return { start, end: start + range.toString().length }
}

/** 构造覆盖 el 内 [start,end) 字符区间的 Range（不改动当前选区/焦点） */
export function rangeForOffsets(el: HTMLElement, start: number, end: number = start): Range {
  const a = locate(el, start)
  const b = end === start ? a : locate(el, end)
  const range = document.createRange()
  range.setStart(a.node, a.off)
  range.setEnd(b.node, b.off)
  return range
}

/** 把光标（或选区）设置到 el 内的字符偏移区间 */
export function setCaretOffset(el: HTMLElement, start: number, end: number = start): void {
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(rangeForOffsets(el, start, end))
}

function locate(el: HTMLElement, offset: number): { node: Node; off: number } {
  let remaining = offset
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.nodeValue?.length ?? 0
    if (remaining <= len) return { node, off: remaining }
    remaining -= len
    last = node
    node = walker.nextNode() as Text | null
  }
  if (last) return { node: last, off: last.nodeValue?.length ?? 0 }
  return { node: el, off: 0 }
}

/** 折叠光标的屏幕矩形（用于判断是否在首/末视觉行、记忆列位置） */
export function caretClientRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const rects = range.getClientRects()
  if (rects.length) return rects[0]
  const r = range.getBoundingClientRect()
  return r.width || r.height || r.top || r.left ? r : null
}

interface CaretPos {
  offsetNode: Node
  offset: number
}

/**
 * 在屏幕坐标 (x,y) 处放置光标，限制在 el 内。
 * x 会被夹到 el 的水平范围内；若取点失败，退到 el 的垂直中心再试；
 * 仍失败则贴到 el 的末尾（preferEnd，向上移时用）或开头（向下移时用）。
 */
export function placeCaretAtPoint(x: number, y: number, el: HTMLElement, preferEnd = false): void {
  const sel = window.getSelection()
  if (!sel) return
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => CaretPos | null
  }

  const pointToRange = (px: number, py: number): Range | null => {
    let r: Range | null = null
    if (doc.caretRangeFromPoint) {
      r = doc.caretRangeFromPoint(px, py)
    } else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(px, py)
      if (pos) {
        r = document.createRange()
        r.setStart(pos.offsetNode, pos.offset)
      }
    }
    return r && el.contains(r.startContainer) ? r : null
  }

  const box = el.getBoundingClientRect()
  // x 夹到目标块的水平范围内（上一行更短/更长都能落在其文本上）
  const clampedX = Math.max(box.left + 1, Math.min(x, box.right - 1))
  // 先按期望 y 取点；不中则退到目标块垂直中心（对单行块最稳）
  const range = pointToRange(clampedX, y) || pointToRange(clampedX, box.top + box.height / 2)

  if (range) {
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    return
  }

  // 仍失败：贴到目标块末尾（向上）或开头（向下）
  const fallback = document.createRange()
  fallback.selectNodeContents(el)
  fallback.collapse(!preferEnd)
  sel.removeAllRanges()
  sel.addRange(fallback)
}
