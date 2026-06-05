import 'katex/dist/katex.min.css'
import './styles.css'
import { Editor } from './editor'
import type { ActionName } from '@shared/ipc'

const root = document.getElementById('app') as HTMLElement
const statusbar = document.getElementById('statusbar') as HTMLElement
const workarea = document.getElementById('workarea') as HTMLElement
const outlineEl = document.getElementById('outline') as HTMLElement

// 全窗口兜底：阻止「把文件拖进窗口」时浏览器默认用该文件导航替换页面；
// 编辑器自身的 drop 处理（插入图片）已先于此执行。
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// 顶部标签栏（多文档）—— 放进右侧工作区，左侧是大纲
const tabbar = document.createElement('div')
tabbar.id = 'tabbar'
workarea.insertBefore(tabbar, root)

const editorHost = document.createElement('div')
editorHost.className = 'editor-host'
root.appendChild(editorHost)

const editor = new Editor(editorHost)

// ── 源代码模式（Cmd+/）：整篇 markdown 的纯文本编辑 ──────────────────────────
const sourceArea = document.createElement('textarea')
sourceArea.className = 'source-editor'
sourceArea.spellcheck = false
sourceArea.style.display = 'none'
root.appendChild(sourceArea)
let sourceMode = false

/** 当前内容：源码模式取 textarea，否则取编辑器 */
function currentContent(): string {
  return sourceMode ? sourceArea.value : editor.getContent()
}

function ensureWysiwyg(): void {
  if (!sourceMode) return
  sourceArea.style.display = 'none'
  editorHost.style.display = ''
  sourceMode = false
}

function toggleSourceMode(): void {
  if (!sourceMode) {
    sourceArea.value = editor.getContent()
    editorHost.style.display = 'none'
    sourceArea.style.display = 'block'
    sourceMode = true
    sourceArea.focus()
  } else {
    editor.setContent(sourceArea.value)
    sourceArea.style.display = 'none'
    editorHost.style.display = ''
    sourceMode = false
    updateStatus()
    editor.focus()
  }
}

sourceArea.addEventListener('input', () => {
  setDirty(true)
  const text = sourceArea.value
  const words = (text.match(/[一-龥]|[A-Za-z0-9]+/g) || []).length
  const lines = text.length ? text.split('\n').length : 0
  statusbar.textContent = `${words} 字  ·  ${text.length} 字符  ·  ${lines} 行`
})

// ── 多标签文档状态 ──────────────────────────────────────────────────────────
interface Tab {
  id: number
  path: string | null
  content: string // 非激活标签的内容存这里；激活标签以编辑器为准
  dirty: boolean
}

const tabs: Tab[] = []
let activeId = 0
let nextTabId = 1
// 下面两个镜像「激活标签」的状态，供菜单/标题/保存使用
let currentPath: string | null = null
let dirty = false
// 程序化加载内容时为 true，避免把「加载」当成「修改」而误标 dirty
let loading = false

function activeTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeId)
}

function fileName(): string {
  return currentPath ? currentPath.split('/').pop()! : 'Untitled.md'
}

function pushState(): void {
  window.api.updateState({ dirty, fileName: fileName(), filePath: currentPath ?? undefined })
}

function setDirty(value: boolean): void {
  if (dirty === value) return
  dirty = value
  const t = activeTab()
  if (t) t.dirty = value
  renderTabs()
  pushState()
}

function updateStatus(): void {
  const s = editor.getStats()
  statusbar.textContent = `${s.words} 字  ·  ${s.chars} 字符  ·  ${s.lines} 行`
}

editor.onChange(() => {
  if (!loading) setDirty(true)
  updateStatus()
  renderOutline()
})

// ── 大纲（左侧标题导航） ──────────────────────────────────────────────────────
let outlineVisible = true

function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function renderOutline(): void {
  const md = currentContent()
  const items: { level: number; text: string }[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m) items.push({ level: m[1].length, text: stripInline(m[2]) })
  }
  outlineEl.replaceChildren()
  const title = document.createElement('div')
  title.className = 'outline-title'
  title.textContent = '大纲'
  outlineEl.appendChild(title)
  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'outline-empty'
    empty.textContent = '暂无标题'
    outlineEl.appendChild(empty)
    return
  }
  items.forEach((h, i) => {
    const el = document.createElement('div')
    el.className = 'outline-item'
    el.textContent = h.text || '(空标题)'
    el.style.paddingLeft = `${10 + (h.level - 1) * 12}px`
    el.addEventListener('click', () => editor.scrollToHeading(i))
    outlineEl.appendChild(el)
  })
}

function toggleOutline(): void {
  outlineVisible = !outlineVisible
  document.body.classList.toggle('no-outline', !outlineVisible)
}

// ── 标签栏渲染 ──────────────────────────────────────────────────────────────
function renderTabs(): void {
  tabbar.replaceChildren()
  tabbar.style.display = 'flex' // 始终显示标签栏，哪怕只有一个标签
  for (const t of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (t.id === activeId ? ' active' : '')
    el.title = t.path ?? 'Untitled'

    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = (t.dirty ? '● ' : '') + (t.path ? t.path.split('/').pop()! : 'Untitled')
    el.appendChild(name)

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeTab(t.id)
    })
    el.appendChild(close)

    el.addEventListener('mousedown', () => switchTo(t.id))
    tabbar.appendChild(el)
  }
}

// ── 标签操作 ────────────────────────────────────────────────────────────────
function persistActive(): void {
  const t = activeTab()
  if (!t) return
  t.content = currentContent()
  t.dirty = dirty
  t.path = currentPath
}

