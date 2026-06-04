// ────────────────────────────────────────────────────────────────────────────
// 行内渲染器：把一行 markdown 文本转成 HTML，标记符（**、*、`、[]() 等）保留为
// 真实文本节点（包在 <span class="mk"> 里），由 CSS 控制聚焦时显隐。
//
// 关键不变式： textContent(renderInline(raw)) === raw
//   —— 标记符是真实文本，转义只用 HTML 实体（textContent 会解码还原）。
//   这条不变式让「DOM 文本 == 原始 markdown」，光标偏移与模型同步都变得平凡。
// ────────────────────────────────────────────────────────────────────────────

const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

export function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESCAPE[c])
}

function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '"' ? '&quot;' : HTML_ESCAPE[c]))
}

/** 标记符 span —— 内容必须原样保留（仅做 HTML 转义） */
export function mk(s: string): string {
  return `<span class="mk">${escHtml(s)}</span>`
}

/** 行内构造的包裹层：让标记符可按「光标是否落在其中」来显隐（Typora 式邻近显隐） */
function wrapMd(inner: string): string {
  return `<span class="md">${inner}</span>`
}

/** 找到下一个「单个」定界符（左右都不是同一字符，避免吃掉 ** 这种双写） */
function findSingle(text: string, from: number, ch: string): number {
  for (let k = from; k < text.length; k++) {
    if (text[k] === ch && text[k - 1] !== ch && text[k + 1] !== ch) return k
  }
  return -1
}

export function renderInline(text: string): string {
  let out = ''
  let plain = ''
  let i = 0
  const n = text.length

  const flush = () => {
    if (plain) {
      out += escHtml(plain)
      plain = ''
    }
  }

  while (i < n) {
    const c = text[i]

    // 行内代码 `code` —— 内部为字面量，不再解析
    if (c === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out += wrapMd(mk('`') + `<code>${escHtml(text.slice(i + 1, end))}</code>` + mk('`'))
        i = end + 1
        continue
      }
    }

    // 加粗 **text** / __text__
    if ((c === '*' || c === '_') && text[i + 1] === c) {
      const delim = c + c
      const end = text.indexOf(delim, i + 2)
      if (end >= i + 3) {
        flush()
        out += wrapMd(mk(delim) + `<strong>${renderInline(text.slice(i + 2, end))}</strong>` + mk(delim))
        i = end + 2
        continue
      }
    }

    // 删除线 ~~text~~
    if (c === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end >= i + 3) {
        flush()
        out += wrapMd(mk('~~') + `<del>${renderInline(text.slice(i + 2, end))}</del>` + mk('~~'))
        i = end + 2
        continue
      }
    }

    // 斜体 *text* / _text_
    if (c === '*' || c === '_') {
      const end = findSingle(text, i + 1, c)
      if (end > i + 1) {
        flush()
        out += wrapMd(mk(c) + `<em>${renderInline(text.slice(i + 1, end))}</em>` + mk(c))
        i = end + 1
        continue
      }
    }

    // 链接 [label](url)
    if (c === '[') {
      const close = text.indexOf(']', i + 1)
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2)
        if (paren > close) {
          flush()
          const label = text.slice(i + 1, close)
          const url = text.slice(close + 2, paren)
          out += wrapMd(
            mk('[') +
              `<a href="${escAttr(url)}">${renderInline(label)}</a>` +
              mk(`](${url})`)
          )
          i = paren + 1
          continue
        }
      }
    }

    plain += c
    i++
  }

  flush()
  return out
}
