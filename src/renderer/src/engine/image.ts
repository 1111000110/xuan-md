// ────────────────────────────────────────────────────────────────────────────
// 图片 ![alt](src)。与数学一致采用「聚焦显源码 / 失焦渲染」：含图片的段落失焦时
// 渲染 <img>，聚焦时回到 markdown 源码以便编辑。
//
// 本地路径（相对/绝对）经主进程注册的自定义协议 xmd:// 加载，规避 file:// 在
// 非 file 源（开发期 http://localhost、生产期 file://）下被 webSecurity 拦截的问题。
// ────────────────────────────────────────────────────────────────────────────

import { renderInline } from './inline'

// ![alt](src) 或 ![alt](src "title")
const RE_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/

/** 该行是否含可渲染的图片 */
export function hasImage(raw: string): boolean {
  return RE_IMAGE.test(raw)
}

/** 属性值转义（含双引号） */
function attr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '"' ? '&quot;' : c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'
  )
}

/** 拆出 src 与可选的 "title" */
function splitSrcTitle(inside: string): { src: string; title: string } {
  const m = inside.match(/^(\S+)\s+"([^"]*)"\s*$/)
  if (m) return { src: m[1], title: m[2] }
  return { src: inside.trim(), title: '' }
}

/** 由 mime 推断扩展名（截图粘贴时用） */
export function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/bmp':
      return 'bmp'
    default:
      return 'png'
  }
}

/**
 * 把 markdown 里的 src 解析成 <img> 能加载的 URL。
 * - http(s) / data / xmd：原样返回
 * - 本地绝对/相对路径：拼成绝对路径后走 xmd:// 协议
 *   （相对路径相对于当前文档所在目录 docDir；docDir 为 null 时无法解析，原样返回）
 */
export function resolveImageSrc(src: string, docDir: string | null): string {
  const s = src.trim()
  if (/^(https?:|data:|xmd:)/i.test(s)) return s
  let abs = s
  if (s.startsWith('file://')) {
    abs = decodeURIComponent(s.slice('file://'.length))
  } else if (!s.startsWith('/')) {
    if (!docDir) return s // 未保存文档 + 相对路径：无从解析，交给 <img> 显示裂图
    abs = docDir.replace(/[/\\]+$/, '') + '/' + s
  }
  return 'xmd://local/' + encodeURIComponent(abs)
}

/** 失焦预览：图片渲染为 <img>，其余文本走常规行内渲染 */
export function renderImagePreview(raw: string, docDir: string | null): string {
  let out = ''
  let last = 0
  const re = new RegExp(RE_IMAGE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out += renderInline(raw.slice(last, m.index))
    const alt = m[1]
    const { src, title } = splitSrcTitle(m[2])
    const resolved = resolveImageSrc(src, docDir)
    out +=
      `<img class="md-img" src="${attr(resolved)}" alt="${attr(alt)}"` +
      (title ? ` title="${attr(title)}"` : '') +
      ` draggable="false">`
    last = m.index + m[0].length
  }
  out += renderInline(raw.slice(last))
  return out || '<br>'
}
