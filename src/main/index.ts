import { app, BrowserWindow, dialog, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { registerIpc, getState } from './ipc'
import { buildMenu } from './menu'

let mainWindow: BrowserWindow | null = null
let pendingOpenPath: string | null = null

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#363b40' : '#ffffff',
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
  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 习惯：关掉所有窗口后应用仍驻留
  if (process.platform !== 'darwin') app.quit()
})