function loadTab(t: Tab): void {
  ensureWysiwyg()
  activeId = t.id
  currentPath = t.path
  editor.setDocPath(t.path) // 先告知文档路径，使图片相对路径在初次渲染就能解析
  loading = true
  editor.setContent(t.content)
  loading = false
  dirty = t.dirty
  updateStatus()
  pushState()
  renderTabs()
  renderOutline()
  editor.focus()
}

function switchTo(id: number): void {
  if (id === activeId) return
  persistActive()
  const t = tabs.find((x) => x.id === id)
  if (t) loadTab(t)
}

function newTab(path: string | null, content: string): void {
  persistActive()
  const t: Tab = { id: nextTabId++, path, content, dirty: false }
  tabs.push(t)
  loadTab(t)
}

function openTab(path: string, content: string): void {
  const existing = tabs.find((t) => t.path === path)
  if (existing) {
    switchTo(existing.id)
    return
  }
  persistActive()
  // 若当前只有一个空白未改的 Untitled，直接复用它（避免多出空标签）
  const cur = activeTab()
  if (tabs.length === 1 && cur && cur.path === null && !cur.dirty && cur.content === '') {
    cur.path = path
    cur.content = content
    loadTab(cur)
    return
  }
  const t: Tab = { id: nextTabId++, path, content, dirty: false }
  tabs.push(t)
  loadTab(t)
}

function closeTab(id: number): void {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const wasActive = id === activeId
  tabs.splice(idx, 1)
  if (tabs.length === 0) {
    newTab(null, '')
    return
  }
  if (wasActive) {
    loadTab(tabs[Math.min(idx, tabs.length - 1)])
  } else {
    renderTabs()
  }
}

// ── 文件操作 ────────────────────────────────────────────────────────────────
function newDoc(): void {
  newTab(null, '')
}

function loadDoc(path: string, content: string): void {
  openTab(path, content)
}

async function openDoc(): Promise<void> {
  const res = await window.api.openFile()
  if (!res) return
  openTab(res.path, res.content)
}

async function save(): Promise<boolean> {
  if (!currentPath) return saveAs()
  const r = await window.api.writeFile(currentPath, currentContent())
  if (r.ok) {
    setDirty(false)
    return true
  }
  window.alert('保存失败：' + r.error)
  return false
}

async function saveAs(): Promise<boolean> {
  const r = await window.api.saveAs(currentContent(), currentPath ?? 'Untitled.md')
  if (!r) return false
  currentPath = r.path
  editor.setDocPath(r.path) // 路径已定，图片相对路径解析基准随之更新
  dirty = false
  const t = activeTab()
  if (t) {
    t.path = r.path
    t.dirty = false
  }
  renderTabs()
  pushState()
  updateStatus()
  return true
}

// 焦点是否落在原生输入框（查找/替换框、源码 textarea）——
// 这些场景下，全局菜单快捷键（Cmd+A/C/X、格式化）应作用于输入框本身，
// 而非劫持去操作富文本编辑器（否则会抢走焦点、把输入漏进文档）。
function activeNativeInput(): HTMLInputElement | HTMLTextAreaElement | null {
  const a = document.activeElement
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
    return a as HTMLInputElement | HTMLTextAreaElement
  }
  return null
}

// ── 菜单 / 快捷键动作分发 ────────────────────────────────────────────────────
const handlers: Record<ActionName, () => void | Promise<unknown>> = {
  new: newDoc,
  open: openDoc,
  save,
  saveAs,
  saveForClose: async () => {
    const ok = await save()
    if (ok) window.api.savedForClose()
  },
  closeTab: () => closeTab(activeId),
  undo: () => {
    if (activeNativeInput()) document.execCommand('undo')
    else editor.undo()
  },
  redo: () => {
    if (activeNativeInput()) document.execCommand('redo')
    else editor.redo()
  },
  find: () => editor.openFind(),
  exportPdf: async () => {
    if (sourceMode) toggleSourceMode() // 切回所见即所得并同步内容，再走 print 渲染
    editor.closeFind()
    // 等一帧让 DOM/布局稳定后再交给主进程 printToPDF
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const res = await window.api.exportPdf(fileName())
    if (res && !res.ok && res.error) window.alert('导出 PDF 失败：' + res.error)
  },
  selectAll: () => {
    const inp = activeNativeInput()
    if (inp) inp.select()
    else editor.selectAll()
  },
  copy: () => {
    if (activeNativeInput()) document.execCommand('copy')
    else editor.copy()
  },
  cut: () => {
    if (activeNativeInput()) document.execCommand('cut')
    else editor.cut()
  },
  insertTable: () => {
    if (activeNativeInput()) return
    editor.insertTable()
  },
  toggleOutline: () => toggleOutline(),
  toggleSource: () => toggleSourceMode(),
  'format:bold': () => {
    if (activeNativeInput()) return
    editor.wrap('**')
  },
  'format:italic': () => {
    if (activeNativeInput()) return
    editor.wrap('*')
  },
  'format:strike': () => {
    if (activeNativeInput()) return
    editor.wrap('~~')
  },
  'format:code': () => {
    if (activeNativeInput()) return
    editor.wrap('`')
  },
  'format:link': () => {
    if (activeNativeInput()) return
    editor.wrap('[', '](url)')
  }
}

window.api.onAction((action) => {
  handlers[action]?.()
})

// 通过文件关联（双击 / “打开方式”）打开的 .md —— 新开一个标签
window.api.onOpenFile(({ path, content }) => loadDoc(path, content))

// ── 初始化：一个空白标签 ──────────────────────────────────────────────────────
newTab(null, '')
