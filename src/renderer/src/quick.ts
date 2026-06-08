// 速记面板窗口：列表首页（可增删改排序）→ 点开只读查看/复制；失焦或 Esc 收起。
import 'katex/dist/katex.min.css'
import './styles.css'
import { Editor } from './editor'

interface QuickDocData {
  path: string
  name: string
  content: string
  ok: boolean
}

const root = document.getElementById('quick-root') as HTMLElement

// ── 头部：返回 / 标题 / 在编辑器打开 / 复制全部 ──
const header = document.createElement('div')
header.className = 'quick-header'
const backBtn = document.createElement('button')
backBtn.className = 'quick-hbtn quick-back'
backBtn.textContent = '‹ 返回'
backBtn.style.display = 'none'
const titleEl = document.createElement('div')
titleEl.className = 'quick-title'
titleEl.textContent = '速记面板'
const openBtn = document.createElement('button')
openBtn.className = 'quick-hbtn'
openBtn.textContent = '在编辑器打开'
openBtn.style.display = 'none'
const copyBtn = document.createElement('button')
copyBtn.className = 'quick-hbtn'
copyBtn.textContent = '复制全部'
copyBtn.style.display = 'none'
header.append(backBtn, titleEl, openBtn, copyBtn)

// ── 列表 / 查看区 / 提示条 ──
const listWrap = document.createElement('div')
listWrap.className = 'quick-listwrap'
const listEl = document.createElement('div')
listEl.className = 'quick-list'
const addBtn = document.createElement('button')
addBtn.className = 'quick-add'
addBtn.textContent = '＋ 添加当前编辑器文档'
listWrap.append(listEl, addBtn)

const viewEl = document.createElement('div')
viewEl.className = 'quick-view'
viewEl.style.display = 'none'

const toast = document.createElement('div')
toast.className = 'quick-toast'

root.append(header, listWrap, viewEl, toast)

const editor = new Editor(viewEl)
editor.setReadOnly(true) // 面板只读：可看可复制，不可编辑

let docs: QuickDocData[] = []
let current: QuickDocData | null = null
let toastTimer = 0

function showToast(msg: string): void {
  toast.textContent = msg
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500)
}

function showList(): void {
  current = null
  viewEl.style.display = 'none'
  listWrap.style.display = ''
  backBtn.style.display = 'none'
  openBtn.style.display = 'none'
  copyBtn.style.display = 'none'
  titleEl.textContent = '速记面板'
}

function showDoc(d: QuickDocData): void {
  current = d
  listWrap.style.display = 'none'
  viewEl.style.display = ''
  backBtn.style.display = ''
  openBtn.style.display = ''
  copyBtn.style.display = d.ok ? '' : 'none'
  copyBtn.textContent = '复制全部'
  titleEl.textContent = d.name
  editor.setContent(d.ok ? d.content : `（无法读取此文档）\n${d.path}`)
  viewEl.scrollTop = 0
}

function iconBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'quick-op'
  b.textContent = label
  b.title = title
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

function renderList(): void {
  listEl.replaceChildren()
  if (docs.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'quick-empty'
    empty.textContent = '还没有速记文档。\n点下面「添加当前编辑器文档」，或在主窗口的文件菜单里添加。'
    listEl.appendChild(empty)
    return
  }
  docs.forEach((d, i) => {
    const row = document.createElement('div')
    row.className = 'quick-row'

    const main = document.createElement('button')
    main.className = 'quick-row-main'
    const name = document.createElement('div')
    name.className = 'quick-row-name'
    name.textContent = d.name
    const path = document.createElement('div')
    path.className = 'quick-row-path'
    path.textContent = d.ok ? d.path : '⚠ 读取失败：' + d.path
    main.append(name, path)
    main.addEventListener('click', () => showDoc(d))

    const ops = document.createElement('div')
    ops.className = 'quick-row-ops'
    if (i > 0) ops.append(iconBtn('▲', '上移', () => void window.api.quickReorder(d.path, -1)))
    if (i < docs.length - 1)
      ops.append(iconBtn('▼', '下移', () => void window.api.quickReorder(d.path, 1)))
    ops.append(iconBtn('✎', '改名', () => startRename(row, d)))
    ops.append(iconBtn('✕', '移除', () => void window.api.quickRemove(d.path)))

    row.append(main, ops)
    listEl.appendChild(row)
  })
}

/** 行内改名：把名字换成输入框，回车提交 / Esc 取消 */
function startRename(row: HTMLElement, d: QuickDocData): void {
  const main = row.querySelector('.quick-row-main') as HTMLElement
  const nameEl = main.querySelector('.quick-row-name') as HTMLElement
  const input = document.createElement('input')
  input.className = 'quick-rename-input'
  input.value = d.name
  input.placeholder = '显示名称（留空恢复文件名）'
  nameEl.replaceWith(input)
  input.focus()
  input.select()
  const commit = (): void => void window.api.quickRename(d.path, input.value)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      renderList() // 取消：重渲染丢弃输入框
    }
  })
  input.addEventListener('blur', commit)
}

backBtn.addEventListener('click', showList)
openBtn.addEventListener('click', () => {
  if (current) window.api.quickOpenInMain(current.path)
})
copyBtn.addEventListener('click', () => {
  if (!current) return
  window.api.writeClipboard(current.content)
  copyBtn.textContent = '已复制 ✓'
  setTimeout(() => {
    copyBtn.textContent = '复制全部'
  }, 1200)
})
addBtn.addEventListener('click', async () => {
  const res = await window.api.quickAddCurrent()
  if (res.ok) showToast('已加入')
  else showToast('主窗口没有已保存的当前文档')
})

window.api.onQuickDocs((received) => {
  docs = received
  // 在列表态时刷新列表；在查看态时同步当前文档（被移除则回列表）
  if (viewEl.style.display === 'none') {
    showList()
    renderList()
    if (docs.length === 1) showDoc(docs[0])
  } else {
    const still = current ? docs.find((x) => x.path === current!.path) : null
    if (still) {
      current = still
      titleEl.textContent = still.name
    } else {
      showList()
      renderList()
    }
  }
})

// Esc：查看态 → 返回列表；列表态 → 收起面板
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (viewEl.style.display !== 'none') showList()
    else window.api.hideQuickPanel()
  }
})

// 菜单/快捷键动作：面板里只处理复制与关闭
window.api.onAction((action) => {
  if (action === 'copy' || action === 'cut') document.execCommand('copy')
  else if (action === 'selectAll') document.execCommand('selectAll')
  else if (action === 'closeTab') window.api.hideQuickPanel()
})
