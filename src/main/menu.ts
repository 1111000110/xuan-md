import { Menu, app, BrowserWindow, shell } from 'electron'
import type { ActionName } from '@shared/ipc'
import { setTheme, currentTheme } from './theme'

function send(action: ActionName): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('action', action)
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 xuan-md' },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏 xuan-md' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出 xuan-md' }
            ]
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: '新建标签页', accelerator: 'CmdOrCtrl+D', click: () => send('new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: '导出为 PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('exportPdf') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => send('closeTab') },
        isMac
          ? { role: 'close', label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W' }
          : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', click: () => send('cut') },
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => send('copy') },
        { role: 'paste', label: '粘贴' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => send('selectAll') },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => send('find') }
      ]
    },
    {
      label: '格式',
      submenu: [
        { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => send('format:bold') },
        { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => send('format:italic') },
        { label: '删除线', accelerator: 'CmdOrCtrl+Shift+X', click: () => send('format:strike') },
        { label: '行内代码', accelerator: 'CmdOrCtrl+E', click: () => send('format:code') },
        { label: '插入链接', accelerator: 'CmdOrCtrl+K', click: () => send('format:link') },
        { type: 'separator' },
        { label: '插入表格', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('insertTable') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '大纲', accelerator: 'CmdOrCtrl+\\', click: () => send('toggleOutline') },
        { label: '源代码模式', accelerator: 'CmdOrCtrl+/', click: () => send('toggleSource') },
        { type: 'separator' },
        {
          label: '主题',
          submenu: [
            {
              label: '浅色',
              type: 'radio',
              checked: currentTheme() === 'light',
              click: () => {
                setTheme('light')
                buildMenu()
              }
            },
            {
              label: '深色',
              type: 'radio',
              checked: currentTheme() === 'dark',
              click: () => {
                setTheme('dark')
                buildMenu()
              }
            },
            {
              label: '跟随系统',
              type: 'radio',
              checked: currentTheme() === 'system',
              click: () => {
                setTheme('system')
                buildMenu()
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    { role: 'windowMenu', label: '窗口' },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        {
          label: 'xuan-md 项目说明',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
