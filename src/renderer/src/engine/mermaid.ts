// ────────────────────────────────────────────────────────────────────────────
// Mermaid 图表渲染。```mermaid 围栏在未编辑时渲染为 SVG 图，聚焦进去时回到源码可编辑
// （与 KaTeX/图片的「失焦渲染」思路一致，但作用在整段围栏上）。
// 渲染结果按源码缓存，避免重复解析；主题跟随系统明暗。
// ────────────────────────────────────────────────────────────────────────────

import mermaid from 'mermaid'

let inited = false
let initedDark = false
let seq = 0
const cache = new Map<string, string>()

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function ensureInit(): void {
  const dark = prefersDark()
  if (inited && dark === initedDark) return
  initedDark = dark
  inited = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default'
  })
}

export function isMermaidLang(lang: string): boolean {
  return lang.toLowerCase() === 'mermaid'
}

/** 已缓存的渲染结果（同步取，避免重渲时闪一下「渲染中」） */
export function mermaidCached(code: string): string | undefined {
  return cache.get(code.trim())
}

/** 主题切换后调用：清缓存并要求下次重新按新主题初始化 */
export function resetMermaid(): void {
  cache.clear()
  inited = false
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

/** 渲染一段 mermaid 源码为 SVG 字符串（带缓存）。失败返回错误提示 HTML。 */
export async function renderMermaid(code: string): Promise<string> {
  const key = code.trim()
  const hit = cache.get(key)
  if (hit) return hit
  ensureInit()
  const id = `mmd-${++seq}`
  try {
    const { svg } = await mermaid.render(id, key)
    cache.set(key, svg)
    return svg
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `<pre class="mm-error">Mermaid 渲染失败：\n${escapeHtml(msg)}</pre>`
  } finally {
    // mermaid 渲染时会往 body 塞临时测量节点（#d<id>），失败路径下清理掉
    document.getElementById('d' + id)?.remove()
  }
}
