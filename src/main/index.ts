import {
  app,
  BrowserWindow,
  dialog,
  shell,
  nativeTheme,
  protocol,
  net,
  globalShortcut,
  ipcMain
} from 'electron'
import { join, basename } from 'path'
import { pathToFileURL } from 'url'
import { readFile } from 'fs/promises'
import { registerIpc, getState } from './ipc'
import { buildMenu } from './menu'
import { applyStartupTheme } from './theme'
import {
  getQuickConfig,
  addQuickDoc,
  removeQuickDoc,
  reorderQuickDoc,
  renameQuickDoc,
  clearQuickDocs
} from './settings'

let mainWindow: BrowserWindow | null = null
let pendingOpenPath: string | null = null

// 自定义协议：把本地图片经 xmd://local/<编码后的绝对路径> 提供给渲染层加载，
// 规避 file:// 在 http/file 源下被 webSecurity 拦截。必须在 app ready 前声明为特权协议。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'xmd',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

function sendOpenFile(win: BrowserWindow, filePath: string): void {
  readFile(filePath, 'utf-8')
    .then((content) => {
      win.webContents.send('file:opened', { path: filePath, content })
      // 把窗口/应用唤到前台，否则双击文件看起来「没反应」（窗口仍在后台）
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      app.focus({ steal: true })
    })
    .catch((err) => console.error('open-file failed:', err))
}

// ── 速记面板：系统级快捷键唤起一个独立小窗口（列表首页，失焦自动隐藏）──────────
let quickWindow: BrowserWindow | null = null
let quickSuppressBlur = false // 刚显示的瞬间忽略失焦，避免动画期假失焦把面板秒关

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 620,
    show: false,
    frame: false, // 无边框面板：靠失焦 / Esc 收起
    // 非激活面板（NSPanel）：能拿键盘焦点但不激活整个应用、不切 space，
    // 所以像 Spotlight 那样浮在当前这屏上，既不跳桌面、也不会拿不到焦点而秒关。
    type: 'panel',
    center: true,
    resizable: true,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: '速记面板',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  quickWindow = win
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 失焦（点到别的窗口 / App）即隐藏 —— 但刚显示瞬间的假失焦忽略掉
  win.on('blur', () => {
    if (!quickSuppressBlur) win.hide()
  })
  win.on('closed', () => {
    if (quickWindow === win) quickWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/quick.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/quick.html'))
  }
  return win
}

/** 读取速记文档内容，推给面板渲染层（name 为显示名：别名优先，否则去扩展名的文件名） */
function sendQuickDocs(win: BrowserWindow): void {
  const cfg = getQuickConfig()
  Promise.all(
    cfg.docs.map((d) => {
      const name = d.name || basename(d.path).replace(/\.(md|markdown)$/i, '')
      return readFile(d.path, 'utf-8')
        .then((content) => ({ path: d.path, name, content, ok: true }))
        .catch(() => ({ path: d.path, name, content: '', ok: false }))
    })
  ).then((docs) => win.webContents.send('quick:docs', docs))
}

/** 在主窗口打开某文档（速记面板「在编辑器中打开」用） */
function openInMain(filePath: string): void {
  quickWindow?.hide()
  if (process.platform === 'darwin') app.show()
  if (!mainWindow) {
    pendingOpenPath = filePath
    createWindow()
    return
  }
  if (mainWindow.webContents.isLoading()) {
    pendingOpenPath = filePath
    return
  }
  sendOpenFile(mainWindow, filePath)
}

/** 唤起速记面板浮层并刷新文档列表（不激活整个应用，避免切走当前 App / 桌面）。 */
function showQuickPanel(win: BrowserWindow): void {
  sendQuickDocs(win)
  quickSuppressBlur = true // 显示前后短暂忽略失焦
  win.show() // 浮层 + 全 space 可见，会盖在当前这屏上
  win.focus() // 非激活面板可拿到键盘焦点（改名输入框 / Esc），但不激活整个应用
  setTimeout(() => {
    quickSuppressBlur = false
  }, 350)
}

/** 按下全局快捷键：开关式唤起/收起速记面板 */
function openQuickPanel(): void {
  // 已显示 → 再按一次收起（开关）
  if (quickWindow && quickWindow.isVisible()) {
    quickWindow.hide()
    return
  }
  if (!quickWindow) {
    const win = createQuickWindow()
    win.webContents.once('did-finish-load', () => showQuickPanel(win))
    return
  }
  showQuickPanel(quickWindow)
}

/** 注册（或刷新）全局快捷键。无任何速记文档时不占用快捷键。返回是否注册成功。 */
export function registerQuickShortcut(): boolean {
  globalShortcut.unregisterAll() // 本应用只此一个全局键，清掉再注册
  const cfg = getQuickConfig()
  if (cfg.docs.length === 0) return true // 未配置：不占用全局快捷键
  const ok = globalShortcut.register(cfg.shortcut, openQuickPanel)
  if (!ok) console.error('注册全局快捷键失败（可能被其他应用占用）:', cfg.shortcut)
  return ok
}

// 通过双击 / “打开方式” 关联打开 .md —— 必须在 whenReady 之前注册：
// 由文件启动时，open-file 会早于 ready 触发，先存起来等窗口就绪再补发。
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    sendOpenFile(mainWindow, filePath)
  } else {
    pendingOpenPath = filePath
    // 窗口已被关闭（点 X）但 app 仍驻留：新建一个窗口，加载完成后补发该文件
    if (app.isReady() && !mainWindow) createWindow()
  }
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'xuan-md',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 渲染层加载完成后，若有等待打开的文件（双击启动场景），补发给它
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      sendOpenFile(win, pendingOpenPath)
      pendingOpenPath = null
    }
  })

  // 外部链接走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 关窗时若有未保存更改，弹出确认
  win.on('close', (e) => {
    const state = getState(win)
    if (state.forceClose || !state.dirty) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      message: `是否保存对“${state.fileName}”的更改？`,
      detail: '如果不保存，你的更改将会丢失。'
    })
    if (choice === 2) {
      e.preventDefault() // 取消
    } else if (choice === 1) {
      state.forceClose = true // 不保存 -> 放行关闭
    } else {
      e.preventDefault() // 保存 -> 交给渲染进程保存后再关
      win.webContents.send('action', 'saveForClose')
    }
  })

  // dev 用 electron-vite 注入的本地服务，生产加载打包好的 html
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // xmd://local/<编码后的绝对路径> → 读取本地文件返回给 <img>
  protocol.handle('xmd', (request) => {
    const url = new URL(request.url)
    const abs = decodeURIComponent(url.pathname.replace(/^\//, ''))
    return net.fetch(pathToFileURL(abs).toString())
  })
  applyStartupTheme() // 套用上次选择的主题（默认浅色）
  registerIpc()

  // 速记面板管理（在此注册，避免与 ipc.ts 形成循环依赖）
  const refreshPanel = (): void => {
    if (quickWindow) sendQuickDocs(quickWindow)
  }
  // 主窗口菜单：把当前文档加入面板
  ipcMain.handle('quick:add', (_e, payload: { path: string }) => {
    if (!payload?.path) return { ok: false, error: 'no path' }
    const cfg = addQuickDoc(payload.path)
    const ok = registerQuickShortcut()
    refreshPanel()
    return { ok, shortcut: cfg.shortcut, count: cfg.docs.length }
  })
  ipcMain.handle('quick:clear', () => {
    clearQuickDocs()
    registerQuickShortcut()
    refreshPanel()
    return { ok: true }
  })
  // 面板内：加入主窗口当前文档
  ipcMain.handle('quick:addCurrent', () => {
    const path = mainWindow ? getState(mainWindow).filePath : undefined
    if (!path) return { ok: false, reason: 'no-doc' } // 主窗口没有已保存的当前文档
    const cfg = addQuickDoc(path)
    registerQuickShortcut()
    refreshPanel()
    return { ok: true, count: cfg.docs.length }
  })
  // 面板内：移除 / 排序 / 改名 / 在编辑器打开
  ipcMain.handle('quick:remove', (_e, p: { path: string }) => {
    removeQuickDoc(p.path)
    registerQuickShortcut()
    refreshPanel()
    return { ok: true }
  })
  ipcMain.handle('quick:reorder', (_e, p: { path: string; dir: -1 | 1 }) => {
    reorderQuickDoc(p.path, p.dir)
    refreshPanel()
    return { ok: true }
  })
  ipcMain.handle('quick:rename', (_e, p: { path: string; name: string }) => {
    renameQuickDoc(p.path, p.name)
    refreshPanel()
    return { ok: true }
  })
  ipcMain.on('quick:openInMain', (_e, p: { path: string }) => openInMain(p.path))
  ipcMain.on('quickpanel:hide', () => quickWindow?.hide())

  buildMenu()
  createWindow()
  registerQuickShortcut() // 注册全局速记快捷键（若已配置）

  // 点 dock 图标 / 重新激活：显示并聚焦主窗口（注意：速记面板的隐藏窗口也算一个 window，
  // 不能用窗口总数判断，否则关掉主窗口后点 dock 不会有反应）。
  app.on('activate', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // macOS 习惯：关掉所有窗口后应用仍驻留
  if (process.platform !== 'darwin') app.quit()
})
